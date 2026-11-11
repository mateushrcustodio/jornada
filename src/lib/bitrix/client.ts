import "server-only";
import type { RestResponse } from "../types";
import { BitrixError } from "./errors";
import { credentials, validateDomain } from "./config";
import type { Session } from "./session";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function exchangeToken(params: Record<string, string>) {
  const { clientId, clientSecret } = credentials();
  const response = await fetch("https://oauth.bitrix.info/oauth/token/", {
    method: "POST",
    body: new URLSearchParams({
      ...params,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json();
  if (
    !response.ok ||
    body.error ||
    typeof body.access_token !== "string" ||
    typeof body.refresh_token !== "string"
  )
    throw new BitrixError(
      "OAUTH_FAILED",
      "A autorização expirou ou foi recusada. Reabra a aplicação no Bitrix24.",
      401,
    );
  return body as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    domain?: string;
    member_id: string;
  };
}
async function refresh(session: Session) {
  if (session.refreshPending) return session.refreshPending;
  session.refreshPending = (async () => {
    const token = await exchangeToken({
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
    });
    if (
      (token.domain && validateDomain(token.domain) !== session.domain) ||
      token.member_id !== session.memberId
    )
      throw new BitrixError(
        "OAUTH_CONTEXT",
        "O contexto da autorização não corresponde ao portal.",
        403,
      );
    session.accessToken = token.access_token;
    session.refreshToken = token.refresh_token;
    session.tokenExpiresAt =
      Date.now() + Number(token.expires_in || 3600) * 1000;
  })().finally(() => {
    session.refreshPending = undefined;
  });
  return session.refreshPending;
}
export async function rest<T>(
  session: Session,
  method: string,
  params: Record<string, unknown> = {},
  attempt = 0,
): Promise<RestResponse<T>> {
  validateDomain(session.domain);
  if (session.tokenExpiresAt < Date.now() + 30000) await refresh(session);
  // Reserva o próximo slot antes do await, inclusive para consultas concorrentes da mesma sessão.
  const at = Math.max(Date.now(), session.nextRequestAt || 0);
  session.nextRequestAt = at + 550;
  if (at > Date.now()) await wait(at - Date.now());
  let response: Response;
  try {
    response = await fetch(`https://${session.domain}/rest/${method}.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...params, auth: session.accessToken }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new BitrixError(
      "NETWORK",
      "O Bitrix24 não respondeu a tempo. Verifique a conexão e tente novamente.",
      502,
    );
  }
  const body = (await response.json().catch(() => ({}))) as RestResponse<T>;
  if (
    (response.status === 429 ||
      ["QUERY_LIMIT_EXCEEDED", "OPERATION_TIME_LIMIT"].includes(
        body.error || "",
      )) &&
    attempt < 2
  ) {
    await wait(1000 * 2 ** attempt);
    return rest(session, method, params, attempt + 1);
  }
  if (body.error === "expired_token" && attempt < 1) {
    await refresh(session);
    return rest(session, method, params, attempt + 1);
  }
  if (!response.ok || body.error || body.result === undefined) {
    const denied =
      /ACCESS_DENIED|insufficient_scope|allowed_only|ERROR_ACCESS_DENIED/i.test(
        body.error || "",
      ) || response.status === 403;
    const auth =
      /NO_AUTH_FOUND|INVALID_CREDENTIALS|invalid_token|expired_token/i.test(
        body.error || "",
      ) || response.status === 401;
    throw new BitrixError(
      body.error || "REST_ERROR",
      denied
        ? "Você não tem permissão para consultar o histórico desses negócios."
        : auth
          ? "Sua sessão expirou. Reabra a aplicação no Bitrix24."
          : response.status === 429
            ? "O limite de consultas do Bitrix24 foi atingido. Aguarde e tente novamente."
            : "O Bitrix24 não conseguiu concluir a consulta. Tente novamente.",
      denied ? 403 : auth ? 401 : 502,
    );
  }
  return body;
}
export function unwrap<T>(result: unknown, key = "items"): T[] {
  if (Array.isArray(result)) return result as T[];
  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as Record<string, unknown>)[key])
  )
    return (result as Record<string, unknown>)[key] as T[];
  // Alguns portais envolvem o retorno com um nome próprio da versão da API.
  // Quando houver exatamente uma coleção de itens, ela continua sendo segura
  // para normalizar sem depender do nome do envelope.
  if (result && typeof result === "object") {
    const collections = Object.values(result as Record<string, unknown>).filter(
      (value): value is T[] => Array.isArray(value),
    );
    if (collections.length === 1) return collections[0];
  }
  throw new BitrixError(
    "INVALID_RESPONSE",
    `O Bitrix24 retornou um formato de resposta inesperado (${describeBatchShape(result)}).`,
  );
}
export async function listPage<T>(
  session: Session,
  method: string,
  params: Record<string, unknown>,
  key = "items",
  start = 0,
) {
  const page = await rest<unknown>(session, method, { ...params, start });
  return {
    items: unwrap<T>(page.result, key),
    next: page.next,
    total: page.total,
  };
}
export interface BatchRequest {
  method: string;
  query: Record<string, unknown>;
  as?: string;
}
function describeBatchShape(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).slice(0, 12);
    return `object{${keys.join(",")}}`;
  }
  return typeof value;
}
function appendBatchParam(
  entries: string[],
  key: string,
  value: unknown,
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => appendBatchParam(entries, `${key}[]`, item));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([child, item]) =>
      appendBatchParam(entries, `${key}[${child}]`, item),
    );
    return;
  }
  if (value !== undefined && value !== null)
    entries.push(`${key}=${encodeURIComponent(String(value))}`);
}
function batchCommand(request: BatchRequest) {
  const params: string[] = [];
  Object.entries(request.query).forEach(([key, value]) =>
    appendBatchParam(params, key, value),
  );
  return params.length
    ? `${request.method}?${params.join("&")}`
    : request.method;
}
export async function batch(session: Session, requests: BatchRequest[]) {
  if (!requests.length) return [] as unknown[];
  if (requests.length > 50)
    throw new BitrixError(
      "BATCH_SIZE",
      "O lote de consultas excedeu o limite do Bitrix24.",
      422,
    );
  const response = await rest<unknown>(session, "batch", {
    halt: 0,
    cmd: Object.fromEntries(
      requests.map((request, index) => [
        request.as || String(index),
        batchCommand(request),
      ]),
    ),
  });
  let raw: unknown = response.result;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      /* O erro abaixo mantém a mensagem pública sem expor o payload. */
    }
  }
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const errors = (raw as { result_error?: unknown }).result_error;
    if (errors && typeof errors === "object" && Object.keys(errors).length) {
      const first = Object.values(errors as Record<string, unknown>)[0];
      const code =
        first && typeof first === "object" && "error" in first
          ? String((first as { error: unknown }).error)
          : "BATCH_SUBREQUEST";
      throw new BitrixError(
        code,
        "Uma das consultas em lote foi recusada pelo Bitrix24.",
        502,
      );
    }
  }
  let container = raw;
  for (let depth = 0; depth < 3; depth += 1) {
    if (
      !container ||
      typeof container !== "object" ||
      Array.isArray(container) ||
      !("result" in container)
    )
      break;
    const next = (container as { result: unknown }).result;
    if (next === container) break;
    container = next;
  }
  if (Array.isArray(container)) return container;
  if (container && typeof container === "object") {
    const map = container as Record<string, unknown>;
    const ordered = requests.map((request, index) => {
      const key = request.as || String(index);
      return map[key] ?? map[String(index)] ?? map[index];
    });
    if (ordered.every((item) => item !== undefined)) return ordered;
    const numericKeys = Object.keys(map)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b));
    if (numericKeys.length >= requests.length)
      return numericKeys
        .slice(0, requests.length)
        .map((key) => map[key]);
    const values = Object.values(map);
    if (values.length === requests.length) return values;
  }
  if (!raw)
    throw new BitrixError(
      "INVALID_RESPONSE",
      `O Bitrix24 retornou um lote em formato inesperado (${describeBatchShape(raw)}).`,
    );
  throw new BitrixError(
    "INVALID_RESPONSE",
    `O Bitrix24 retornou um lote em formato inesperado (raiz ${describeBatchShape(raw)}, conteúdo ${describeBatchShape(container)}).`,
  );
}
export async function listAll<T>(
  session: Session,
  method: string,
  params: Record<string, unknown>,
  key = "items",
  limit = 10000,
): Promise<T[]> {
  const result: T[] = [];
  let start = 0;
  const seen = new Set<number>();
  while (true) {
    if (seen.has(start))
      throw new BitrixError(
        "PAGINATION",
        "A paginação do Bitrix24 não avançou. Tente novamente.",
      );
    seen.add(start);
    const page = await rest<unknown>(session, method, { ...params, start });
    result.push(...unwrap<T>(page.result, key));
    if (result.length > limit)
      throw new BitrixError(
        "QUERY_TOO_LARGE",
        "A consulta excedeu o limite deste MVP. Selecione um pipeline ou reduza o período.",
        422,
      );
    if (page.next === undefined || page.next === null) break;
    start = Number(page.next);
    if (!Number.isFinite(start))
      throw new BitrixError(
        "PAGINATION",
        "O Bitrix24 retornou uma paginação inválida.",
      );
  }
  return result;
}
