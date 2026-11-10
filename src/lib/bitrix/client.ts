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
  throw new BitrixError(
    "INVALID_RESPONSE",
    "O Bitrix24 retornou um formato de resposta inesperado.",
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
