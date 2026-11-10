import "server-only";
import type {
  Catalog,
  Deal,
  Filters,
  HistoryEntry,
  RawCategory,
  RawStatus,
  Settings,
} from "../types";
import { buildDashboard, buildJourney } from "../calculations";
import { demoDataset } from "../demo";
import { isDemo } from "./config";
import { getSession, type Session } from "./session";
import { listAll, rest, unwrap } from "./client";
import { BitrixError } from "./errors";

export async function getCatalog(providedSession?: Session): Promise<Catalog> {
  if (isDemo()) return demoDataset().catalog;
  const session = providedSession ?? (await getSession());
  if (session.catalog && session.catalog.expiresAt > Date.now())
    return session.catalog.data;
  const pipelines = await listAll<RawCategory>(
    session,
    "crm.category.list",
    { entityTypeId: 2 },
    "categories",
  );
  const stages = [];
  for (const pipeline of pipelines) {
    const result = await rest<RawStatus[]>(session, "crm.status.entity.items", {
      entityId:
        Number(pipeline.id) === 0 ? "DEAL_STAGE" : `DEAL_STAGE_${pipeline.id}`,
    });
    // O diretório nem sempre retorna cores. O índice ordenado mantém uma paleta
    // consistente na sessão, sem transformar uma cor visual em dado do CRM.
    const palette = [
      "#7894bd",
      "#5c82e2",
      "#a48bd4",
      "#e3a255",
      "#4e9e85",
      "#c97979",
    ];
    for (const [index, s] of unwrap<RawStatus>(result.result).entries())
      stages.push({
        id: s.STATUS_ID,
        name: s.NAME,
        categoryId: Number(pipeline.id),
        color: /^#[0-9a-f]{6}$/i.test(s.COLOR || s.EXTRA?.COLOR || "")
          ? s.COLOR || s.EXTRA!.COLOR!
          : palette[index % palette.length],
        sort: Number(s.SORT),
      });
  }
  const data = {
    pipelines: pipelines.map((p) => ({ id: Number(p.id), name: p.name })),
    stages: stages.sort((a, b) => a.sort - b.sort),
  };
  session.catalog = { data, expiresAt: Date.now() + 5 * 60000 };
  return data;
}
const historySelect = [
  "ID",
  "OWNER_ID",
  "CATEGORY_ID",
  "STAGE_ID",
  "STAGE_SEMANTIC_ID",
  "CREATED_TIME",
];
const dealSelect = [
  "id",
  "title",
  "categoryId",
  "stageId",
  "stageSemanticId",
  "movedTime",
  "movedBy",
];
function normalizeHistory(rows: HistoryEntry[]): HistoryEntry[] {
  return rows.map((r) => ({
    ...r,
    ID: Number(r.ID),
    OWNER_ID: Number(r.OWNER_ID),
    CATEGORY_ID: Number(r.CATEGORY_ID),
  }));
}
function normalizeDeals(rows: Deal[]): Deal[] {
  return rows.map((d) => ({
    ...d,
    id: Number(d.id),
    categoryId: Number(d.categoryId),
  }));
}
export async function getDashboard(filters: Filters, settings: Settings) {
  const now = Date.now();
  if (isDemo()) {
    const data = demoDataset(now);
    return buildDashboard(
      data.deals,
      data.history,
      data.catalog,
      filters,
      settings,
      now,
      true,
    );
  }
  const session = await getSession();
  const catalog = await getCatalog(session);
  const pipelineFilter =
    filters.pipeline !== undefined
      ? filters.pipeline
      : settings.monitoredPipelines.length
        ? settings.monitoredPipelines
        : undefined;
  const historyFilter: Record<string, unknown> = {
    ">=CREATED_TIME": filters.from,
    "<=CREATED_TIME": filters.to,
  };
  const activeFilter: Record<string, unknown> = { stageSemanticId: "P" };
  if (pipelineFilter !== undefined) {
    historyFilter.CATEGORY_ID = pipelineFilter;
    activeFilter.categoryId = pipelineFilter;
  }
  if (filters.stage) {
    historyFilter.STAGE_ID = filters.stage;
    activeFilter.stageId = filters.stage;
  }
  const recent = normalizeHistory(
    await listAll<HistoryEntry>(session, "crm.stagehistory.list", {
      entityTypeId: 2,
      filter: historyFilter,
      select: historySelect,
      order: { CREATED_TIME: "DESC", ID: "DESC" },
    }),
  );
  // Sem filtro de data aqui: negócios sem movimentação no período também podem estar parados.
  const active = normalizeDeals(
    await listAll<Deal>(
      session,
      "crm.item.list",
      { entityTypeId: 2, filter: activeFilter, select: dealSelect },
      "items",
      500,
    ),
  );
  const ids = [
    ...new Set([...recent.map((h) => h.OWNER_ID), ...active.map((d) => d.id)]),
  ];
  if (ids.length > 500)
    throw new BitrixError(
      "QUERY_TOO_LARGE",
      "Mais de 500 negócios na consulta. Selecione um pipeline ou reduza o período.",
      422,
    );
  const deals: Deal[] = [];
  const history: HistoryEntry[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    // A consulta de itens confirma o acesso antes de retornar qualquer histórico ao navegador.
    const readable = normalizeDeals(
      await listAll<Deal>(session, "crm.item.list", {
        entityTypeId: 2,
        filter: { "@id": ids.slice(i, i + 50) },
        select: dealSelect,
      }),
    );
    deals.push(...readable);
    if (readable.length)
      history.push(
        ...normalizeHistory(
          await listAll<HistoryEntry>(session, "crm.stagehistory.list", {
            entityTypeId: 2,
            filter: { OWNER_ID: readable.map((d) => d.id) },
            select: historySelect,
            order: { CREATED_TIME: "ASC", ID: "ASC" },
          }),
        ),
      );
    if (history.length > 10000)
      throw new BitrixError(
        "QUERY_TOO_LARGE",
        "Histórico muito extenso para este MVP. Selecione um pipeline ou reduza o período.",
        422,
      );
  }
  return buildDashboard(
    deals,
    history,
    catalog,
    filters,
    settings,
    Date.now(),
    false,
    session.domain,
  );
}
export async function getJourney(id: number) {
  if (isDemo()) {
    const { catalog, deals, history } = demoDataset();
    const deal = deals.find((d) => d.id === id);
    if (!deal)
      throw new BitrixError(
        "NOT_FOUND",
        "Negócio não encontrado nesta demonstração.",
        404,
      );
    return buildJourney(deal, history, catalog, Date.now(), true);
  }
  const session = await getSession();
  const item = await rest<{ item: Deal }>(session, "crm.item.get", {
    entityTypeId: 2,
    id,
  });
  if (!item.result.item)
    throw new BitrixError(
      "NOT_FOUND",
      "Negócio não encontrado ou sem permissão de acesso.",
      404,
    );
  const catalog = await getCatalog(session);
  const history = normalizeHistory(
    await listAll<HistoryEntry>(session, "crm.stagehistory.list", {
      entityTypeId: 2,
      filter: { OWNER_ID: id },
      order: { CREATED_TIME: "ASC", ID: "ASC" },
      select: historySelect,
    }),
  );
  return buildJourney(
    normalizeDeals([item.result.item])[0],
    history,
    catalog,
    Date.now(),
    false,
    session.domain,
  );
}
