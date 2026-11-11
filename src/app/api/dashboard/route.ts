import { z } from "zod";
import { NextResponse } from "next/server";
import { filtersSchema, settingsSchema } from "@/lib/settings";
import { getDashboard } from "@/lib/bitrix/service";
import { assertSameOrigin, errorResponse } from "@/lib/http";
const schema = z.object({ filters: filtersSchema, settings: settingsSchema });
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { filters, settings } = schema.parse(await request.json());
    return NextResponse.json(await getDashboard(filters, settings), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
