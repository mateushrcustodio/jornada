import type { Stage, StageExit } from "./types";

// Funil de conversão da aba Etapas. Cada passagem por uma etapa (uma entrada no
// período) termina em um destes resultados, olhando a movimentação seguinte do
// negócio no histórico:
// - advanced: foi para uma etapa à frente no mesmo funil;
// - returned: voltou para uma etapa anterior;
// - won / lost: foi para uma etapa de ganho / perda;
// - staying: o negócio ainda está na etapa;
// - other: saiu para outro pipeline, para uma etapa removida ou sem destino no
//   histórico.
export type FunnelOutcome =
  | "advanced"
  | "returned"
  | "won"
  | "lost"
  | "staying"
  | "other";

export const FUNNEL_OUTCOMES: FunnelOutcome[] = [
  "advanced",
  "won",
  "returned",
  "lost",
  "staying",
  "other",
];

export const FUNNEL_LABELS: Record<FunnelOutcome, string> = {
  advanced: "Avançou",
  won: "Ganho",
  returned: "Voltou",
  lost: "Perdido",
  staying: "Ainda na etapa",
  other: "Outro destino",
};

export interface FunnelStat extends Record<FunnelOutcome, number> {
  // Passagens com entrada no período (soma de todos os resultados).
  entries: number;
  // Passagens que já saíram da etapa (entradas menos as que ainda estão nela).
  left: number;
  // Das que saíram, a parte que foi para uma etapa à frente ou para ganho.
  // Indefinida enquanto ninguém saiu: não há o que dividir.
  advanceRate?: number;
}

// Ordem do funil: campo SORT do Bitrix24 e, em empate, o nome (mesma regra de
// stage-insights.ts e stage-order.ts).
export const compareStages = (a: Stage, b: Stage) =>
  a.sort - b.sort || a.name.localeCompare(b.name, "pt-BR");

export function classifyPassage(
  from: Stage,
  current: boolean,
  exit: StageExit | undefined,
  lookup: (categoryId: number, stageId: string) => Stage | undefined,
): FunnelOutcome {
  if (current) return "staying";
  if (!exit) return "other";
  if (exit.semanticId === "S") return "won";
  if (exit.semanticId === "F") return "lost";
  if (exit.categoryId !== from.categoryId) return "other";
  const to = lookup(exit.categoryId, exit.stageId);
  if (!to || to.id === from.id) return "other";
  return compareStages(to, from) > 0 ? "advanced" : "returned";
}

export function summarizeFunnel(outcomes: FunnelOutcome[]): FunnelStat {
  const stat: FunnelStat = {
    entries: outcomes.length,
    left: 0,
    advanced: 0,
    returned: 0,
    won: 0,
    lost: 0,
    staying: 0,
    other: 0,
  };
  for (const outcome of outcomes) stat[outcome]++;
  stat.left = stat.entries - stat.staying;
  stat.advanceRate = stat.left
    ? (stat.advanced + stat.won) / stat.left
    : undefined;
  return stat;
}
