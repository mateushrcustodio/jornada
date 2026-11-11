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
import { buildDashboard, buildJourney, isClosed } from "../calculations";
import {
  autopsyText,
  buildAutopsy,
  buildBenchmark,
  type Benchmark,
} from "../autopsy";
import { demoDataset } from "../demo";
import { isDemo } from "./config";
import { getSession, type Session } from "./session";
import { batch, listAll, listPage, rest, unwrap } from "./client";
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
  let statusResults: unknown[];
  try {
    statusResults = await batch(
      session,
      pipelines.map((pipeline) => ({
        method: "crm.status.entity.items",
        query: {
          entityId:
            Number(pipeline.id) === 0
              ? "DEAL_STAGE"
              : `DEAL_STAGE_${pipeline.id}`,
        },
        as: `pipeline_${pipeline.id}`,
      })),
    );
  } catch {
    // Alguns portais/versões retornam um envelope de batch incompatível;
    // o catálogo continua disponível via chamadas individuais.
    statusResults = await Promise.all(
      pipelines.map((pipeline) =>
        rest<RawStatus[]>(session, "crm.status.entity.items", {
          entityId:
            Number(pipeline.id) === 0
              ? "DEAL_STAGE"
              : `DEAL_STAGE_${pipeline.id}`,
        }),
      ),
    );
  }
  for (const [pipelineIndex, pipeline] of pipelines.entries()) {
    const result = statusResults[pipelineIndex];
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
    for (const [index, s] of unwrapBatch<RawStatus>(result).entries())
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
  "MOVED_BY",
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
    MOVED_BY:
      r.MOVED_BY === undefined || r.MOVED_BY === null
        ? undefined
        : Number(r.MOVED_BY),
  }));
}

type RawUser = {
  ID: string | number;
  NAME?: string;
  LAST_NAME?: string;
  SECOND_NAME?: string;
};

function userDisplayName(user: RawUser) {
  return [user.NAME, user.SECOND_NAME, user.LAST_NAME]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
}

async function resolveHistoryActors(
  session: Session,
  rows: HistoryEntry[],
  fallbackDeals: Deal[] = [],
): Promise<HistoryEntry[]> {
  const ids = [
    ...new Set(
      [
        ...rows.map((row) => Number(row.MOVED_BY)),
        ...fallbackDeals.map((deal) => Number(deal.movedBy)),
      ]
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
  if (!ids.length) return rows;
  const names = (session.userNames ??= new Map<number, string>());
  const pendingIds = ids.filter((id) => !names.has(id));
  try {
    for (let index = 0; index < pendingIds.length; index += 50) {
      const responses = await batch(
        session,
        pendingIds.slice(index, index + 50).map((id) => ({
          method: "user.get",
          query: { FILTER: { ID: id } },
          as: `user_${id}`,
        })),
      );
      responses.forEach((response, responseIndex) => {
        const id = pendingIds[index + responseIndex];
        const user = unwrapBatch<RawUser>(response)[0];
        if (!user) return;
        const name = userDisplayName(user);
        if (name) names.set(id, name);
      });
    }
  } catch {
    // A falha de permissão em user.get não deve impedir a leitura do histórico.
  }
  return rows.map((row) => ({
    ...row,
    MOVED_BY_NAME:
      row.MOVED_BY_NAME ||
      (row.MOVED_BY && names.get(Number(row.MOVED_BY))) ||
      (() => {
        const deal = fallbackDeals.find(
          (candidate) =>
            candidate.id === row.OWNER_ID &&
            candidate.movedBy &&
            candidate.movedTime &&
            Date.parse(candidate.movedTime) === Date.parse(row.CREATED_TIME),
        );
        return deal?.movedBy ? names.get(Number(deal.movedBy)) : undefined;
      })() ||
      row.MOVED_BY_NAME,
  }));
}
function normalizeDeals(rows: Deal[]): Deal[] {
  return rows.map((d) => ({
    ...d,
    id: Number(d.id),
    categoryId: Number(d.categoryId),
  }));
}
function unwrapBatch<T>(value: unknown, key = "items"): T[] {
  if (value && typeof value === "object" && "result" in value)
    return unwrapBatch<T>((value as { result: unknown }).result, key);
  return unwrap<T>(value, key);
}

async function listByIdPages<T>(
  session: Session,
  method: string,
  params: Record<string, unknown>,
  idField: "id" | "ID",
  key = "items",
  limit = 10000,
) {
  const result: T[] = [];
  let lastId = 0;
  while (true) {
    const filter = {
      ...((params.filter as Record<string, unknown> | undefined) ?? {}),
      ...(lastId ? { [`>${idField}`]: lastId } : {}),
    };
    const page = await rest<unknown>(session, method, {
      ...params,
      filter,
      order: { [idField]: "ASC", ...((params.order as object) ?? {}) },
      start: -1,
    });
    const items = unwrap<T>(page.result, key);
    if (!items.length) break;
    result.push(...items);
    if (result.length >= limit) return result.slice(0, limit);
    const nextId = Number((items.at(-1) as Record<string, unknown>)[idField]);
    if (!Number.isFinite(nextId) || nextId <= lastId) break;
    lastId = nextId;
    if (items.length < 50) break;
  }
  return result;
}

async function readHistoryForOwners(session: Session, ids: number[]) {
  if (!ids.length) return [] as HistoryEntry[];
  try {
    const responses = await batch(
      session,
      ids.map((id) => ({
        method: "crm.stagehistory.list",
        query: {
          entityTypeId: 2,
          filter: { OWNER_ID: id },
          select: historySelect,
          order: { CREATED_TIME: "ASC", ID: "ASC" },
        },
        as: `history_owner_${id}`,
      })),
    );
    const result = responses.flatMap((response) =>
      normalizeHistory(unwrapBatch<HistoryEntry>(response)),
    );
    if (result.length) return result;
    // Um lote vazio para muitos proprietários pode indicar que o portal não
    // interpretou o filtro escalar; abaixo usamos as formas compatíveis.
    throw new BitrixError("EMPTY_HISTORY_BATCH", "Lote de histórico vazio");
  } catch {
    // Alguns portais aceitam apenas OWNER_ID escalar dentro de subrequests.
    // Tentamos primeiro o filtro em lote tradicional para manter compatibilidade
    // com portais e adaptadores que não oferecem o endpoint batch.
    const combined = normalizeHistory(
      await listAll<HistoryEntry>(session, "crm.stagehistory.list", {
        entityTypeId: 2,
        filter: { OWNER_ID: ids },
        select: historySelect,
        order: { CREATED_TIME: "ASC", ID: "ASC" },
      }),
    );
    if (combined.length) return combined;
    // A consulta individual mantém os históricos completos mesmo nesses casos.
    const result: HistoryEntry[] = [];
    for (const id of ids)
      result.push(
        ...normalizeHistory(
          await listAll<HistoryEntry>(session, "crm.stagehistory.list", {
            entityTypeId: 2,
            filter: { OWNER_ID: id },
            select: historySelect,
            order: { CREATED_TIME: "ASC", ID: "ASC" },
          }),
        ),
      );
    return result;
  }
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
    activeFilter.categoryId = pipelineFilter;
  }
  if (filters.stage) {
    activeFilter.stageId = filters.stage;
  }
  let recentRows: HistoryEntry[];
  try {
    recentRows = normalizeHistory(
      await listByIdPages<HistoryEntry>(
        session,
        "crm.stagehistory.list",
        { entityTypeId: 2, filter: historyFilter, select: historySelect },
        "ID",
      ),
    );
  } catch {
    recentRows = normalizeHistory(
      await listAll<HistoryEntry>(session, "crm.stagehistory.list", {
        entityTypeId: 2,
        filter: historyFilter,
        select: historySelect,
        order: { CREATED_TIME: "DESC", ID: "DESC" },
      }),
    );
  }
  // Alguns portais não aplicam CATEGORY_ID/STAGE_ID de forma consistente no
  // histórico. O período é filtrado no REST e o recorte de pipeline/etapa é
  // aplicado localmente, preservando as movimentações reais.
  const recent = recentRows.filter(
    (entry) =>
      (filters.pipeline === undefined || entry.CATEGORY_ID === filters.pipeline) &&
      (!filters.stage || entry.STAGE_ID === filters.stage),
  );
  // Sem filtro de data aqui: negócios sem movimentação no período também podem estar parados.
  // A visão geral não deve baixar milhares de cards de uma vez. Usamos a
  // primeira página para calcular os indicadores e informamos ao usuário
  // quando o portal possui mais cards do que o recorte consultado.
  let active: Deal[];
  let activeTotal: number;
  try {
    const rows = await listByIdPages<Deal>(
      session,
      "crm.item.list",
      { entityTypeId: 2, filter: activeFilter, select: dealSelect },
      "id",
      "items",
      500,
    );
    active = normalizeDeals(rows);
    activeTotal = active.length;
  } catch (error) {
    try {
      const rows = await listAll<Deal>(
        session,
        "crm.item.list",
        { entityTypeId: 2, filter: activeFilter, select: dealSelect },
        "items",
        500,
      );
      active = normalizeDeals(rows);
      activeTotal = active.length;
    } catch (fallbackError) {
      if (
        !(fallbackError instanceof BitrixError) ||
        fallbackError.code !== "QUERY_TOO_LARGE"
      )
        throw error;
      const activePage = await listPage<Deal>(
        session,
        "crm.item.list",
        { entityTypeId: 2, filter: activeFilter, select: dealSelect },
        "items",
        -1,
      );
      active = normalizeDeals(activePage.items.slice(0, 500));
      activeTotal = Number.isFinite(Number(activePage.total))
        ? Number(activePage.total)
        : active.length;
    }
  }
  const ids = [
    ...new Set([...recent.map((h) => h.OWNER_ID), ...active.map((d) => d.id)]),
  ];
  const queryLimit = 500;
  const limitedIds = ids.slice(0, queryLimit);
  const partial =
    ids.length > queryLimit || activeTotal > active.length || active.length >= 500;
  const deals: Deal[] = [];
  const history: HistoryEntry[] = [];
  for (let i = 0; i < limitedIds.length; i += 50) {
    const chunkIds = limitedIds.slice(i, i + 50);
    let readable: Deal[];
    let chunkHistory: HistoryEntry[];
    try {
      // O batch reduz duas chamadas REST sequenciais a uma ida ao Bitrix24.
      const responses = await batch(session, [
        {
          method: "crm.item.list",
          query: {
            entityTypeId: 2,
            filter: { "@id": chunkIds },
            select: dealSelect,
          },
          as: `deals_${i}`,
        },
      ]);
      readable = normalizeDeals(unwrapBatch<Deal>(responses[0]));
      chunkHistory = await readHistoryForOwners(session, chunkIds);
    } catch {
      // Mantém uma rota de compatibilidade para portais que ainda não
      // disponibilizam subrequests ou para respostas antigas do REST.
      // O lote é uma otimização; se ele falhar, a consulta sequencial continua
      // sendo a fonte de verdade para não bloquear o painel.
      readable = normalizeDeals(
        await listAll<Deal>(session, "crm.item.list", {
          entityTypeId: 2,
          filter: { "@id": chunkIds },
          select: dealSelect,
        }),
      );
      chunkHistory = readable.length
        ? await readHistoryForOwners(session, readable.map((d) => d.id))
        : [];
    }
    deals.push(...readable);
    history.push(...chunkHistory);
    if (history.length > 10000)
      throw new BitrixError(
        "QUERY_TOO_LARGE",
        "Histórico muito extenso para este MVP. Selecione um pipeline ou reduza o período.",
        422,
      );
  }
  const resolvedHistory = await resolveHistoryActors(session, history, deals);
  const result = buildDashboard(
    deals,
    resolvedHistory,
    catalog,
    filters,
    settings,
    Date.now(),
    false,
    session.domain,
  );
  return {
    ...result,
    activeCount: activeTotal,
    partial,
    warning: partial
      ? `A consulta analisou ${limitedIds.length} negócios nesta atualização. O portal possui ${activeTotal} negócios em andamento; selecione um pipeline ou reduza o período para detalhar todos.`
      : undefined,
  };
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
  const deal = normalizeDeals([item.result.item])[0];
  const history = await resolveHistoryActors(
    session,
    normalizeHistory(
    await listAll<HistoryEntry>(session, "crm.stagehistory.list", {
      entityTypeId: 2,
      filter: { OWNER_ID: id },
      order: { CREATED_TIME: "ASC", ID: "ASC" },
      select: historySelect,
    }),
    ),
    [deal],
  );
  return buildJourney(
    deal,
    history,
    catalog,
    Date.now(),
    false,
    session.domain,
  );
}

// Quantos negócios fechados recentes entram na comparação da autópsia.
const SAMPLE_SIZE = 50;
async function readClosedDeal(session: Session, id: number) {
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
  return normalizeDeals([item.result.item])[0];
}
export async function getBenchmark(id: number): Promise<Benchmark | null> {
  const now = Date.now();
  if (isDemo()) {
    const { catalog, deals, history } = demoDataset(now);
    const deal = deals.find((d) => d.id === id);
    if (!deal)
      throw new BitrixError(
        "NOT_FOUND",
        "Negócio não encontrado nesta demonstração.",
        404,
      );
    return isClosed(deal)
      ? buildBenchmark(deal, deals, history, catalog, now)
      : null;
  }
  const session = await getSession();
  const deal = await readClosedDeal(session, id);
  if (!isClosed(deal)) return null;
  const catalog = await getCatalog(session);
  const key = `${deal.categoryId}:${deal.stageSemanticId}`;
  let sample = session.closedSample;
  if (!sample || sample.key !== key || sample.expiresAt <= now) {
    // crm.item.list já respeita as permissões de leitura de quem consultou.
    const page = await rest<{ items: Deal[] }>(session, "crm.item.list", {
      entityTypeId: 2,
      filter: {
        categoryId: deal.categoryId,
        stageSemanticId: deal.stageSemanticId,
      },
      select: dealSelect,
      order: { movedTime: "DESC" },
    });
    const deals = normalizeDeals(unwrap<Deal>(page.result)).slice(
      0,
      SAMPLE_SIZE,
    );
    const history: HistoryEntry[] = [];
    for (let i = 0; i < deals.length; i += 50)
      history.push(
        ...normalizeHistory(
          await listAll<HistoryEntry>(session, "crm.stagehistory.list", {
            entityTypeId: 2,
            filter: { OWNER_ID: deals.slice(i, i + 50).map((d) => d.id) },
            select: historySelect,
            order: { CREATED_TIME: "ASC", ID: "ASC" },
          }),
        ),
      );
    sample = { key, expiresAt: now + 10 * 60000, deals, history };
    session.closedSample = sample;
  }
  return buildBenchmark(deal, sample.deals, sample.history, catalog, now);
}
// Única escrita do app no CRM: um comentário na timeline, sempre por ação
// explícita do usuário e com o texto montado no servidor.
export async function publishAutopsy(id: number) {
  const journey = await getJourney(id);
  const benchmark = await getBenchmark(id).catch(() => null);
  const autopsy = buildAutopsy(journey, benchmark);
  if (!autopsy)
    throw new BitrixError(
      "NOT_CLOSED",
      "A autópsia só existe para negócios já ganhos ou perdidos.",
      409,
    );
  if (isDemo()) return { published: true, demo: true };
  const session = await getSession();
  try {
    await rest(session, "crm.timeline.comment.add", {
      fields: {
        ENTITY_ID: id,
        ENTITY_TYPE: "deal",
        COMMENT: autopsyText(journey, autopsy),
      },
    });
  } catch (error) {
    if (error instanceof BitrixError && error.status === 403)
      throw new BitrixError(
        "ACCESS_DENIED",
        "Você não tem permissão para comentar neste negócio.",
        403,
      );
    throw error;
  }
  return { published: true, demo: false };
}
