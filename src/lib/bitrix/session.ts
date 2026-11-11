import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { BitrixError } from "./errors";
import type { Catalog, Deal, HistoryEntry } from "../types";
export interface MovementRows {
  key: string;
  expiresAt: number;
  rows: HistoryEntry[];
  total: number;
  truncated: boolean;
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
  refreshPending?: Promise<void>;
}
// Uma instância Node, sem persistência. Reinícios exigem reabrir o app no portal.
const globalSessions = globalThis as unknown as {
  jornadaSessions?: Map<string, Session>;
};
export const sessions = (globalSessions.jornadaSessions ??= new Map());
export const SESSION_COOKIE = "jornada_session";
export function cookieOptions() {
  const secure = process.env.APP_URL?.startsWith("https://") === true;
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? ("none" as const) : ("lax" as const),
    partitioned: secure,
    path: "/",
    maxAge: 8 * 3600,
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
const sameUser = (session: Session, data: SessionData) =>
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
 */
export function openSession(
  data: SessionData,
  currentId?: string,
): { session: Session; reused: boolean } {
  const current = currentId ? sessions.get(currentId) : undefined;
  if (current && sameUser(current, data)) {
    current.accessToken = data.accessToken;
    current.refreshToken = data.refreshToken;
    current.tokenExpiresAt = data.tokenExpiresAt;
    current.expiresAt = Date.now() + 8 * 3600000;
    return { session: current, reused: true };
  }
  return { session: createSession(data), reused: false };
}
export function createSession(data: SessionData): Session {
  for (const [id, session] of sessions)
    if (session.expiresAt <= Date.now()) sessions.delete(id);
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
    id: randomBytes(32).toString("hex"),
    expiresAt: Date.now() + 8 * 3600000,
    ...(donor && {
      catalog: donor.catalog,
      userNames: donor.userNames,
      closedSample: donor.closedSample,
    }),
  };
  sessions.set(session.id, session);
  return session;
}
export function sessionIdFromCookieHeader(header: string | null) {
  for (const part of (header || "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=") || undefined;
  }
  return undefined;
}
export async function getSession() {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = id ? sessions.get(id) : undefined;
  if (!session || session.expiresAt <= Date.now()) {
    if (id) sessions.delete(id);
    throw new BitrixError(
      "SESSION_REQUIRED",
      "Abra a aplicação pelo Bitrix24 ou conecte seu portal para iniciar uma sessão.",
      401,
    );
  }
  return session;
}
