import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import {
  allowedDomains,
  appUrl,
  credentials,
  validateDomain,
} from "@/lib/bitrix/config";
import { errorResponse } from "@/lib/http";
export async function GET(request: Request) {
  try {
    const domain = validateDomain(
      new URL(request.url).searchParams.get("domain") ||
        allowedDomains()[0] ||
        "",
    );
    const { clientId } = credentials();
    const state = randomBytes(32).toString("hex");
    const redirect = new URL(`https://${domain}/oauth/authorize/`);
    redirect.searchParams.set("client_id", clientId);
    redirect.searchParams.set("response_type", "code");
    redirect.searchParams.set("redirect_uri", `${appUrl()}/api/auth/callback`);
    redirect.searchParams.set("state", `${state}.${domain}`);
    const response = NextResponse.redirect(redirect);
    response.cookies.set("jornada_oauth_state", `${state}.${domain}`, {
      httpOnly: true,
      secure: appUrl().startsWith("https:"),
      sameSite: "lax",
      path: "/api/auth",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
