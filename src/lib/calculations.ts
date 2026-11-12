import type {
  Catalog,
  DashboardData,
  Deal,
  Filters,
  HistoryEntry,
  JourneyData,
  Settings,
  Stage,
  Visit,
} from "./types";
import { LEGACY_STAGE_NAMES } from "./legacy-stages";

export const stageKey = (categoryId: number, id: string) =>
  `${categoryId}:${id}`;
export const isClosed = (deal: Deal) =>
  ["S", "F"].includes(deal.stageSemanticId || "");
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
  const allVisits = deals.map((deal) => ({
    deal,
    visits: calculateVisits(history, deal, catalog, now),
  }));
  const movements = allVisits
    .flatMap(({ deal, visits }) =>
      visits
        .filter((v) => {
          const time = Date.parse(v.entry.CREATED_TIME);
          return (
            time >= Date.parse(filters.from) &&
            time <= Date.parse(filters.to) &&
            enabledStage(v.entry.CATEGORY_ID, v.entry.STAGE_ID)
          );
        })
        .map((v) => ({ ...v, deal, url: dealUrl(domain, deal.id) })),
    )
    .sort(
      (a, b) =>
        Date.parse(b.entry.CREATED_TIME) - Date.parse(a.entry.CREATED_TIME) ||
        b.entry.ID - a.entry.ID,
    );
  const active = allVisits.filter(
    ({ deal }) =>
      !isClosed(deal) && enabledStage(deal.categoryId, deal.stageId),
  );
  const current = active.flatMap(({ deal, visits }) => {
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
  });
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
      return {
        stage,
        pipeline:
          catalog.pipelines.find((p) => p.id === stage.categoryId)?.name ??
          `Pipeline #${stage.categoryId}`,
        average: sample.length
          ? sample.reduce((sum, v) => sum + v.duration, 0) / sample.length
          : 0,
        maximum: Math.max(0, ...sample.map((v) => v.duration)),
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
