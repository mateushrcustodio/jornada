import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { cookies } from "next/headers";
import { BitrixError } from "./errors";
import type { Catalog, Deal, HistoryEntry, UserOption } from "../types";
export interface MovementRows {
  key: string;
  expiresAt: number;
  rows: HistoryEntry[];
  total: number;
  truncated: boolean;
}
// Negócios (responsável, valor...) das movimentações do período, lidos só
// quando a lista é filtrada ou ordenada por campos do negócio.
export interface MovementDeals {
  key: string;
  expiresAt: number;
  deals: Map<number, Deal>;
}
export interface Session {
  id: string;
  domain: string;
  memberId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  expiresAt: number;
  // ID do usuário no portal (método profile). Sem ele, nenhuma sessão é
  // reaproveitada nem herda cache, para não misturar dados entre usuários.
  userId?: number;
  catalog?: { data: Catalog; expiresAt: number };
  catalogPending?: Promise<Catalog>;
  userNames?: Map<number, string>;
  // Pessoas ativas do portal, para o filtro "Responsável".
  users?: { data: UserOption[]; expiresAt: number };
  // Amostra de negócios fechados usada na autópsia. Fica na sessão do usuário
  // porque a lista respeita as permissões de leitura de quem consultou.
  closedSample?: {
    key: string;
    expiresAt: number;
    deals: Deal[];
    history: HistoryEntry[];
  };
  closedSamplePending?: {
    key: string;
    promise: Promise<{ deals: Deal[]; history: HistoryEntry[] }>;
  };
  // Linhas do histórico do período (só a lista, sem ler cada negócio) para
  // paginar Movimentações sem refazer a leitura a cada página.
  movementRows?: MovementRows;
  movementRowsPending?: { key: string; promise: Promise<MovementRows> };
  movementDeals?: MovementDeals;
  movementDealsPending?: { key: string; promise: Promise<Map<number, Deal>> };
  // Histórico completo de negócios ativos já lido, guardado com o movedTime do
  // negócio no momento da leitura. Enquanto o movedTime não muda, atualizar o
  // painel não precisa reler o histórico desse negócio.
  dealHistory?: Map<number, DealHistoryCache>;
  refreshPending?: Promise<void>;
}
export interface DealHistoryCache {
  movedTime: string;
  lastId: number;
  expiresAt: number;
  rows: HistoryEntry[];
}
// Os dados de login (tokens, portal, usuário) viajam criptografados no próprio
// cookie, então qualquer instância do servidor (ex.: funções da Vercel) consegue
// reabrir a sessão. O Map abaixo é só um cache por instância: guarda caches de
// catálogo, nomes e históricos e os tokens já renovados. Se a requisição cair numa
// instância que não conhece a sessão, ela é recriada a partir do cookie.
const globalSessions = globalThis as unknown as {
  jornadaSessions?: Map<string, Session>;
};
export const sessions = (globalSessions.jornadaSessions ??= new Map());
export const SESSION_COOKIE = "jornada_session";
const SESSION_TTL = 8 * 3600000;
export function cookieOptions() {
  const secure = process.env.APP_URL?.startsWith("https://") === true;
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? ("none" as const) : ("lax" as const),
    partitioned: secure,
    path: "/",
    maxAge: SESSION_TTL / 1000,
  };
}
type SessionData = Pick<
  Session,
  | "domain"
  | "memberId"
  | "accessToken"
  | "refreshToken"
  | "tokenExpiresAt"
  | "userId"
>;
/** O que vai (criptografado) no cookie: identidade da sessão e tokens. */
export type SealedSession = SessionData & Pick<Session, "id" | "expiresAt">;
const SEAL_VERSION = "v1";
const SEAL_AAD = Buffer.from(SESSION_COOKIE);
/**
 * Chave AES-256 do cookie. Usa SESSION_SECRET quando definida; senão deriva
 * do BITRIX_CLIENT_SECRET (já é segredo só do servidor), para não exigir
 * variável nova. Trocar qualquer um dos dois invalida as sessões abertas.
 */
function sessionKey() {
  const own = process.env.SESSION_SECRET;
  const secret = own || process.env.BITRIX_CLIENT_SECRET || "";
  if (!secret || (own !== undefined && own !== "" && own.length < 32))
    throw new BitrixError(
      "CONFIGURATION",
      "Configure SESSION_SECRET (32+ caracteres) ou BITRIX_CLIENT_SECRET no servidor.",
      503,
    );
  return Buffer.from(
    hkdfSync("sha256", secret, "jornada-session", SEAL_VERSION, 32),
  );
}
export function sealSession(session: SealedSession) {
  const payload: SealedSession = {
    id: session.id,
    domain: session.domain,
    memberId: session.memberId,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    tokenExpiresAt: session.tokenExpiresAt,
    expiresAt: session.expiresAt,
    ...(session.userId !== undefined && { userId: session.userId }),
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionKey(), iv);
  cipher.setAAD(SEAL_AAD);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return `${SEAL_VERSION}.${Buffer.concat([iv, data, cipher.getAuthTag()]).toString("base64url")}`;
}
/** Abre o cookie; qualquer adulteração, chave diferente ou formato inválido vira undefined. */
export function unsealSession(value: string): SealedSession | undefined {
  try {
    const [version, body] = value.split(".");
    if (version !== SEAL_VERSION || !body) return undefined;
    const raw = Buffer.from(body, "base64url");
    if (raw.length < 12 + 16 + 2) return undefined;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      sessionKey(),
      raw.subarray(0, 12),
    );
    decipher.setAAD(SEAL_AAD);
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    const json = Buffer.concat([
      decipher.update(raw.subarray(12, raw.length - 16)),
      decipher.final(),
    ]).toString("utf8");
    const data = JSON.parse(json) as SealedSession;
    if (
      typeof data.id !== "string" ||
      !/^[a-f0-9]{64}$/.test(data.id) ||
      typeof data.domain !== "string" ||
      typeof data.memberId !== "string" ||
      typeof data.accessToken !== "string" ||
      typeof data.refreshToken !== "string" ||
      typeof data.tokenExpiresAt !== "number" ||
      typeof data.expiresAt !== "number" ||
      (data.userId !== undefined && !Number.isInteger(data.userId))
    )
      return undefined;
    return data;
  } catch (error) {
    if (error instanceof BitrixError) throw error;
    return undefined;
  }
}
/** Valor do cookie de sessão (criptografado); nunca contém tokens em texto puro. */
export const sessionCookieValue = (session: Session) => sealSession(session);
/** ID estável da sessão guardado no cookie (o valor do cookie muda a cada gravação). */
export function sessionIdFromCookieValue(value?: string) {
  return value ? unsealSession(value)?.id : undefined;
}
/**
 * Depois de renovar o token, regrava o cookie para que as outras instâncias
 * usem o refresh token novo. Fora de uma rota (ex.: tarefa em segundo plano)
 * não há resposta para gravar, e a renovação segue só na memória.
 */
export async function persistSessionCookie(session: Session) {
  if (session.id === "pending") return;
  try {
    (await cookies()).set(
      SESSION_COOKIE,
      sessionCookieValue(session),
      cookieOptions(),
    );
  } catch {
    // sem contexto de requisição ou resposta já enviada
  }
}
const sameUser = (session: SealedSession, data: SessionData) =>
  data.userId !== undefined &&
  session.userId === data.userId &&
  session.domain === data.domain &&
  session.memberId === data.memberId &&
  session.expiresAt > Date.now();
/**
 * Cada abertura do app no Bitrix24 (menu ou aba do card) envia um POST novo.
 * Quando o cookie já aponta para uma sessão válida do mesmo usuário e portal,
 * só os tokens são trocados: os caches (catálogo, nomes, amostra da autópsia)
 * continuam valendo e o limite de sessões não é consumido a cada clique.
 * `currentCookie` é o valor bruto (criptografado) do cookie recebido.
 */
export function openSession(
  data: SessionData,
  currentCookie?: string,
): { session: Session; reused: boolean } {
  const sealed = currentCookie ? unsealSession(currentCookie) : undefined;
  const current = sealed ? sessions.get(sealed.id) : undefined;
  if (current && sameUser(current, data)) {
    current.accessToken = data.accessToken;
    current.refreshToken = data.refreshToken;
    current.tokenExpiresAt = data.tokenExpiresAt;
    current.expiresAt = Date.now() + SESSION_TTL;
    return { session: current, reused: true };
  }
  // Sessão aberta em outra instância: mantém o mesmo ID.
  if (sealed && !current && sameUser(sealed, data))
    return { session: createSession(data, sealed.id), reused: true };
  return { session: createSession(data), reused: false };
}
export function createSession(
  data: SessionData,
  id = randomBytes(32).toString("hex"),
  expiresAt = Date.now() + SESSION_TTL,
): Session {
  for (const [key, session] of sessions)
    if (session.expiresAt <= Date.now()) sessions.delete(key);
  if (sessions.size >= 1000)
    throw new BitrixError(
      "CAPACITY",
      "Limite de sessões temporárias atingido. Tente novamente mais tarde.",
      503,
    );
  // Outra sessão viva do mesmo usuário (ex.: outro navegador) cede os caches.
  let donor: Session | undefined;
  for (const candidate of sessions.values())
    if (sameUser(candidate, data)) donor = candidate;
  const session: Session = {
    ...data,
    id,
    expiresAt,
    ...(donor && {
      catalog: donor.catalog,
      userNames: donor.userNames,
      users: donor.users,
      closedSample: donor.closedSample,
    }),
  };
  sessions.set(session.id, session);
  return session;
}
/** Valor bruto (criptografado) do cookie de sessão num cabeçalho Cookie. */
export function sessionCookieFromHeader(header: string | null) {
  for (const part of (header || "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=") || undefined;
  }
  return undefined;
}
export async function getSession() {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  const sealed = value ? unsealSession(value) : undefined;
  if (!sealed || sealed.expiresAt <= Date.now()) {
    if (sealed) sessions.delete(sealed.id);
    throw new BitrixError(
      "SESSION_REQUIRED",
      "Abra a aplicação pelo Bitrix24 ou conecte seu portal para iniciar uma sessão.",
      401,
    );
  }
  const current = sessions.get(sealed.id);
  if (current && current.expiresAt > Date.now()) {
    // O cookie pode trazer tokens mais novos (renovados ou app reaberto em
    // outra instância); a memória pode trazer os mais novos desta instância.
    if (sealed.tokenExpiresAt > current.tokenExpiresAt) {
      current.accessToken = sealed.accessToken;
      current.refreshToken = sealed.refreshToken;
      current.tokenExpiresAt = sealed.tokenExpiresAt;
    }
    current.expiresAt = Math.max(current.expiresAt, sealed.expiresAt);
    return current;
  }
  // Instância nova (ou reiniciada): recria a sessão a partir do cookie.
  const { id, expiresAt, ...data } = sealed;
  return createSession(data, id, expiresAt);
}
