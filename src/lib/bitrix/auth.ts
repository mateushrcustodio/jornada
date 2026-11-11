import "server-only";
import { timingSafeEqual } from "node:crypto";
import { rest } from "./client";
import { credentials } from "./config";
import { BitrixError } from "./errors";
import type { Session } from "./session";
export function secretEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export async function verifyApp(session: Session) {
  const { clientId } = credentials();
  const info = await rest<{ CODE: string }>(session, "app.info");
  if (info.result.CODE !== (process.env.BITRIX_APP_CODE || clientId))
    throw new BitrixError(
      "APP_CONTEXT",
      "A autorização não pertence a esta aplicação Bitrix24.",
      403,
    );
  if (
    process.env.BITRIX_MEMBER_ID &&
    session.memberId !== process.env.BITRIX_MEMBER_ID
  )
    throw new BitrixError(
      "MEMBER_CONTEXT",
      "A instalação não corresponde ao portal configurado.",
      403,
    );
}
/**
 * ID do usuário dono do token (método profile, escopo básico). Serve só para
 * reaproveitar sessão e cache do mesmo usuário; se falhar, o app segue sem
 * reaproveitar nada.
 */
export async function identifyUser(session: Session) {
  try {
    const profile = await rest<{ ID?: string | number }>(session, "profile");
    const id = Number(profile.result?.ID);
    return Number.isInteger(id) && id > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}
