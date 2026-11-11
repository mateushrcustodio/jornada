import { z } from "zod";
import { NextResponse } from "next/server";
import { filtersSchema, settingsSchema } from "@/lib/settings";
import { getMovementsPage, getStalledPage } from "@/lib/bitrix/service";
import { assertSameOrigin, errorResponse } from "@/lib/http";
const schema = z.object({
  filters: filtersSchema,
  settings: settingsSchema,
  kind: z.enum(["movements", "stalled"]),
  page: z.number().int().min(1).max(100000),
  // Instante da consulta no navegador; "Atualizar" o renova e invalida a
  // lista de movimentações guardada na sessão.
  asOf: z.number().int().nonnegative().optional(),
});
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { filters, settings, kind, page, asOf } = schema.parse(
      await request.json(),
    );
    const data =
      kind === "movements"
        ? await getMovementsPage(filters, settings, page, asOf)
        : await getStalledPage(filters, settings, page);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
