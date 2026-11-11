import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { BitrixError } from "./errors";
import type { Catalog, Deal, HistoryEntry } from "../types";
export interface Session {
  id: string;
  domain: string;
  memberId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  expiresAt: number;
  catalog?: { data: Catalog; expiresAt: number };
  userNames?: Map<number, string>;
  // Amostra de negócios fechados usada na autópsia. Fica na sessão do usuário
  // porque a lista respeita as permissões de leitura de quem consultou.
  closedSample?: {
    key: string;
    expiresAt: number;
    deals: Deal[];
    history: HistoryEntry[];
  };
  refreshPending?: Promise<void>;
  nextRequestAt?: number;
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
export function createSession(
  data: Omit<Session, "id" | "expiresAt">,
): Session {
  for (const [id, session] of sessions)
    if (session.expiresAt <= Date.now()) sessions.delete(id);
  if (sessions.size >= 1000)
    throw new BitrixError(
      "CAPACITY",
      "Limite de sessões temporárias atingido. Tente novamente mais tarde.",
      503,
    );
  const session = {
    ...data,
    id: randomBytes(32).toString("hex"),
    expiresAt: Date.now() + 8 * 3600000,
  };
  sessions.set(session.id, session);
  return session;
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
