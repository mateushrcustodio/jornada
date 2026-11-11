import { NextResponse } from "next/server";
import { z } from "zod";
import { appUrl, isDemo, validateDomain } from "@/lib/bitrix/config";
import { identifyUser, secretEqual, verifyApp } from "@/lib/bitrix/auth";
import {
  cookieOptions,
  openSession,
  SESSION_COOKIE,
  sessionIdFromCookieHeader,
  type Session,
} from "@/lib/bitrix/session";
import { getCatalog } from "@/lib/bitrix/service";
import { errorResponse } from "@/lib/http";
import { BitrixError } from "@/lib/bitrix/errors";

const schema = z.object({
  DOMAIN: z.string().max(253),
  AUTH_ID: z.string().min(1).max(4096),
  REFRESH_ID: z.string().min(1).max(4096),
  AUTH_EXPIRES: z.coerce.number().positive().max(86400),
  member_id: z.string().min(1).max(256),
  PLACEMENT: z
    .enum(["CRM_ANALYTICS_MENU", "CRM_DEAL_DETAIL_TAB", "DEFAULT"])
    .default("DEFAULT"),
  PLACEMENT_OPTIONS: z.unknown().optional(),
  APPLICATION_TOKEN: z.string().optional(),
});
export async function POST(request: Request) {
  try {
    if (isDemo())
      throw new BitrixError(
        "DEMO_MODE",
        "Desative DEMO_MODE no servidor antes de instalar a integração real.",
        409,
      );
    const url = new URL(request.url);
    const params: Record<string, unknown> = Object.fromEntries(
      url.searchParams,
    );
    if (Number(request.headers.get("content-length") || 0) > 65536)
      throw new BitrixError(
        "BODY_SIZE",
        "Contexto de instalação inválido.",
        413,
      );
    const body = request.headers
      .get("content-type")
      ?.includes("application/json")
      ? await request.json()
      : Object.fromEntries(await request.formData());
    Object.assign(params, body);
    // Algumas instalações enviam auth[...] em vez dos parâmetros de widget.
    for (const [key, source] of Object.entries({
      AUTH_ID: "access_token",
      REFRESH_ID: "refresh_token",
      AUTH_EXPIRES: "expires_in",
      DOMAIN: "domain",
      member_id: "member_id",
      APPLICATION_TOKEN: "application_token",
    })) {
      const nested =
        typeof params.auth === "object" && params.auth
          ? (params.auth as Record<string, unknown>)[source]
          : undefined;
      params[key] ??= params[`auth[${source}]`] ?? nested;
    }
    const input = schema.parse(params);
    const domain = validateDomain(input.DOMAIN);
    const origin = request.headers.get("origin");
    if (origin && origin !== `https://${domain}`)
      throw new BitrixError(
        "ORIGIN",
        "Origem do contexto Bitrix24 não autorizada.",
        403,
      );
    if (
      process.env.BITRIX_APPLICATION_TOKEN &&
      !secretEqual(
        input.APPLICATION_TOKEN || "",
        process.env.BITRIX_APPLICATION_TOKEN,
      )
    )
      throw new BitrixError("APP_TOKEN", "Token de instalação inválido.", 403);
    let target =
      url.searchParams.get("install") === "1" ? "/install" : "/dashboard";
    if (input.PLACEMENT === "CRM_DEAL_DETAIL_TAB") {
      const options = z
        .object({
          ID: z.union([
            z.string().regex(/^[1-9]\d{0,9}$/),
            z.number().int().positive().max(9999999999),
          ]),
        })
        .parse(
          typeof input.PLACEMENT_OPTIONS === "string"
            ? JSON.parse(input.PLACEMENT_OPTIONS)
            : input.PLACEMENT_OPTIONS,
        );
      target = `/deal/${options.ID}/journey`;
    }
    const data = {
      domain,
      memberId: input.member_id,
      accessToken: input.AUTH_ID,
      refreshToken: input.REFRESH_ID,
      tokenExpiresAt: Date.now() + input.AUTH_EXPIRES * 1000,
    };
    const pending = {
      ...data,
      id: "pending",
      expiresAt: Date.now() + 60000,
    } as Session;
    // As duas consultas saem juntas; o limitador do portal permite a rajada.
    const [, userId] = await Promise.all([
      verifyApp(pending),
      identifyUser(pending),
    ]);
    const { session } = openSession(
      { ...data, userId },
      sessionIdFromCookieHeader(request.headers.get("cookie")),
    );
    // Adianta o catálogo (pipelines e etapas) enquanto o navegador segue o
    // redirect e carrega a página; a próxima consulta reaproveita a promessa.
    if (target !== "/install") getCatalog(session).catch(() => undefined);
    const destination = new URL(target, appUrl());
    // Apenas contexto público do SDK, nunca AUTH_ID, REFRESH_ID ou APPLICATION_TOKEN.
    if (target === "/install" && typeof params.APP_SID === "string") {
      destination.searchParams.set("APP_SID", params.APP_SID);
      destination.searchParams.set("DOMAIN", domain);
      destination.searchParams.set("PROTOCOL", "1");
    }
    const response = NextResponse.redirect(destination, 303);
    response.cookies.set(SESSION_COOKIE, session.id, cookieOptions());
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
export async function GET() {
  return NextResponse.redirect(new URL("/dashboard", appUrl()), 303);
}
