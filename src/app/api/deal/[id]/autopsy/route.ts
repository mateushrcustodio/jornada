import { NextResponse } from "next/server";
import { publishAutopsy } from "@/lib/bitrix/service";
import { assertSameOrigin, errorResponse } from "@/lib/http";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    if (!/^[1-9]\d{0,9}$/.test(id))
      return NextResponse.json(
        { error: "ID do negócio inválido." },
        { status: 400 },
      );
    return NextResponse.json(await publishAutopsy(Number(id)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
