import type {
  Catalog,
  DashboardData,
  Deal,
  Filters,
  HistoryEntry,
  JourneyData,
  Movement,
  MovementSort,
  Settings,
  Stage,
  StalledDeal,
  StalledSort,
  StageStatus,
  Visit,
} from "./types";
import { LEGACY_STAGE_NAMES } from "./legacy-stages";

export const stageKey = (categoryId: number, id: string) =>
  `${categoryId}:${id}`;
export const isClosed = (deal: Deal) =>
  ["S", "F"].includes(deal.stageSemanticId || "");
// Tipo da etapa na aba Etapas (pela semântica da passagem no histórico): "open"
// = etapas normais (P), "closed" = etapas de conclusão (S ganho / F perda) e
// "all" = as duas. Sem `status` (Visão geral) não há recorte. O recorte é só da
// etapa: os negócios analisados continuam sendo os mesmos, então o tempo das
// etapas normais não muda entre as opções.
export function matchesStageStatus(
  semanticId: string | undefined,
  status?: StageStatus,
) {
  if (!status || status === "all") return true;
  const closed = ["S", "F"].includes(semanticId ?? "");
  return status === "closed" ? closed : !closed;
}
// Etapa final: só passagens de ganho/perda e duração máxima zero. Se o negócio
// foi reaberto depois do ganho/perda, a etapa tem duração real e deixa de ser
// final.
export const isFinalStage = (
  rows: { entry: { STAGE_SEMANTIC_ID: string } }[],
  maximum: number,
) =>
  rows.length > 0 &&
  maximum === 0 &&
  rows.every((row) => ["S", "F"].includes(row.entry.STAGE_SEMANTIC_ID));
export function resolveStage(
  catalog: Catalog,
  entry: { CATEGORY_ID: number; STAGE_ID: string },
): Stage {
  return (
    catalog.stages.find(
      (s) => s.categoryId === entry.CATEGORY_ID && s.id === entry.STAGE_ID,
    ) ?? {
      id: entry.STAGE_ID,
      categoryId: entry.CATEGORY_ID,
      // Etapa que não está mais no funil: usa o nome conhecido ou deixa claro
      // que foi removida, em vez de mostrar só o ID.
      name:
        LEGACY_STAGE_NAMES[stageKey(entry.CATEGORY_ID, entry.STAGE_ID)] ??
        `Etapa removida (${entry.STAGE_ID})`,
      color: "#7b8294",
      sort: 0,
    }
  );
}
export function calculateVisits(
  history: HistoryEntry[],
  deal: Deal,
  catalog: Catalog,
  now: number,
): Visit[] {
  const sorted = history
    .filter(
      (e) =>
        e.OWNER_ID === deal.id && Number.isFinite(Date.parse(e.CREATED_TIME)),
    )
    .filter((e, i, all) => all.findIndex((other) => other.ID === e.ID) === i)
    .sort(
      (a, b) =>
        Date.parse(a.CREATED_TIME) - Date.parse(b.CREATED_TIME) || a.ID - b.ID,
    );
  return sorted.map((entry, index) => {
    const next = sorted[index + 1];
    const matchesCurrent =
      !next &&
      entry.STAGE_ID === deal.stageId &&
      entry.CATEGORY_ID === deal.categoryId;
    const end = next
      ? Date.parse(next.CREATED_TIME)
      : isClosed(deal)
        ? Date.parse(entry.CREATED_TIME)
        : matchesCurrent
          ? now
          : Date.parse(entry.CREATED_TIME);
    return {
      entry,
      stage: resolveStage(catalog, entry),
      duration: Math.max(0, end - Date.parse(entry.CREATED_TIME)),
      current: matchesCurrent,
      previousStage: index
        ? resolveStage(catalog, sorted[index - 1])
        : undefined,
      actor:
        entry.MOVED_BY_NAME ||
        (entry.MOVED_BY
          ? `Usuário #${entry.MOVED_BY}`
          : matchesCurrent &&
              deal.movedBy &&
              deal.movedTime &&
              Date.parse(deal.movedTime) === Date.parse(entry.CREATED_TIME)
            ? `Usuário #${deal.movedBy}`
            : undefined),
    };
  });
}
export function dealUrl(domain: string | undefined, id: number) {
  return domain ? `https://${domain}/crm/deal/details/${id}/` : undefined;
}
export function buildJourney(
  deal: Deal,
  history: HistoryEntry[],
  catalog: Catalog,
  now: number,
  demo: boolean,
  domain?: string,
): JourneyData {
  const visits = calculateVisits(history, deal, catalog, now);
  const last = visits.at(-1);
  const end =
    isClosed(deal) && last ? Date.parse(last.entry.CREATED_TIME) : now;
  return {
    ...catalog,
    deal,
    visits,
    totalDuration: visits.length
      ? Math.max(0, end - Date.parse(visits[0].entry.CREATED_TIME))
      : 0,
    lastMovement: last?.entry.CREATED_TIME,
    queriedAt: new Date(now).toISOString(),
    demo,
    url: dealUrl(domain, deal.id),
    warning:
      last && !last.current
        ? "A etapa atual difere do último registro do histórico. Atualize a consulta; o histórico pode estar incompleto."
        : undefined,
  };
}
// Regras de pipeline e etapa do painel: filtros da tela, pipelines monitorados
// e etapas ignoradas nas configurações. Usadas pelo painel completo e pelas
// páginas sob demanda, para que as duas listas nunca divirjam.
export function stageFilters(filters: Filters, settings: Settings) {
  const enabledPipeline = (id: number) =>
    (filters.pipeline === undefined || filters.pipeline === id) &&
    (!settings.monitoredPipelines.length ||
      settings.monitoredPipelines.includes(id));
  const enabledStage = (id: number, stage: string) =>
    enabledPipeline(id) &&
    (!filters.stage || stage === filters.stage) &&
    !settings.ignoredStages.includes(stageKey(id, stage));
  return { enabledPipeline, enabledStage };
}
// Filtros no nível do negócio (responsável e faixa de faturamento). Negócio sem
// valor conta como 0, que é como o Bitrix24 guarda o campo vazio.
export const hasDealFilters = (filters: Filters) =>
  filters.assignedById !== undefined ||
  filters.opportunityMin !== undefined ||
  filters.opportunityMax !== undefined;
export function matchesDealFilters(deal: Deal, filters: Filters) {
  if (
    filters.assignedById !== undefined &&
    deal.assignedById !== filters.assignedById
  )
    return false;
  const value = deal.opportunity ?? 0;
  if (filters.opportunityMin !== undefined && value < filters.opportunityMin)
    return false;
  if (filters.opportunityMax !== undefined && value > filters.opportunityMax)
    return false;
  return true;
}
// Ordena pelo faturamento do negócio. A ordenação é estável: movimentações do
// mesmo valor continuam da mais recente para a mais antiga.
export function sortByOpportunity<T>(
  rows: T[],
  sort: MovementSort | undefined,
  value: (row: T) => number | undefined,
): T[] {
  if (sort?.by !== "opportunity") return rows;
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => factor * ((value(a) ?? 0) - (value(b) ?? 0)));
}
// Ordena pela data da movimentação. As listas já vêm da mais recente para a mais
// antiga (data e ID decrescentes); "asc" é exatamente a ordem inversa.
export function sortByWhen<T>(rows: T[], sort: MovementSort | undefined): T[] {
  return sort?.by === "when" && sort.dir === "asc" ? [...rows].reverse() : rows;
}
// Ordena os negócios parados pelo faturamento ou pelo tempo parado, com a mesma
// regra que o servidor pede ao Bitrix24 (crm.item.list): faturamento ausente
// conta como 0; empate de faturamento fica do mais parado para o menos parado;
// empate de tempo segue o ID (crescente em "desc", decrescente em "asc", que é
// o inverso exato de movedTime + ID).
export function sortStalled(
  rows: StalledDeal[],
  sort: StalledSort | undefined,
): StalledDeal[] {
  if (!sort) return rows;
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.by === "opportunity") {
      return (
        factor * ((a.deal.opportunity ?? 0) - (b.deal.opportunity ?? 0)) ||
        b.duration - a.duration ||
        a.deal.id - b.deal.id
      );
    }
    return (
      factor * (a.duration - b.duration) || -factor * (a.deal.id - b.deal.id)
    );
  });
}
export const sortMovements = (
  rows: Movement[],
  sort: MovementSort | undefined,
) =>
  sortByWhen(
    sortByOpportunity(rows, sort, (row) => row.deal.opportunity),
    sort,
  );
export function buildDashboard(
  deals: Deal[],
  history: HistoryEntry[],
  catalog: Catalog,
  filters: Filters,
  settings: Settings,
  now: number,
  demo: boolean,
  domain?: string,
): DashboardData {
  const { enabledStage } = stageFilters(filters, settings);
  const allVisits = deals
    .filter((deal) => matchesDealFilters(deal, filters))
    .map((deal) => ({
      deal,
      visits: calculateVisits(history, deal, catalog, now),
    }));
  // O ciclo até concluir só é calculado quando a aba Etapas pede finalizados.
  const withCycle =
    filters.stageStatus === "closed" || filters.stageStatus === "all";
  // O destino de cada passagem (funil de conversão) também é só da aba Etapas.
  const withExit = filters.stageStatus !== undefined;
  const movements = allVisits
    .flatMap(({ deal, visits }) => {
      // Primeira etapa registrada do negócio: início do ciclo até concluir.
      const started = visits.length
        ? Date.parse(visits[0].entry.CREATED_TIME)
        : 0;
      return visits
        .map((v, i) => ({ v, next: visits[i + 1] }))
        .filter(({ v }) => {
          const time = Date.parse(v.entry.CREATED_TIME);
          return (
            time >= Date.parse(filters.from) &&
            time <= Date.parse(filters.to) &&
            enabledStage(v.entry.CATEGORY_ID, v.entry.STAGE_ID) &&
            matchesStageStatus(v.entry.STAGE_SEMANTIC_ID, filters.stageStatus)
          );
        })
        .map(({ v, next }) => ({
          ...v,
          deal,
          url: dealUrl(domain, deal.id),
          ...(withCycle && ["S", "F"].includes(v.entry.STAGE_SEMANTIC_ID)
            ? { cycle: Math.max(0, Date.parse(v.entry.CREATED_TIME) - started) }
            : {}),
          // O destino vem do histórico inteiro do negócio, então continua
          // valendo mesmo quando a próxima etapa foi filtrada (ex.: ganho/perda
          // em "Em andamento").
          ...(withExit && next
            ? {
                exit: {
                  categoryId: next.entry.CATEGORY_ID,
                  stageId: next.entry.STAGE_ID,
                  semanticId: next.entry.STAGE_SEMANTIC_ID,
                },
              }
            : {}),
        }));
    })
    .sort(
      (a, b) =>
        Date.parse(b.entry.CREATED_TIME) - Date.parse(a.entry.CREATED_TIME) ||
        b.entry.ID - a.entry.ID,
    );
  const active = allVisits.filter(
    ({ deal }) =>
      !isClosed(deal) && enabledStage(deal.categoryId, deal.stageId),
  );
  // A posição atual dos negócios abertos é de etapa normal: fica de fora quando
  // só as etapas de conclusão foram pedidas.
  const current = (filters.stageStatus === "closed" ? [] : active).flatMap(
    ({ deal, visits }) => {
      const visit = visits.at(-1);
      const enteredAt = visit?.current
        ? visit.entry.CREATED_TIME
        : deal.movedTime;
      if (!enteredAt || !Number.isFinite(Date.parse(enteredAt))) return [];
      return [
        {
          deal,
          enteredAt,
          stage: resolveStage(catalog, {
            CATEGORY_ID: deal.categoryId,
            STAGE_ID: deal.stageId,
          }),
          duration: Math.max(0, now - Date.parse(enteredAt)),
          url: dealUrl(domain, deal.id),
        },
      ];
    },
  );
  const threshold = settings.stalledHours * 3600000;
  const stalled = current
    .filter((v) => v.duration >= threshold)
    .sort((a, b) => b.duration - a.duration);
  const keys = new Set([
    ...movements.map((v) => stageKey(v.stage.categoryId, v.stage.id)),
    ...current.map((v) => stageKey(v.stage.categoryId, v.stage.id)),
  ]);
  const retention = [...keys]
    .map((key) => {
      const sample = movements.filter(
        (v) => stageKey(v.stage.categoryId, v.stage.id) === key,
      );
      const live = current.filter(
        (v) => stageKey(v.stage.categoryId, v.stage.id) === key,
      );
      const stage = sample[0]?.stage ?? live[0].stage;
      const maximum = Math.max(0, ...sample.map((v) => v.duration));
      return {
        stage,
        pipeline:
          catalog.pipelines.find((p) => p.id === stage.categoryId)?.name ??
          `Pipeline #${stage.categoryId}`,
        average: sample.length
          ? sample.reduce((sum, v) => sum + v.duration, 0) / sample.length
          : 0,
        maximum,
        final: isFinalStage(sample, maximum),
        sampleDeals: new Set(sample.map((v) => v.deal.id)).size,
        visits: sample.length,
        currentDeals: live.length,
        stalledDeals: live.filter((v) => v.duration >= threshold).length,
      };
    })
    .sort((a, b) => b.average - a.average);
  return {
    ...catalog,
    movements,
    stalled,
    retention,
    activeCount: active.length,
    average: movements.length
      ? movements.reduce((sum, v) => sum + v.duration, 0) / movements.length
      : 0,
    queriedAt: new Date(now).toISOString(),
    demo,
  };
}
