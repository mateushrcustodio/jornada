import "server-only";
import { NextResponse } from "next/server";
import { appUrl } from "./bitrix/config";
import { BitrixError, publicError } from "./bitrix/errors";
import { ZodError } from "zod";
export function assertSameOrigin(request: Request) {
  if (
    request.headers.get("origin") !== appUrl() ||
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
