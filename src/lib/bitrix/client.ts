import "server-only";
import type { RestResponse } from "../types";
import { BitrixError } from "./errors";
import { credentials, validateDomain } from "./config";
import type { Session } from "./session";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Limite de intensidade do Bitrix24 ("leaky bucket", contado por portal):
// planos comuns aceitam rajadas de até 50 chamadas e escoam 2 por segundo;
// Enterprise, 250 e 5/s. Em vez de espaçar toda chamada em 550 ms, o app
// usa a folga do balde e só espera quando ele está quase cheio. O balde é
// compartilhado por todas as sessões do mesmo portal, como no Bitrix24.
// Ajustável por BITRIX_RATE_BURST e BITRIX_RATE_PER_SECOND.
interface Bucket {
  level: number;
  at: number;
}
const globalBuckets = globalThis as unknown as {
  jornadaRateBuckets?: Map<string, Bucket>;
};
const buckets = (globalBuckets.jornadaRateBuckets ??= new Map());
function rateConfig() {
  const burst = Number(process.env.BITRIX_RATE_BURST);
  const perSecond = Number(process.env.BITRIX_RATE_PER_SECOND);
  return {
    // Margem abaixo do limite real (50) para chamadas de outros apps do portal.
    burst: Number.isFinite(burst) && burst >= 1 ? burst : 40,
    perSecond: Number.isFinite(perSecond) && perSecond > 0 ? perSecond : 2,
  };
}
/**
 * Quantos negócios o painel completo detalha (histórico de cada um) numa
 * atualização. Cada grupo de 49 negócios é 1 chamada contada; deixa 10
 * chamadas da rajada livres para a primeira página das listas, os nomes de
 * usuários e outros apps do portal. Com os padrões (rajada 40) são 1.470
 * negócios sem nenhuma espera. Ajustável por BITRIX_DASHBOARD_MAX_DEALS.
 */
export function dashboardDealBudget() {
  const configured = Number(process.env.BITRIX_DASHBOARD_MAX_DEALS);
  if (Number.isFinite(configured) && configured >= 49)
    return Math.floor(configured);
  return Math.max(1, Math.floor(rateConfig().burst) - 10) * 49;
}
function drain(domain: string, now: number) {
  const { perSecond } = rateConfig();
  const bucket = buckets.get(domain) ?? { level: 0, at: now };
  bucket.level = Math.max(0, bucket.level - ((now - bucket.at) / 1000) * perSecond);
  bucket.at = now;
  buckets.set(domain, bucket);
  return bucket;
}
/** Reserva uma vaga no balde do portal e devolve quantos ms aguardar. */
export function reserveRateSlot(domain: string, now = Date.now()) {
  const { burst, perSecond } = rateConfig();
  const bucket = drain(domain, now);
  const delay =
    bucket.level + 1 > burst
      ? Math.ceil(((bucket.level + 1 - burst) / perSecond) * 1000)
      : 0;
  bucket.level += 1;
  return delay;
}
/** O portal recusou por limite: trata o balde como cheio para frear as demais chamadas. */
function saturateRateBucket(domain: string) {
  const bucket = drain(domain, Date.now());
  bucket.level = Math.max(bucket.level, rateConfig().burst);
}
export function resetRateLimits() {
  buckets.clear();
}
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
  // Reserva a vaga antes do await, inclusive para consultas concorrentes.
  const delay = reserveRateSlot(session.domain);
  if (delay > 0) await wait(delay);
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
    attempt < 3
  ) {
    saturateRateBucket(session.domain);
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
      // Chaves como ">=CREATED_TIME" precisam ser codificadas: o "=" cru
      // quebraria a leitura do subcomando no Bitrix24 (parse_str).
      appendBatchParam(entries, `${key}[${encodeURIComponent(child)}]`, item),
    );
    return;
  }
  if (value !== undefined && value !== null)
    entries.push(`${key}=${encodeURIComponent(String(value))}`);
}
function batchCommand(request: BatchRequest) {
  const params: string[] = [];
  Object.entries(request.query).forEach(([key, value]) =>
    appendBatchParam(params, encodeURIComponent(key), value),
  );
  return params.length
    ? `${request.method}?${params.join("&")}`
    : request.method;
}
export interface BatchResult {
  results: unknown[];
  /** result_next por subcomando (chave = as || índice), quando o portal informa. */
  next: Record<string, unknown>;
  /** result_total por subcomando, quando o portal informa. */
  total: Record<string, unknown>;
}
function batchMeta(raw: unknown, field: "result_next" | "result_total") {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const value = (raw as Record<string, unknown>)[field];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export async function batch(
  session: Session,
  requests: BatchRequest[],
  options: { halt?: boolean } = {},
) {
  return (await batchWithMeta(session, requests, options)).results;
}
export async function batchWithMeta(
  session: Session,
  requests: BatchRequest[],
  options: { halt?: boolean } = {},
): Promise<BatchResult> {
  if (!requests.length) return { results: [], next: {}, total: {} };
  if (requests.length > 50)
    throw new BitrixError(
      "BATCH_SIZE",
      "O lote de consultas excedeu o limite do Bitrix24.",
      422,
    );
  const response = await rest<unknown>(session, "batch", {
    halt: options.halt ? 1 : 0,
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
  const meta = {
    next: batchMeta(raw, "result_next"),
    total: batchMeta(raw, "result_total"),
  };
  if (Array.isArray(raw)) return { results: raw, ...meta };
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
  if (Array.isArray(container)) return { results: container, ...meta };
  if (container && typeof container === "object") {
    const map = container as Record<string, unknown>;
    const ordered = requests.map((request, index) => {
      const key = request.as || String(index);
      return map[key] ?? map[String(index)] ?? map[index];
    });
    if (ordered.every((item) => item !== undefined))
      return { results: ordered, ...meta };
    const numericKeys = Object.keys(map)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b));
    if (numericKeys.length >= requests.length)
      return {
        results: numericKeys.slice(0, requests.length).map((key) => map[key]),
        ...meta,
      };
    const values = Object.values(map);
    if (values.length === requests.length) return { results: values, ...meta };
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
/** Desembrulha o retorno de um subcomando de batch ({ result: { items } } etc.). */
export function unwrapNested<T>(value: unknown, key = "items"): T[] {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "result" in value
  )
    return unwrapNested<T>((value as { result: unknown }).result, key);
  return unwrap<T>(value, key);
}
export interface FastListOptions {
  key?: string;
  limit?: number;
  /**
   * "throw" (padrão): acima do limite, recusa a consulta (não mostra parcial
   * como completo). "truncate": devolve os primeiros `limit` e o total real.
   */
  overflow?: "throw" | "truncate";
  /** Campo de ID para remover duplicatas entre páginas. */
  idField?: string;
}
/**
 * Lista completa com poucas idas ao Bitrix24: a primeira página informa o
 * total e as demais (50 registros cada) são pedidas juntas em lotes de até
 * 50 subcomandos, ou seja, até 2.500 registros por chamada contabilizada.
 * A ordenação deve ser estável (por ID crescente) para o deslocamento não
 * pular nem repetir registros enquanto o CRM recebe novas movimentações.
 */
export async function listAllBatched<T>(
  session: Session,
  method: string,
  params: Record<string, unknown>,
  options: FastListOptions = {},
): Promise<{ items: T[]; total: number }> {
  const { key = "items", limit = 10000, overflow = "throw", idField } = options;
  const first = await rest<unknown>(session, method, { ...params, start: 0 });
  const items = unwrap<T>(first.result, key);
  const next = first.next;
  if (next === undefined || next === null)
    return { items: items.slice(0, limit), total: items.length };
  const total = Number(first.total);
  if (!Number.isFinite(total) || total < items.length)
    throw new BitrixError(
      "PAGINATION",
      "O Bitrix24 não informou o total da consulta.",
    );
  if (total > limit && overflow === "throw")
    throw new BitrixError(
      "QUERY_TOO_LARGE",
      "A consulta excedeu o limite deste MVP. Selecione um pipeline ou reduza o período.",
      422,
    );
  const step = Math.max(1, items.length);
  // Leitura completa: uma página extra de folga cobre registros que entrem
  // entre a primeira chamada e o lote (as repetições são descartadas pelo ID).
  const wanted = total > limit ? limit : total + (idField ? step : 0);
  const starts: number[] = [];
  for (let start = Number(next); start < wanted; start += step) starts.push(start);
  const groups: number[][] = [];
  for (let i = 0; i < starts.length; i += 50) groups.push(starts.slice(i, i + 50));
  const pages = await Promise.all(
    groups.map((group) =>
      batch(
        session,
        group.map((start) => ({
          method,
          query: { ...params, start },
          as: `page_${start}`,
        })),
      ),
    ),
  );
  const all = [...items, ...pages.flat().flatMap((page) => unwrapNested<T>(page, key))];
  const seen = new Set<string>();
  const unique = idField
    ? all.filter((item) => {
        const id = String((item as Record<string, unknown>)[idField]);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
    : all;
  return { items: unique.slice(0, limit), total };
}
