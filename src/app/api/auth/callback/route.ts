import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { appUrl, validateDomain } from "@/lib/bitrix/config";
import { exchangeToken } from "@/lib/bitrix/client";
import { secretEqual, verifyApp } from "@/lib/bitrix/auth";
import {
  cookieOptions,
  createSession,
  SESSION_COOKIE,
  type Session,
} from "@/lib/bitrix/session";
import { BitrixError } from "@/lib/bitrix/errors";
import { errorResponse } from "@/lib/http";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const state = params.get("state") || "";
    const cookie = (await cookies()).get("jornada_oauth_state")?.value || "";
    if (!state || !cookie || !secretEqual(state, cookie))
      throw new BitrixError(
        "OAUTH_STATE",
        "A autorização não pôde ser validada. Inicie a conexão novamente.",
        403,
      );
    (await cookies()).delete({
      name: "jornada_oauth_state",
      path: "/api/auth",
    });
    const domain = validateDomain(state.slice(state.indexOf(".") + 1));
    const code = params.get("code");
    if (!code || code.length > 4096)
      throw new BitrixError(
        "OAUTH_CODE",
        "O portal não autorizou a conexão.",
        401,
      );
    const token = await exchangeToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${appUrl()}/api/auth/callback`,
    });
    if (token.domain && validateDomain(token.domain) !== domain)
      throw new BitrixError(
        "OAUTH_DOMAIN",
        "Portal de autorização inválido.",
        403,
      );
    const data = {
      domain,
      memberId: token.member_id,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenExpiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
    };
    await verifyApp({
      ...data,
      id: "pending",
      expiresAt: Date.now() + 60000,
    } as Session);
    const session = createSession(data);
    const response = NextResponse.redirect(
      new URL("/dashboard", appUrl()),
      303,
    );
    response.cookies.set(SESSION_COOKIE, session.id, cookieOptions());
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
