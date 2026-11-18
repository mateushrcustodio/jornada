import type {
  DashboardData,
  Deal,
  Movement,
  Stage,
  StalledDeal,
  UserOption,
} from "./types";
import { stageKey } from "./calculations";

// Análise detalhada do tempo por etapa, montada no navegador a partir do
// painel completo que já chegou (movimentações do período + parados). Não faz
// nenhuma chamada extra ao Bitrix24. A média de cada etapa é a mesma da tabela
// "Detalhamento por etapa" (`retention`), para os números nunca divergirem.

const HOUR = 3600000;
const DAY = 24 * HOUR;

export const DURATION_BUCKETS = [
  { label: "Até 1h", max: HOUR },
  { label: "1h a 1 dia", max: DAY },
  { label: "1 a 3 dias", max: 3 * DAY },
  { label: "3 a 7 dias", max: 7 * DAY },
  { label: "7 a 15 dias", max: 15 * DAY },
  { label: "15 dias ou mais", max: Infinity },
] as const;

export interface DealSummary {
  id: number;
  title: string;
  url?: string;
  assignee: string;
  opportunity?: number;
  currencyId?: string;
}
export interface StagePassage {
  deal: DealSummary;
  duration: number;
  enteredAt: string;
  // A passagem ainda está aberta (o negócio continua na etapa).
  current: boolean;
  // Etapa para onde o negócio foi depois desta passagem, quando saiu no período.
  next?: Stage;
  actor?: string;
}
export interface FlowItem {
  key: string;
  label: string;
  color: string;
  count: number;
}
export interface AssigneeStat {
  id?: number;
  name: string;
  passages: number;
  deals: number;
  average: number;
  maximum: number;
  revenue: number;
  stalled: number;
  stalledRevenue: number;
  // Só no resumo do funil: a etapa em que a pessoa demora mais, em média.
  slowestStage?: { name: string; average: number };
}
export interface BucketStat {
  label: string;
  count: number;
  open: number;
  revenue: number;
}
// Ciclo até concluir (etapas de ganho/perda): tempo desde a primeira etapa
// registrada do negócio até a passagem pela etapa final.
export interface CycleStat {
  average: number;
  median: number;
  maximum: number;
  samples: number;
}
export interface StageInsight {
  key: string;
  stage: Stage;
  pipelineId: number;
  pipeline: string;
  // Etapa de ganho ou perda: a duração é sempre zero, fica fora dos gráficos.
  final: boolean;
  passages: number;
  deals: number;
  open: number;
  average: number;
  median: number;
  p90: number;
  minimum: number;
  maximum: number;
  currentDeals: number;
  stalledDeals: number;
  revenue: number;
  // Valor médio por negócio (faturamento dividido pelos negócios na moeda
  // principal); 0 quando não há negócios.
  ticket: number;
  // Só nas etapas finais, quando o painel traz o ciclo (aba Etapas com finalizados).
  cycle?: CycleStat;
  stalledRevenue: number;
  // Média da etapa dividida pela média do funil (1 = igual à média).
  vsFunnel?: number;
  buckets: BucketStat[];
  assignees: AssigneeStat[];
  slowest: StagePassage[];
  stalled: StalledDeal[];
  sources: FlowItem[];
  exits: FlowItem[];
}
export interface PipelineInsight {
  id: number;
  name: string;
  stages: StageInsight[];
  average: number;
  passages: number;
  deals: number;
  revenue: number;
  stalledDeals: number;
  stalledRevenue: number;
  bottleneck?: StageInsight;
  assignees: AssigneeStat[];
}
export interface StageInsights {
  pipelines: PipelineInsight[];
  currency: string;
  // Negócios em outra moeda ficam fora das somas de faturamento (sem conversão).
  otherCurrencyDeals: number;
}

export function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;

export function assigneeName(deal: Deal, users: Map<number, string>) {
  if (deal.assignedByName) return deal.assignedByName;
  if (deal.assignedById === undefined) return "Sem responsável";
  return users.get(deal.assignedById) ?? `Usuário #${deal.assignedById}`;
}

export function buildStageInsights(
  data: Pick<
    DashboardData,
    "movements" | "stalled" | "retention" | "pipelines" | "stages"
  >,
  users: UserOption[],
): StageInsights {
  const names = new Map(users.map((user) => [user.id, user.name]));
  const allDeals = new Map<number, Deal>();
  for (const row of data.movements) allDeals.set(row.deal.id, row.deal);
  for (const row of data.stalled) allDeals.set(row.deal.id, row.deal);
  // Moeda principal: a mais comum entre os negócios analisados.
  const currencies = new Map<string, number>();
  for (const deal of allDeals.values()) {
    const code = deal.currencyId || "BRL";
    currencies.set(code, (currencies.get(code) ?? 0) + 1);
  }
  const currency =
    [...currencies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "BRL";
  const value = (deal: Deal) =>
    (deal.currencyId || "BRL") === currency ? (deal.opportunity ?? 0) : 0;
  const sumDeals = (deals: Iterable<Deal>) => {
    let total = 0;
    for (const deal of deals) total += value(deal);
    return total;
  };
  const summary = (deal: Deal, url?: string): DealSummary => ({
    id: deal.id,
    title: deal.title,
    url,
    assignee: assigneeName(deal, names),
    opportunity: deal.opportunity,
    currencyId: deal.currencyId,
  });
  const keyOf = (stage: Stage) => stageKey(stage.categoryId, stage.id);

  // Saída de cada passagem: a movimentação seguinte do mesmo negócio no período.
  const byDeal = new Map<number, Movement[]>();
  for (const row of data.movements) {
    const rows = byDeal.get(row.deal.id);
    if (rows) rows.push(row);
    else byDeal.set(row.deal.id, [row]);
  }
  const nextOf = new Map<Movement, Movement>();
  for (const rows of byDeal.values()) {
    const sorted = [...rows].sort(
      (a, b) =>
        Date.parse(a.entry.CREATED_TIME) - Date.parse(b.entry.CREATED_TIME) ||
        a.entry.ID - b.entry.ID,
    );
    sorted.forEach((row, i) => {
      if (sorted[i + 1]) nextOf.set(row, sorted[i + 1]);
    });
  }

  const movementsByStage = new Map<string, Movement[]>();
  for (const row of data.movements) {
    const key = keyOf(row.stage);
    const rows = movementsByStage.get(key);
    if (rows) rows.push(row);
    else movementsByStage.set(key, [row]);
  }
  const stalledByStage = new Map<string, StalledDeal[]>();
  for (const row of data.stalled) {
    const key = keyOf(row.stage);
    const rows = stalledByStage.get(key);
    if (rows) rows.push(row);
    else stalledByStage.set(key, [row]);
  }
  // Para onde foram: entradas cuja etapa anterior é esta.
  const exitsByStage = new Map<string, Map<string, FlowItem>>();
  for (const row of data.movements) {
    if (!row.previousStage) continue;
    const from = keyOf(row.previousStage);
    const map = exitsByStage.get(from) ?? new Map<string, FlowItem>();
    exitsByStage.set(from, map);
    const to = keyOf(row.stage);
    const item = map.get(to) ?? {
      key: to,
      label: row.stage.name,
      color: row.stage.color,
      count: 0,
    };
    item.count++;
    map.set(to, item);
  }

  function assigneeStats(
    rows: Movement[],
    stalled: StalledDeal[],
  ): AssigneeStat[] {
    const groups = new Map<
      string,
      {
        id?: number;
        name: string;
        durations: number[];
        deals: Map<number, Deal>;
        stalled: Map<number, Deal>;
      }
    >();
    const group = (deal: Deal) => {
      const key = String(deal.assignedById ?? "none");
      let item = groups.get(key);
      if (!item) {
        item = {
          id: deal.assignedById,
          name: assigneeName(deal, names),
          durations: [],
          deals: new Map(),
          stalled: new Map(),
        };
        groups.set(key, item);
      }
      return item;
    };
    for (const row of rows) {
      const item = group(row.deal);
      item.durations.push(row.duration);
      item.deals.set(row.deal.id, row.deal);
    }
    for (const row of stalled)
      group(row.deal).stalled.set(row.deal.id, row.deal);
    return [...groups.values()]
      .map((item) => ({
        id: item.id,
        name: item.name,
        passages: item.durations.length,
        deals: item.deals.size,
        average: mean(item.durations),
        maximum: Math.max(0, ...item.durations),
        revenue: sumDeals(item.deals.values()),
        stalled: item.stalled.size,
        stalledRevenue: sumDeals(item.stalled.values()),
      }))
      .sort(
        (a, b) =>
          b.average - a.average ||
          b.passages - a.passages ||
          a.name.localeCompare(b.name, "pt-BR"),
      );
  }

  const pipelineName = (id: number) =>
    data.pipelines.find((p) => p.id === id)?.name ?? `Pipeline #${id}`;
  const pipelines = new Map<number, StageInsight[]>();
  for (const retention of data.retention) {
    const key = keyOf(retention.stage);
    const rows = movementsByStage.get(key) ?? [];
    const stalled = [...(stalledByStage.get(key) ?? [])].sort(
      (a, b) => b.duration - a.duration,
    );
    const durations = rows.map((row) => row.duration).sort((a, b) => a - b);
    const deals = new Map(rows.map((row) => [row.deal.id, row.deal]));
    const sources = new Map<string, FlowItem>();
    for (const row of rows) {
      const prev = row.previousStage;
      const k = prev ? keyOf(prev) : "start";
      const item = sources.get(k) ?? {
        key: k,
        label: prev ? prev.name : "Início do histórico",
        color: prev ? prev.color : "#8a94a2",
        count: 0,
      };
      item.count++;
      sources.set(k, item);
    }
    const cycles = rows
      .flatMap((row) => (row.cycle === undefined ? [] : [row.cycle]))
      .sort((a, b) => a - b);
    const dealsInCurrency = [...deals.values()].filter(
      (deal) => (deal.currencyId || "BRL") === currency,
    ).length;
    const insight: StageInsight = {
      key,
      stage: retention.stage,
      pipelineId: retention.stage.categoryId,
      pipeline: retention.pipeline,
      // Mesma regra do detalhamento por etapa (`retention.final`).
      final: retention.final,
      passages: rows.length,
      deals: deals.size,
      open: rows.filter((row) => row.current).length,
      average: retention.average,
      median: percentile(durations, 0.5),
      p90: percentile(durations, 0.9),
      minimum: durations[0] ?? 0,
      maximum: retention.maximum,
      currentDeals: retention.currentDeals,
      stalledDeals: retention.stalledDeals,
      revenue: sumDeals(deals.values()),
      ticket: dealsInCurrency ? sumDeals(deals.values()) / dealsInCurrency : 0,
      cycle: cycles.length
        ? {
            average: mean(cycles),
            median: percentile(cycles, 0.5),
            maximum: cycles[cycles.length - 1],
            samples: cycles.length,
          }
        : undefined,
      stalledRevenue: sumDeals(stalled.map((row) => row.deal)),
      buckets: DURATION_BUCKETS.map((bucket, i) => {
        const min = i ? DURATION_BUCKETS[i - 1].max : 0;
        const inside = rows.filter(
          (row) => row.duration >= min && row.duration < bucket.max,
        );
        return {
          label: bucket.label,
          count: inside.length,
          open: inside.filter((row) => row.current).length,
          revenue: sumDeals(
            new Map(inside.map((r) => [r.deal.id, r.deal])).values(),
          ),
        };
      }),
      assignees: assigneeStats(rows, stalled),
      slowest: [...rows]
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 10)
        .map((row) => ({
          deal: summary(row.deal, row.url),
          duration: row.duration,
          enteredAt: row.entry.CREATED_TIME,
          current: row.current,
          next: nextOf.get(row)?.stage,
          actor: row.actor,
        })),
      stalled,
      sources: [...sources.values()].sort((a, b) => b.count - a.count),
      exits: [...(exitsByStage.get(key)?.values() ?? [])].sort(
        (a, b) => b.count - a.count,
      ),
    };
    const list = pipelines.get(insight.pipelineId) ?? [];
    list.push(insight);
    pipelines.set(insight.pipelineId, list);
  }

  const result: PipelineInsight[] = [...pipelines.entries()].map(
    ([id, stages]) => {
      // Ordem do funil (campo SORT do Bitrix24); empate pelo nome.
      stages.sort(
        (a, b) =>
          a.stage.sort - b.stage.sort ||
          a.stage.name.localeCompare(b.stage.name, "pt-BR"),
      );
      const timed = stages.filter((s) => !s.final);
      const keys = new Set(timed.map((s) => s.key));
      const rows = data.movements.filter((row) => keys.has(keyOf(row.stage)));
      const stalled = data.stalled.filter((row) => keys.has(keyOf(row.stage)));
      const average = mean(rows.map((row) => row.duration));
      for (const stage of timed)
        stage.vsFunnel =
          average > 0 && stage.passages ? stage.average / average : undefined;
      const bottleneck = timed
        .filter((s) => s.passages > 0)
        .sort((a, b) => b.average - a.average)[0];
      const assignees = assigneeStats(rows, stalled).map((person) => {
        let slowest: { name: string; average: number } | undefined;
        for (const stage of timed) {
          const mine = stage.assignees.find((a) => a.id === person.id);
          if (mine?.passages && (!slowest || mine.average > slowest.average))
            slowest = { name: stage.stage.name, average: mine.average };
        }
        return { ...person, slowestStage: slowest };
      });
      const deals = new Map(
        data.movements
          .filter((row) => row.stage.categoryId === id)
          .map((row) => [row.deal.id, row.deal]),
      );
      return {
        id,
        name: pipelineName(id),
        stages,
        average,
        passages: rows.length,
        deals: deals.size,
        revenue: sumDeals(deals.values()),
        stalledDeals: stalled.length,
        stalledRevenue: sumDeals(stalled.map((row) => row.deal)),
        bottleneck,
        assignees,
      };
    },
  );
  // Pipeline com mais passagens primeiro: é o que a tela abre por padrão.
  result.sort(
    (a, b) => b.passages - a.passages || a.name.localeCompare(b.name, "pt-BR"),
  );
  const otherCurrencyDeals = [...allDeals.values()].filter(
    (deal) => (deal.currencyId || "BRL") !== currency,
  ).length;
  return { pipelines: result, currency, otherCurrencyDeals };
}

// Marcas de eixo "redondas" para durações: 1h, 6h, 1 dia, 7 dias…
const STEPS = [
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  3 * DAY,
  5 * DAY,
  7 * DAY,
  14 * DAY,
  30 * DAY,
  60 * DAY,
  90 * DAY,
];
export function durationTicks(max: number, count = 4) {
  if (max <= 0) return { top: HOUR, ticks: [0, HOUR] };
  const step =
    STEPS.find((s) => max / s <= count) ??
    Math.ceil(max / count / (30 * DAY)) * 30 * DAY;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top + 1; t += step) ticks.push(t);
  return { top, ticks };
}
