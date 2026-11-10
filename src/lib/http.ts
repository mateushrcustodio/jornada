import "server-only";
import { NextResponse } from "next/server";
import { appUrl } from "./bitrix/config";
import { BitrixError, publicError } from "./bitrix/errors";
import { ZodError } from "zod";
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const allowedOrigins = new Set([appUrl()]);
  if (process.env.NODE_ENV !== "production") {
    allowedOrigins.add("http://localhost:3000");
    allowedOrigins.add("http://127.0.0.1:3000");
  }
  if (
    !origin ||
    !allowedOrigins.has(origin) ||
    !request.headers.get("content-type")?.includes("application/json")
  )
    throw new BitrixError(
      "ORIGIN",
      "Origem da requisição não autorizada.",
      403,
    );
}
export function errorResponse(error: unknown) {
  if (error instanceof ZodError || error instanceof SyntaxError)
    return NextResponse.json(
      {
        error: "Parâmetros inválidos. Verifique os filtros e tente novamente.",
        code: "VALIDATION",
      },
      { status: 400 },
    );
  const { status, ...body } = publicError(error);
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
