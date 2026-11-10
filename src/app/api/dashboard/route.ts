import { z } from "zod";
import { NextResponse } from "next/server";
import { settingsSchema } from "@/lib/settings";
import { getDashboard } from "@/lib/bitrix/service";
import { assertSameOrigin, errorResponse } from "@/lib/http";
const schema = z.object({
  filters: z
    .object({
      from: z.iso.datetime({ offset: true }),
      to: z.iso.datetime({ offset: true }),
      pipeline: z.number().int().nonnegative().optional(),
      stage: z.string().max(100).optional(),
    })
    .refine(
      (f) =>
        Date.parse(f.from) <= Date.parse(f.to) &&
        Date.parse(f.to) - Date.parse(f.from) <= 366 * 86400000,
    ),
  settings: settingsSchema,
});
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
