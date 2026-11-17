import { z } from "zod";
import { NextResponse } from "next/server";
import {
  filtersSchema,
  settingsSchema,
  sortSchema,
  stalledSortSchema,
} from "@/lib/settings";
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
  // Ordenação de Movimentações (faturamento ou data) e de Parados
  // (faturamento ou tempo parado); cada lista lê só a sua.
  sort: sortSchema.optional(),
  stalledSort: stalledSortSchema.optional(),
});
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { filters, settings, kind, page, asOf, sort, stalledSort } =
      schema.parse(await request.json());
    const data =
      kind === "movements"
        ? await getMovementsPage(filters, settings, page, asOf, sort)
        : await getStalledPage(filters, settings, page, stalledSort);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
