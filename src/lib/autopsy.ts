import type { Catalog, Deal, HistoryEntry, JourneyData, Stage } from "./types";
import { calculateVisits, isClosed, stageKey } from "./calculations";
import { dateTime, duration } from "./format";

// Mínimo de negócios fechados para a comparação ser exibida. Abaixo disso a
// mediana representa o acaso, não o funil.
export const MIN_SAMPLE = 3;

export interface Benchmark {
  outcome: "S" | "F";
  sample: number;
  medianTotal: number;
  // Mediana do tempo total passado em cada etapa, entre os negócios que passaram por ela.
  medianByStage: Record<string, number>;
  stageSamples: Record<string, number>;
}
export interface Autopsy {
  outcome: "won" | "lost";
  finalStage: Stage;
  total: number;
  stepsBefore: number;
  skipped: Stage[];
  returns: { from: Stage; to: Stage; at: string }[];
  longest?: {
    stage: Stage;
    duration: number;
    share: number;
    typical?: number;
  };
  pace?: {
    ratio: number;
    typical: number;
    sample: number;
    label: "faster" | "similar" | "slower";
  };
}

export function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Compara o negócio com os outros já fechados no mesmo pipeline e com o mesmo
// resultado (ganhos com ganhos, perdidos com perdidos).
export function buildBenchmark(
  target: Deal,
  deals: Deal[],
  history: HistoryEntry[],
  catalog: Catalog,
  now: number,
): Benchmark | null {
  const outcome = target.stageSemanticId;
  if (outcome !== "S" && outcome !== "F") return null;
  const totals: number[] = [];
  const perStage = new Map<string, number[]>();
  for (const deal of deals) {
    if (
      deal.id === target.id ||
      deal.categoryId !== target.categoryId ||
      deal.stageSemanticId !== outcome
    )
      continue;
    const visits = calculateVisits(history, deal, catalog, now);
    if (!visits.length) continue;
    totals.push(
      Math.max(
        0,
        Date.parse(visits.at(-1)!.entry.CREATED_TIME) -
          Date.parse(visits[0].entry.CREATED_TIME),
      ),
    );
    const sums = new Map<string, number>();
    for (const visit of visits)
      sums.set(
        stageKey(visit.stage.categoryId, visit.stage.id),
        (sums.get(stageKey(visit.stage.categoryId, visit.stage.id)) ?? 0) +
          visit.duration,
      );
    for (const [key, value] of sums)
      perStage.set(key, [...(perStage.get(key) ?? []), value]);
  }
  if (!totals.length) return null;
  return {
    outcome,
    sample: totals.length,
    medianTotal: median(totals),
    medianByStage: Object.fromEntries(
      [...perStage].map(([key, values]) => [key, median(values)]),
    ),
    stageSamples: Object.fromEntries(
      [...perStage].map(([key, values]) => [key, values.length]),
    ),
  };
}

export function buildAutopsy(
  data: JourneyData,
  benchmark?: Benchmark | null,
): Autopsy | null {
  const { deal, visits } = data;
  if (!isClosed(deal) || !visits.length) return null;
  const won = deal.stageSemanticId === "S";
  const finalVisit = visits.at(-1)!;
  const before = visits
    .slice(0, -1)
    .filter((v) => v.stage.categoryId === deal.categoryId);
  const visited = new Set(visits.map((v) => v.stage.id));
  const pipeline = data.stages
    .filter((s) => s.categoryId === deal.categoryId)
    .sort((a, b) => a.sort - b.sort);
  // Etapas puladas: ficam entre a primeira etapa visitada e o ponto de saída.
  // Em negócio ganho o ponto de saída é a etapa final; em perdido, a etapa mais
  // avançada alcançada. Assim "Perdido" nunca aparece como etapa pulada.
  const lower = before[0]?.stage.sort;
  const upper = won
    ? finalVisit.stage.sort
    : Math.max(...before.map((v) => v.stage.sort), -Infinity);
  const skipped =
    lower === undefined
      ? []
      : pipeline.filter(
          (s) => s.sort > lower && s.sort < upper && !visited.has(s.id),
        );
  const returns = visits.slice(1, -1).flatMap((visit, index) => {
    const previous = visits[index];
    return previous.stage.categoryId === visit.stage.categoryId &&
      visit.stage.sort < previous.stage.sort
      ? [
          {
            from: previous.stage,
            to: visit.stage,
            at: visit.entry.CREATED_TIME,
          },
        ]
      : [];
  });
  const usable = benchmark && benchmark.sample >= MIN_SAMPLE ? benchmark : null;
  // Tempo total por etapa neste negócio (uma etapa pode ter sido visitada duas vezes).
  const byStage = new Map<string, { stage: Stage; time: number }>();
  for (const visit of before) {
    const key = stageKey(visit.stage.categoryId, visit.stage.id);
    byStage.set(key, {
      stage: visit.stage,
      time: (byStage.get(key)?.time ?? 0) + visit.duration,
    });
  }
  const top = [...byStage.entries()].sort((a, b) => b[1].time - a[1].time)[0];
  const total = data.totalDuration;
  const longest =
    top && top[1].time > 0
      ? {
          stage: top[1].stage,
          duration: top[1].time,
          share: total > 0 ? top[1].time / total : 0,
          typical:
            usable && (usable.stageSamples[top[0]] ?? 0) >= MIN_SAMPLE
              ? usable.medianByStage[top[0]]
              : undefined,
        }
      : undefined;
  const ratio =
    usable && usable.medianTotal > 0 ? total / usable.medianTotal : undefined;
  return {
    outcome: won ? "won" : "lost",
    finalStage: finalVisit.stage,
    total,
    stepsBefore: new Set(before.map((v) => v.stage.id)).size,
    skipped,
    returns,
    longest,
    pace:
      usable && ratio !== undefined
        ? {
            ratio,
            typical: usable.medianTotal,
            sample: usable.sample,
            label:
              ratio <= 0.85 ? "faster" : ratio >= 1.15 ? "slower" : "similar",
          }
        : undefined,
  };
}

export const outcomeLabel = (autopsy: Autopsy) =>
  autopsy.outcome === "won" ? "Ganho" : "Perdido";

export function paceSentence(autopsy: Autopsy) {
  const pace = autopsy.pace;
  if (!pace) return undefined;
  const group = autopsy.outcome === "won" ? "ganhos" : "perdidos";
  const percent = Math.round(Math.abs(pace.ratio - 1) * 100);
  const times = pace.ratio.toFixed(1).replace(".", ",");
  const lead =
    pace.label === "similar"
      ? "Ciclo em linha com o típico"
      : pace.label === "faster"
        ? `Ciclo ${percent}% mais curto que o típico`
        : pace.ratio >= 2
          ? `Ciclo ${times}× o típico`
          : `Ciclo ${percent}% mais longo que o típico`;
  return `${lead} (mediana de ${duration(pace.typical)} em ${pace.sample} negócios ${group} deste funil).`;
}

// Texto no formato de comentário do Bitrix24: títulos em [b], sem markdown.
export function autopsyText(data: JourneyData, autopsy: Autopsy) {
  const lines = [
    `[b]Autópsia do negócio · ${outcomeLabel(autopsy)}[/b]`,
    ">>Gerada pelo app Jornada a partir do histórico de etapas.",
    "",
    "[b]Caminho[/b]",
    `${data.visits.map((v) => v.stage.name).join(" → ")} (ciclo de ${duration(autopsy.total)})`,
    "",
    "[b]Desvios do funil[/b]",
    autopsy.skipped.length
      ? `Etapas puladas: ${autopsy.skipped.map((s) => s.name).join(", ")}.`
      : "Etapas puladas: nenhuma.",
    autopsy.returns.length
      ? `Voltas: ${autopsy.returns
          .map((r) => `${r.from.name} → ${r.to.name} (${dateTime(r.at)})`)
          .join("; ")}.`
      : "Voltas: nenhuma.",
  ];
  if (autopsy.longest) {
    const { stage, duration: time, share, typical } = autopsy.longest;
    lines.push(
      "",
      "[b]Onde mais demorou[/b]",
      `${stage.name}: ${duration(time)} (${Math.round(share * 100)}% do ciclo${
        typical !== undefined ? `; típico ${duration(typical)}` : ""
      }).`,
    );
  }
  const pace = paceSentence(autopsy);
  if (pace) lines.push("", "[b]Comparação[/b]", pace);
  return lines.join("\n");
}
