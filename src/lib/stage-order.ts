import type { Pipeline, Retention } from "./types";

// Ordem da lista "Tempo médio por etapa" (aba Etapas):
// - desc: do maior para o menor tempo médio (padrão);
// - asc: do menor para o maior;
// - funnel: na ordem do funil, da primeira etapa à última.
export type StageOrder = "desc" | "asc" | "funnel";

export const STAGE_ORDERS: StageOrder[] = ["desc", "asc", "funnel"];

export const isStageOrder = (value: unknown): value is StageOrder =>
  value === "desc" || value === "asc" || value === "funnel";

// Ordem do funil: pipelines na ordem do catálogo, etapas pelo campo SORT do
// Bitrix24 e, em empate, pelo nome (mesma regra de stage-insights.ts).
function byFunnel(pipelines: Pipeline[]) {
  const position = new Map(pipelines.map((p, i) => [p.id, i]));
  const place = (id: number) => position.get(id) ?? pipelines.length + id;
  return (a: Retention, b: Retention) =>
    place(a.stage.categoryId) - place(b.stage.categoryId) ||
    a.stage.sort - b.stage.sort ||
    a.stage.name.localeCompare(b.stage.name, "pt-BR");
}

export function sortRetention(
  rows: Retention[],
  order: StageOrder,
  pipelines: Pipeline[],
): Retention[] {
  const funnel = byFunnel(pipelines);
  if (order === "funnel") return [...rows].sort(funnel);
  const sign = order === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    // Etapas sem passagem no período não têm tempo para comparar: vão ao fim
    // nas duas direções (em "Crescente" não podem abrir a lista com zero).
    if (a.visits > 0 !== b.visits > 0) return a.visits > 0 ? -1 : 1;
    return sign * (a.average - b.average) || funnel(a, b);
  });
}
