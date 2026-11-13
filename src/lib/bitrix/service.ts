import "server-only";
import {
  PAGE_SIZE,
  type Catalog,
  type Deal,
  type Filters,
  type HistoryEntry,
  type Movement,
  type MovementSort,
  type PageData,
  type RawCategory,
  type RawStatus,
  type Settings,
  type StalledDeal,
  type UserOption,
} from "../types";
import {
  buildDashboard,
  buildJourney,
  calculateVisits,
  dealUrl,
  hasDealFilters,
  isClosed,
  matchesDealFilters,
  resolveStage,
  sortByOpportunity,
  sortMovements,
  stageFilters,
} from "../calculations";
import {
  autopsyText,
  buildAutopsy,
  buildBenchmark,
  type Benchmark,
} from "../autopsy";
import { DEMO_USERS, demoDataset } from "../demo";
import { isDemo } from "./config";
import {
  getSession,
  type MovementRows,
  type Session,
} from "./session";
import {
  batch,
  batchWithMeta,
  dashboardDealBudget,
  listAll,
  listAllBatched,
  listPage,
  rest,
  unwrap,
} from "./client";
import { BitrixError } from "./errors";

export async function getCatalog(providedSession?: Session): Promise<Catalog> {
  if (isDemo()) return demoDataset().catalog;
  const session = providedSession ?? (await getSession());
  if (session.catalog && session.catalog.expiresAt > Date.now())
    return session.catalog.data;
  // Painel, card e o aquecimento do placement podem pedir o catálogo ao mesmo
  // tempo; todos aguardam a mesma consulta em vez de repeti-la.
  if (session.catalogPending) return session.catalogPending;
  const pending = loadCatalog(session).finally(() => {
    if (session.catalogPending === pending) session.catalogPending = undefined;
  });
  session.catalogPending = pending;
  return pending;
}
async function loadCatalog(session: Session): Promise<Catalog> {
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
  "assignedById",
  "opportunity",
  "currencyId",
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

// `extraUserIds` (ex.: responsáveis dos negócios) entram na mesma consulta de
// nomes; depois dela, os nomes ficam em `session.userNames`.
async function resolveHistoryActors(
  session: Session,
  rows: HistoryEntry[],
  fallbackDeals: Deal[] = [],
  extraUserIds: number[] = [],
): Promise<HistoryEntry[]> {
  const ids = [
    ...new Set(
      [
        ...rows.map((row) => Number(row.MOVED_BY)),
        ...fallbackDeals.map((deal) => Number(deal.movedBy)),
        ...extraUserIds.map(Number),
      ].filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
  if (!ids.length) return rows;
  const names = (session.userNames ??= new Map<number, string>());
  const pendingIds = ids.filter((id) => !names.has(id));
  try {
    const groups: number[][] = [];
    for (let index = 0; index < pendingIds.length; index += 50)
      groups.push(pendingIds.slice(index, index + 50));
    const answers = await Promise.all(
      groups.map((group) =>
        batch(
          session,
          group.map((id) => ({
            method: "user.get",
            query: { FILTER: { ID: id } },
            as: `user_${id}`,
          })),
        ),
      ),
    );
    answers.forEach((responses, groupIndex) =>
      responses.forEach((response, responseIndex) => {
        const id = groups[groupIndex][responseIndex];
        const user = unwrapBatch<RawUser>(response)[0];
        if (!user) return;
        const name = userDisplayName(user);
        if (name) names.set(id, name);
      }),
    );
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
  return rows.map((d) => {
    const raw = d as unknown as Record<string, unknown>;
    const assigned = Number(raw.assignedById);
    const value =
      raw.opportunity === undefined ||
      raw.opportunity === null ||
      raw.opportunity === ""
        ? NaN
        : Number(raw.opportunity);
    const deal: Deal = {
      ...d,
      id: Number(d.id),
      categoryId: Number(d.categoryId),
    };
    if (Number.isFinite(assigned) && assigned > 0) deal.assignedById = assigned;
    else delete deal.assignedById;
    if (Number.isFinite(value)) deal.opportunity = value;
    else delete deal.opportunity;
    return deal;
  });
}

// Pessoas ativas do portal para o filtro "Responsável". Fica na sessão por
// alguns minutos. Sem permissão em user.get, a lista vem vazia (e a tela avisa)
// em vez de bloquear o painel.
const USERS_TTL = 10 * 60000;
export async function getUsers(): Promise<UserOption[]> {
  if (isDemo()) return DEMO_USERS;
  const session = await getSession();
  if (session.users && session.users.expiresAt > Date.now())
    return session.users.data;
  try {
    const rows = await listAll<RawUser>(
      session,
      "user.get",
      { FILTER: { ACTIVE: true }, SORT: "LAST_NAME", ORDER: "ASC" },
      "items",
      5000,
    );
    const names = (session.userNames ??= new Map<number, string>());
    const users: UserOption[] = [];
    for (const row of rows) {
      const id = Number(row.ID);
      const name = userDisplayName(row);
      if (!Number.isFinite(id) || id <= 0 || !name) continue;
      names.set(id, name);
      users.push({ id, name });
    }
    users.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    session.users = { data: users, expiresAt: Date.now() + USERS_TTL };
    return users;
  } catch (error) {
    // 403 aqui costuma ser só falta de escopo em user.get: o painel segue sem a lista.
    if (error instanceof BitrixError && error.status === 401) throw error;
    return [];
  }
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

/** Histórico de cada negócio em um lote; falha se o portal não aceitar o formato. */
async function readHistoryBatch(session: Session, ids: number[]) {
  if (!ids.length) return [] as HistoryEntry[];
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
  // interpretou o filtro escalar; o chamador usa as formas compatíveis.
  throw new BitrixError("EMPTY_HISTORY_BATCH", "Lote de histórico vazio");
}
async function readHistoryForOwners(session: Session, ids: number[]) {
  if (!ids.length) return [] as HistoryEntry[];
  try {
    return await readHistoryBatch(session, ids);
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
/** Executa `fn` sobre os itens com no máximo `limit` chamadas simultâneas, mantendo a ordem. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
const HISTORY_LIMIT = 10000;
async function readRecentHistory(
  session: Session,
  historyFilter: Record<string, unknown>,
): Promise<{ rows: HistoryEntry[]; total: number; truncated: boolean }> {
  try {
    // Mais recentes primeiro: se o período passar do limite, ficam as
    // movimentações novas, e o painel avisa que a leitura é parcial.
    const { items, total } = await listAllBatched<HistoryEntry>(
      session,
      "crm.stagehistory.list",
      {
        entityTypeId: 2,
        filter: historyFilter,
        select: historySelect,
        order: { ID: "DESC" },
      },
      { limit: HISTORY_LIMIT, overflow: "truncate", idField: "ID" },
    );
    return {
      rows: normalizeHistory(items),
      total,
      truncated: total > items.length,
    };
  } catch {
    // Caminho anterior, mais lento, para portais que não aceitam o lote.
    let rows: HistoryEntry[];
    try {
      rows = normalizeHistory(
        await listByIdPages<HistoryEntry>(
          session,
          "crm.stagehistory.list",
          { entityTypeId: 2, filter: historyFilter, select: historySelect },
          "ID",
        ),
      );
    } catch {
      rows = normalizeHistory(
        await listAll<HistoryEntry>(session, "crm.stagehistory.list", {
          entityTypeId: 2,
          filter: historyFilter,
          select: historySelect,
          order: { CREATED_TIME: "DESC", ID: "DESC" },
        }),
      );
    }
    return { rows, total: rows.length, truncated: false };
  }
}
// A lista dos negócios ativos é barata: 50 por página do REST, lidas em lotes
// de 50 páginas (até 2.500 negócios por chamada contada). O histórico de cada
// negócio é que custa caro, e esse tem orçamento próprio (dashboardDealBudget).
const ACTIVE_LIMIT = 10000;
// Caminhos de compatibilidade (portais sem batch) leem página por página, em
// sequência; por isso continuam com um teto menor.
const FALLBACK_ACTIVE_LIMIT = 500;
async function readActiveDeals(
  session: Session,
  activeFilter: Record<string, unknown>,
): Promise<{ active: Deal[]; activeTotal: number; totalKnown: boolean }> {
  // Sem filtro de data aqui: negócios sem movimentação no período também podem estar parados.
  // Lê todos os ativos (até ACTIVE_LIMIT) e usa o total informado pelo
  // portal para avisar se algum ficou de fora.
  try {
    const { items, total } = await listAllBatched<Deal>(
      session,
      "crm.item.list",
      {
        entityTypeId: 2,
        filter: activeFilter,
        select: dealSelect,
        order: { id: "ASC" },
      },
      { limit: ACTIVE_LIMIT, overflow: "truncate", idField: "id" },
    );
    return {
      active: normalizeDeals(items),
      activeTotal: total,
      totalKnown: true,
    };
  } catch {
    /* Segue para o caminho anterior. */
  }
  try {
    const rows = await listByIdPages<Deal>(
      session,
      "crm.item.list",
      { entityTypeId: 2, filter: activeFilter, select: dealSelect },
      "id",
      "items",
      FALLBACK_ACTIVE_LIMIT,
    );
    const active = normalizeDeals(rows);
    return { active, activeTotal: active.length, totalKnown: false };
  } catch (error) {
    try {
      const rows = await listAll<Deal>(
        session,
        "crm.item.list",
        { entityTypeId: 2, filter: activeFilter, select: dealSelect },
        "items",
        FALLBACK_ACTIVE_LIMIT,
      );
      const active = normalizeDeals(rows);
      return { active, activeTotal: active.length, totalKnown: true };
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
      const active = normalizeDeals(
        activePage.items.slice(0, FALLBACK_ACTIVE_LIMIT),
      );
      const total = Number(activePage.total);
      return {
        active,
        activeTotal: Number.isFinite(total) ? total : active.length,
        totalKnown: Number.isFinite(total),
      };
    }
  }
}
async function readDealChunk(session: Session, chunkIds: number[]) {
  try {
    // Um lote só: a lista dos negócios do grupo (respeita as permissões) e o
    // histórico de cada um. Só o lote aqui: as formas de compatibilidade
    // ficam no caminho abaixo, que consulta apenas os negócios legíveis.
    const responses = await batch(session, [
      {
        method: "crm.item.list",
        query: {
          entityTypeId: 2,
          filter: { "@id": chunkIds },
          select: dealSelect,
        },
        as: "deals",
      },
      ...chunkIds.map((id) => ({
        method: "crm.stagehistory.list",
        query: {
          entityTypeId: 2,
          filter: { OWNER_ID: id },
          select: historySelect,
          order: { CREATED_TIME: "ASC", ID: "ASC" },
        },
        as: `history_owner_${id}`,
      })),
    ]);
    const deals = normalizeDeals(unwrapBatch<Deal>(responses[0]));
    const history = responses
      .slice(1)
      .flatMap((response) =>
        normalizeHistory(unwrapBatch<HistoryEntry>(response)),
      );
    if (deals.length && !history.length)
      throw new BitrixError("EMPTY_HISTORY_BATCH", "Lote de histórico vazio");
    const readable = new Set(deals.map((deal) => deal.id));
    return {
      deals,
      history: history.filter((entry) => readable.has(entry.OWNER_ID)),
    };
  } catch {
    // Mantém uma rota de compatibilidade para portais que ainda não
    // disponibilizam subrequests ou para respostas antigas do REST.
    // O lote é uma otimização; se ele falhar, a consulta sequencial continua
    // sendo a fonte de verdade para não bloquear o painel.
    const readable = normalizeDeals(
      await listAll<Deal>(session, "crm.item.list", {
        entityTypeId: 2,
        filter: { "@id": chunkIds },
        select: dealSelect,
      }),
    );
    return {
      deals: readable,
      history: readable.length
        ? await readHistoryForOwners(
            session,
            readable.map((d) => d.id),
          )
        : [],
    };
  }
}
// Histórico completo de negócios ativos, por sessão. Vale enquanto o movedTime
// do negócio (sempre lido na lista de ativos) não mudar e nenhuma movimentação
// mais nova que a guardada aparecer no período.
const DEAL_HISTORY_TTL = 10 * 60000;
const DEAL_HISTORY_MAX = 5000;
// Limite de segurança para o total de históricos em memória numa atualização.
const DETAIL_HISTORY_LIMIT = 50000;
function cachedDealHistory(
  session: Session,
  deal: Deal,
  latestMoveId: number | undefined,
): HistoryEntry[] | undefined {
  const entry = session.dealHistory?.get(deal.id);
  if (!entry || entry.expiresAt <= Date.now() || !deal.movedTime)
    return undefined;
  if (Date.parse(entry.movedTime) !== Date.parse(deal.movedTime))
    return undefined;
  if (latestMoveId !== undefined && entry.lastId < latestMoveId)
    return undefined;
  return entry.rows;
}
function rememberDealHistory(
  session: Session,
  deal: Deal,
  rows: HistoryEntry[],
) {
  if (!deal.movedTime || !rows.length) return;
  const cache = (session.dealHistory ??= new Map());
  cache.delete(deal.id);
  cache.set(deal.id, {
    movedTime: deal.movedTime,
    lastId: Math.max(...rows.map((row) => row.ID)),
    expiresAt: Date.now() + DEAL_HISTORY_TTL,
    rows,
  });
  // O Map mantém a ordem de inserção: descarta os mais antigos.
  while (cache.size > DEAL_HISTORY_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}
// Responsável e faixa de faturamento no formato do filtro de crm.item.list.
function dealFilterQuery(filters: Filters): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  if (filters.assignedById !== undefined)
    query.assignedById = filters.assignedById;
  if (filters.opportunityMin !== undefined)
    query[">=opportunity"] = filters.opportunityMin;
  if (filters.opportunityMax !== undefined)
    query["<=opportunity"] = filters.opportunityMax;
  return query;
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
  Object.assign(activeFilter, dealFilterQuery(filters));
  // As três leituras são independentes e saem juntas.
  const [catalog, recentResult, activeResult] = await Promise.all([
    getCatalog(session),
    readRecentHistory(session, historyFilter),
    readActiveDeals(session, activeFilter),
  ]);
  const recentRows = recentResult.rows;
  // Alguns portais não aplicam CATEGORY_ID/STAGE_ID de forma consistente no
  // histórico. O período é filtrado no REST e o recorte de pipeline/etapa é
  // aplicado localmente, preservando as movimentações reais.
  const recent = recentRows.filter(
    (entry) =>
      (filters.pipeline === undefined ||
        entry.CATEGORY_ID === filters.pipeline) &&
      (!filters.stage || entry.STAGE_ID === filters.stage),
  );
  const { active, activeTotal, totalKnown } = activeResult;
  // Só quem se moveu no período precisa do histórico de cada negócio (a
  // duração de cada passagem depende da movimentação seguinte). Negócio ativo
  // sem movimentação no período entra em "em andamento" e "parados" pelo
  // movedTime, que já veio na lista, sem nenhuma chamada extra.
  const latestMove = new Map<number, number>();
  // `recent` vem do mais novo para o mais antigo: a ordem de inserção prioriza
  // os negócios mais recentes se o orçamento não der para todos.
  for (const entry of recent)
    latestMove.set(
      entry.OWNER_ID,
      Math.max(latestMove.get(entry.OWNER_ID) ?? 0, entry.ID),
    );
  const owners = [...latestMove.keys()];
  const activeById = new Map(active.map((deal) => [deal.id, deal]));
  const history: HistoryEntry[] = [];
  const toFetch: number[] = [];
  for (const id of owners) {
    const deal = activeById.get(id);
    const cached = deal && cachedDealHistory(session, deal, latestMove.get(id));
    if (cached) history.push(...cached);
    else toFetch.push(id);
  }
  // Orçamento de chamadas (ver dashboardDealBudget): acima dele, os negócios
  // mais antigos do período ficam de fora e o painel avisa.
  const limitedIds = toFetch.slice(0, dashboardDealBudget());
  const skipped = toFetch.length - limitedIds.length;
  const chunks: number[][] = [];
  // 49 negócios por grupo: 1 lista + 49 históricos = 50 subcomandos por lote.
  for (let i = 0; i < limitedIds.length; i += 49)
    chunks.push(limitedIds.slice(i, i + 49));
  const dealsById = new Map<number, Deal>(activeById);
  // Até 6 grupos ao mesmo tempo; o limitador do portal segura o ritmo se o
  // balde encher.
  for (const result of await mapLimit(chunks, 6, (chunk) =>
    readDealChunk(session, chunk),
  )) {
    const byOwner = new Map<number, HistoryEntry[]>();
    for (const entry of result.history) {
      const rows = byOwner.get(entry.OWNER_ID);
      if (rows) rows.push(entry);
      else byOwner.set(entry.OWNER_ID, [entry]);
    }
    for (const deal of result.deals) {
      dealsById.set(deal.id, deal);
      if (activeById.has(deal.id))
        rememberDealHistory(session, deal, byOwner.get(deal.id) ?? []);
    }
    history.push(...result.history);
  }
  const deals = [...dealsById.values()];
  if (history.length > DETAIL_HISTORY_LIMIT)
    throw new BitrixError(
      "QUERY_TOO_LARGE",
      "Histórico muito extenso para este MVP. Selecione um pipeline ou reduza o período.",
      422,
    );
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
  const reasons: string[] = [];
  if (recentResult.truncated)
    reasons.push(
      `O período tem ${recentResult.total} movimentações; esta atualização analisou as ${recentRows.length} mais recentes.`,
    );
  if (skipped > 0)
    reasons.push(
      `Foram detalhados ${owners.length - skipped} de ${owners.length} negócios com movimentação no período (os mais recentes primeiro).`,
    );
  if (activeTotal > active.length)
    reasons.push(
      `A consulta analisou ${active.length} dos ${activeTotal} negócios em andamento.`,
    );
  else if (!totalKnown && active.length >= FALLBACK_ACTIVE_LIMIT)
    reasons.push(
      `A consulta analisou ${active.length} negócios em andamento; pode haver mais.`,
    );
  const partial = reasons.length > 0;
  return {
    ...result,
    activeCount: activeTotal,
    partial,
    warning: partial
      ? `${reasons.join(" ")} Selecione um pipeline ou reduza o período para detalhar todos.`
      : undefined,
  };
}
// ---------------------------------------------------------------------------
// Páginas sob demanda (Movimentações e Parados)
//
// O painel completo lê todos os negócios e históricos do período porque a
// visão geral e as etapas precisam de tudo para calcular médias. Já as listas
// paginadas só precisam do total e dos dados de uma página por vez.
// ---------------------------------------------------------------------------
const MOVEMENT_ROWS_TTL = 3 * 60000;
// O Bitrix24 devolve 50 registros por chamada; a tela pagina de 10 em 10.
const REST_PAGE = 50;
const clampPage = (page: number, total: number) =>
  Math.min(
    Math.max(1, Math.floor(page) || 1),
    Math.max(1, Math.ceil(total / PAGE_SIZE)),
  );

function emptyPage<T>(page: number, demo: boolean): PageData<T> {
  return {
    rows: [],
    total: 0,
    page,
    pageSize: PAGE_SIZE,
    queriedAt: new Date().toISOString(),
    demo,
  };
}

// Só a lista do histórico do período, mais recentes primeiro. É leve (50
// linhas por página do REST, lidas em lote) e fica na sessão por alguns
// minutos: trocar de página não repete essa leitura.
async function loadMovementRows(
  session: Session,
  filters: Filters,
  asOf: number | undefined,
): Promise<MovementRows> {
  const key = `${filters.from}|${filters.to}|${asOf ?? ""}`;
  const cached = session.movementRows;
  if (cached && cached.key === key && cached.expiresAt > Date.now())
    return cached;
  const inFlight = session.movementRowsPending;
  if (inFlight && inFlight.key === key) return inFlight.promise;
  const promise = (async () => {
    const result = await readRecentHistory(session, {
      ">=CREATED_TIME": filters.from,
      "<=CREATED_TIME": filters.to,
    });
    const loaded: MovementRows = {
      key,
      expiresAt: Date.now() + MOVEMENT_ROWS_TTL,
      rows: result.rows.sort(
        (a, b) =>
          Date.parse(b.CREATED_TIME) - Date.parse(a.CREATED_TIME) ||
          b.ID - a.ID,
      ),
      total: result.total,
      truncated: result.truncated,
    };
    session.movementRows = loaded;
    return loaded;
  })().finally(() => {
    if (session.movementRowsPending?.promise === promise)
      session.movementRowsPending = undefined;
  });
  session.movementRowsPending = { key, promise };
  return promise;
}

// Negócios legíveis (crm.item.list respeita as permissões) em lotes de até 50
// consultas de 50 IDs: 2.500 negócios por chamada contada.
async function readDealsByIds(session: Session, ids: number[]) {
  const found = new Map<number, Deal>();
  if (!ids.length) return found;
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  const groups: number[][][] = [];
  for (let i = 0; i < chunks.length; i += 50)
    groups.push(chunks.slice(i, i + 50));
  let lists: Deal[][];
  try {
    const answers = await mapLimit(groups, 4, (group) =>
      batch(
        session,
        group.map((chunk, index) => ({
          method: "crm.item.list",
          query: {
            entityTypeId: 2,
            filter: { "@id": chunk },
            select: dealSelect,
          },
          as: `deals_${index}`,
        })),
      ),
    );
    lists = answers.flatMap((responses) =>
      responses.map((response) => unwrapBatch<Deal>(response)),
    );
  } catch (error) {
    if (error instanceof BitrixError && [401, 403].includes(error.status))
      throw error;
    // Portal sem batch: uma consulta por grupo de 50 negócios.
    lists = await mapLimit(chunks, 4, (chunk) =>
      listAll<Deal>(session, "crm.item.list", {
        entityTypeId: 2,
        filter: { "@id": chunk },
        select: dealSelect,
      }),
    );
  }
  for (const list of lists)
    for (const deal of normalizeDeals(list)) found.set(deal.id, deal);
  return found;
}

// Os negócios do período ficam na sessão junto com a lista de movimentações:
// trocar de página ou de ordenação não repete essa leitura.
async function loadMovementDeals(
  session: Session,
  loaded: MovementRows,
): Promise<Map<number, Deal>> {
  const cached = session.movementDeals;
  if (cached && cached.key === loaded.key && cached.expiresAt > Date.now())
    return cached.deals;
  const inFlight = session.movementDealsPending;
  if (inFlight && inFlight.key === loaded.key) return inFlight.promise;
  const promise = (async () => {
    const owners = [...new Set(loaded.rows.map((row) => row.OWNER_ID))];
    const deals = await readDealsByIds(session, owners);
    session.movementDeals = {
      key: loaded.key,
      expiresAt: Date.now() + MOVEMENT_ROWS_TTL,
      deals,
    };
    return deals;
  })().finally(() => {
    if (session.movementDealsPending?.promise === promise)
      session.movementDealsPending = undefined;
  });
  session.movementDealsPending = { key: loaded.key, promise };
  return promise;
}

function sliceRows<T>(rows: T[], page: number): PageData<T> {
  const current = clampPage(page, rows.length);
  return {
    rows: rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
    total: rows.length,
    page: current,
    pageSize: PAGE_SIZE,
    queriedAt: new Date().toISOString(),
    demo: false,
  };
}

// Sem filtro de pipeline, etapa, pipelines monitorados nem etapas ignoradas,
// o total do Bitrix24 já é o total da lista: basta ler o bloco de 50 que
// contém a página pedida, sem varrer o período inteiro.
async function readMovementBlock(
  session: Session,
  filters: Filters,
  page: number,
): Promise<{ rows: HistoryEntry[]; total: number; page: number }> {
  const read = (requested: number) => {
    const start =
      Math.floor(((requested - 1) * PAGE_SIZE) / REST_PAGE) * REST_PAGE;
    return listPage<HistoryEntry>(
      session,
      "crm.stagehistory.list",
      {
        entityTypeId: 2,
        filter: {
          ">=CREATED_TIME": filters.from,
          "<=CREATED_TIME": filters.to,
        },
        select: historySelect,
        // Mesma ordem do painel completo: mais recentes primeiro.
        order: { CREATED_TIME: "DESC", ID: "DESC" },
      },
      "items",
      start,
    ).then((answer) => ({ ...answer, start }));
  };
  let answer = await read(page);
  if (answer.total === undefined)
    throw new BitrixError("NO_TOTAL", "O portal não informou o total.");
  const total = answer.total;
  const current = clampPage(page, total);
  if (current !== page && total > 0) answer = await read(current);
  const offset = (current - 1) * PAGE_SIZE - answer.start;
  return {
    rows: normalizeHistory(answer.items).slice(offset, offset + PAGE_SIZE),
    total,
    page: current,
  };
}

export async function getMovementsPage(
  filters: Filters,
  settings: Settings,
  page: number,
  asOf?: number,
  sort?: MovementSort,
): Promise<PageData<Movement>> {
  const now = Date.now();
  if (isDemo()) {
    const data = demoDataset(now);
    const full = buildDashboard(
      data.deals,
      data.history,
      data.catalog,
      filters,
      settings,
      now,
      true,
    );
    return {
      ...sliceRows(sortMovements(full.movements, sort), page),
      demo: true,
    };
  }
  const session = await getSession();
  const { enabledStage } = stageFilters(filters, settings);
  // Responsável, faturamento e ordenação por faturamento dependem do negócio,
  // que o histórico não traz: nesses casos lê-se o período inteiro.
  const dealScoped = hasDealFilters(filters) || sort !== undefined;
  const unfiltered =
    filters.pipeline === undefined &&
    !filters.stage &&
    !settings.monitoredPipelines.length &&
    !settings.ignoredStages.length &&
    !dealScoped;
  const result: PageData<Movement> = {
    rows: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    queriedAt: new Date(now).toISOString(),
    demo: false,
  };
  let pageRows: HistoryEntry[] | undefined;
  const catalogRead = getCatalog(session);
  // Se a leitura abaixo falhar primeiro, o erro do catálogo não fica sem tratamento.
  catalogRead.catch(() => undefined);
  if (unfiltered) {
    try {
      const block = await readMovementBlock(session, filters, page);
      pageRows = block.rows;
      result.total = block.total;
      result.page = block.page;
    } catch (error) {
      if (error instanceof BitrixError && [401, 403].includes(error.status))
        throw error;
      // Portal que não aceite a leitura por blocos: segue pela lista completa.
    }
  }
  if (!pageRows) {
    const loaded = await loadMovementRows(session, filters, asOf);
    // Pipeline, etapa e etapas ignoradas são aplicados aqui: alguns portais
    // não respeitam esses filtros no histórico, e assim o total é exato.
    let matching = loaded.rows.filter((row) =>
      enabledStage(row.CATEGORY_ID, row.STAGE_ID),
    );
    if (dealScoped) {
      // Sem acesso ao negócio, a movimentação também não entra na contagem.
      const periodDeals = await loadMovementDeals(session, loaded);
      matching = matching.filter((row) => {
        const deal = periodDeals.get(row.OWNER_ID);
        return !!deal && matchesDealFilters(deal, filters);
      });
      matching = sortByOpportunity(
        matching,
        sort,
        (row) => periodDeals.get(row.OWNER_ID)?.opportunity,
      );
    }
    result.total = matching.length;
    result.page = clampPage(page, matching.length);
    pageRows = matching.slice(
      (result.page - 1) * PAGE_SIZE,
      result.page * PAGE_SIZE,
    );
    if (loaded.truncated) {
      result.partial = true;
      result.warning = `O período tem ${loaded.total} movimentações; a lista mostra as ${loaded.rows.length} mais recentes. Selecione um pipeline ou reduza o período para ver todas.`;
    }
  }
  const catalog = await catalogRead;
  if (!pageRows.length) return result;
  // Só os negócios desta página (no máximo 10): a lista que confirma o acesso
  // do usuário e o histórico de cada um, num único lote.
  const ids = [...new Set(pageRows.map((row) => row.OWNER_ID))];
  const { deals, history } = await readDealChunk(session, ids);
  const resolved = await resolveHistoryActors(
    session,
    history,
    deals,
    deals.map((deal) => Number(deal.assignedById)),
  );
  const assigneeName = (id?: number) =>
    id ? session.userNames?.get(id) : undefined;
  const dealsById = new Map(
    deals.map((deal) => [
      deal.id,
      { ...deal, assignedByName: assigneeName(deal.assignedById) },
    ]),
  );
  const visitsByDeal = new Map<number, ReturnType<typeof calculateVisits>>();
  for (const row of pageRows) {
    const deal = dealsById.get(row.OWNER_ID);
    // Sem acesso ao negócio, a movimentação não é exibida.
    if (!deal) continue;
    let visits = visitsByDeal.get(deal.id);
    if (!visits) {
      visits = calculateVisits(resolved, deal, catalog, now);
      visitsByDeal.set(deal.id, visits);
    }
    const visit = visits.find((v) => v.entry.ID === row.ID);
    if (visit)
      result.rows.push({
        ...visit,
        deal,
        url: dealUrl(session.domain, deal.id),
      });
  }
  return result;
}

// Filtro REST dos negócios parados, equivalente às regras do painel completo:
// pipelines (filtro da tela ou monitorados), etapa e etapas ignoradas.
function stalledFilter(
  catalog: Catalog,
  filters: Filters,
  settings: Settings,
  cutoff: string,
): Record<string, unknown> | undefined {
  const { enabledPipeline, enabledStage } = stageFilters(filters, settings);
  const filter: Record<string, unknown> = {
    stageSemanticId: "P",
    "<=movedTime": cutoff,
    ...dealFilterQuery(filters),
  };
  if (filters.pipeline !== undefined) {
    if (!enabledPipeline(filters.pipeline)) return undefined;
    filter.categoryId = filters.pipeline;
  } else if (settings.monitoredPipelines.length) {
    filter.categoryId = settings.monitoredPipelines;
  }
  if (filters.stage) {
    if (
      filters.pipeline !== undefined &&
      !enabledStage(filters.pipeline, filters.stage)
    )
      return undefined;
    filter.stageId = filters.stage;
  } else if (settings.ignoredStages.length) {
    // O REST só recebe as etapas permitidas; as ignoradas ficam de fora.
    const allowed = catalog.stages
      .filter((stage) => enabledStage(stage.categoryId, stage.id))
      .map((stage) => stage.id);
    if (!allowed.length) return undefined;
    filter.stageId = allowed;
  }
  return filter;
}

export async function getStalledPage(
  filters: Filters,
  settings: Settings,
  page: number,
): Promise<PageData<StalledDeal>> {
  const now = Date.now();
  if (isDemo()) {
    const data = demoDataset(now);
    const full = buildDashboard(
      data.deals,
      data.history,
      data.catalog,
      filters,
      settings,
      now,
      true,
    );
    return { ...sliceRows(full.stalled, page), demo: true };
  }
  const session = await getSession();
  try {
    const catalog = await getCatalog(session);
    const cutoff = new Date(
      now - settings.stalledHours * 3600000,
    ).toISOString();
    const filter = stalledFilter(catalog, filters, settings, cutoff);
    if (!filter) return emptyPage(1, false);
    const { enabledStage } = stageFilters(filters, settings);
    // Ordenar por movedTime crescente é o mesmo que ordenar pelo tempo parado,
    // do maior para o menor. O Bitrix24 devolve o total junto com a página.
    const read = (requested: number) => {
      const start =
        Math.floor(((requested - 1) * PAGE_SIZE) / REST_PAGE) * REST_PAGE;
      return listPage<Deal>(
        session,
        "crm.item.list",
        {
          entityTypeId: 2,
          filter,
          select: dealSelect,
          order: { movedTime: "ASC", id: "ASC" },
        },
        "items",
        start,
      ).then((answer) => ({ ...answer, start }));
    };
    let answer = await read(page);
    if (answer.total === undefined)
      throw new BitrixError("NO_TOTAL", "O portal não informou o total.");
    const total = answer.total;
    const current = clampPage(page, total);
    // Página pedida além do fim (a lista encolheu): relê a última.
    if (current !== page && total > 0) answer = await read(current);
    const offset = (current - 1) * PAGE_SIZE - answer.start;
    const rows = normalizeDeals(answer.items)
      .slice(offset, offset + PAGE_SIZE)
      .filter(
        (deal) =>
          enabledStage(deal.categoryId, deal.stageId) &&
          matchesDealFilters(deal, filters) &&
          deal.movedTime &&
          Number.isFinite(Date.parse(deal.movedTime)),
      )
      .map((deal): StalledDeal => ({
        deal,
        enteredAt: deal.movedTime!,
        stage: resolveStage(catalog, {
          CATEGORY_ID: deal.categoryId,
          STAGE_ID: deal.stageId,
        }),
        duration: Math.max(0, now - Date.parse(deal.movedTime!)),
        url: dealUrl(session.domain, deal.id),
      }));
    return {
      rows,
      total,
      page: current,
      pageSize: PAGE_SIZE,
      queriedAt: new Date(now).toISOString(),
      demo: false,
    };
  } catch (error) {
    // Sem sessão ou sem permissão, não há o que tentar de outro jeito.
    if (error instanceof BitrixError && [401, 403].includes(error.status))
      throw error;
    // Se o portal não aceitar o filtro por movedTime, calcula pelo caminho
    // completo (mais lento, mas igual ao painel) e entrega a página pedida.
    const full = await getDashboard(filters, settings);
    return {
      ...sliceRows(full.stalled, page),
      warning: full.warning,
      partial: full.partial,
    };
  }
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
  const { deal, rows } = await readDealWithHistory(session, id);
  // Negócio fechado: a amostra da autópsia começa a ser lida agora, em
  // paralelo, e /benchmark só aguarda o resultado.
  if (isClosed(deal)) closedSample(session, deal).catch(() => undefined);
  const [catalog, history] = await Promise.all([
    getCatalog(session),
    resolveHistoryActors(session, rows, [deal]),
  ]);
  return buildJourney(
    deal,
    history,
    catalog,
    Date.now(),
    false,
    session.domain,
  );
}
function batchItem(value: unknown): Deal | undefined {
  let current = value;
  for (
    let depth = 0;
    depth < 3 && current && typeof current === "object";
    depth += 1
  ) {
    if ("item" in current) {
      const item = (current as { item: unknown }).item;
      return item && typeof item === "object" ? (item as Deal) : undefined;
    }
    if (!("result" in current)) break;
    current = (current as { result: unknown }).result;
  }
  return undefined;
}
const journeyHistoryQuery = (id: number) => ({
  entityTypeId: 2,
  filter: { OWNER_ID: id },
  order: { CREATED_TIME: "ASC", ID: "ASC" },
  select: historySelect,
});
/**
 * Lê o negócio e o histórico numa única ida ao Bitrix24. Com halt=1 o
 * histórico só é executado se crm.item.get passou, mantendo a regra de
 * confirmar o acesso ao negócio antes de ler o histórico.
 */
async function readDealWithHistory(session: Session, id: number) {
  try {
    const response = await batchWithMeta(
      session,
      [
        { method: "crm.item.get", query: { entityTypeId: 2, id }, as: "deal" },
        {
          method: "crm.stagehistory.list",
          query: journeyHistoryQuery(id),
          as: "history",
        },
      ],
      { halt: true },
    );
    const raw = batchItem(response.results[0]);
    if (raw) {
      const deal = normalizeDeals([raw])[0];
      const more = response.next.history;
      const rows =
        more === undefined || more === null || more === ""
          ? normalizeHistory(unwrapBatch<HistoryEntry>(response.results[1]))
          : // Mais de 50 movimentações: lê o histórico completo.
            normalizeHistory(
              await listAll<HistoryEntry>(
                session,
                "crm.stagehistory.list",
                journeyHistoryQuery(id),
              ),
            );
      if (deal.id === id) return { deal, rows };
    }
  } catch {
    /* Abaixo, a leitura em duas etapas devolve o erro adequado (acesso, 404). */
  }
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
  const deal = normalizeDeals([item.result.item])[0];
  const rows = normalizeHistory(
    await listAll<HistoryEntry>(
      session,
      "crm.stagehistory.list",
      journeyHistoryQuery(id),
    ),
  );
  return { deal, rows };
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
  const [deal, catalog] = await Promise.all([
    readClosedDeal(session, id),
    getCatalog(session),
  ]);
  if (!isClosed(deal)) return null;
  const sample = await closedSample(session, deal, now);
  return buildBenchmark(deal, sample.deals, sample.history, catalog, now);
}
/**
 * Amostra de fechados do mesmo funil e resultado, em cache na sessão por 10
 * minutos. Consultas simultâneas (card e /benchmark) aguardam a mesma leitura.
 */
async function closedSample(session: Session, deal: Deal, now = Date.now()) {
  const key = `${deal.categoryId}:${deal.stageSemanticId}`;
  const cached = session.closedSample;
  if (cached && cached.key === key && cached.expiresAt > now) return cached;
  const inFlight = session.closedSamplePending;
  if (inFlight && inFlight.key === key) return inFlight.promise;
  const promise = (async () => {
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
    // Um lote com o histórico de cada negócio, em vez de páginas sequenciais.
    const history = await readHistoryForOwners(
      session,
      deals.map((d) => d.id),
    );
    const sample = { key, expiresAt: Date.now() + 10 * 60000, deals, history };
    session.closedSample = sample;
    return sample;
  })().finally(() => {
    if (session.closedSamplePending?.promise === promise)
      session.closedSamplePending = undefined;
  });
  session.closedSamplePending = { key, promise };
  return promise;
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
