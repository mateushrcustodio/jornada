import { NextResponse } from "next/server";
import { getBenchmark } from "@/lib/bitrix/service";
import { errorResponse } from "@/lib/http";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    if (!/^[1-9]\d{0,9}$/.test(id))
      return NextResponse.json(
        { error: "ID do negócio inválido." },
        { status: 400 },
      );
    return NextResponse.json(await getBenchmark(Number(id)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
