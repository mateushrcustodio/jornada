import type { StageInsight } from "./stage-insights";

// Visão em pizza do tempo médio por etapa. Cada fatia é o tempo médio da etapa
// dividido pela soma dos tempos médios das etapas (o "tempo típico" de um
// negócio que passa por todas). Os valores são os mesmos do gráfico de colunas;
// só muda a forma de desenhar.

// A paleta categórica validada tem 8 posições; acima disso, o resto vira "Outras".
export const PIE_SLOTS = 8;

export interface PieSlice {
  key: string;
  label: string;
  // Tempo médio em ms (ou a soma, quando a fatia reúne várias etapas).
  value: number;
  // Percentual com 1 casa; todas as fatias somam exatamente 100,0.
  share: number;
  color: string;
  // Presente só na fatia "Outras etapas".
  members?: { key: string; label: string; value: number }[];
}
export interface PieModel {
  slices: PieSlice[];
  total: number;
  // Cor de cada etapa; a cor segue a etapa, não o tamanho da fatia.
  colors: Map<string, string>;
  // Etapas sem tempo medido no período: ficam fora da pizza, nunca como zero.
  empty: StageInsight[];
}

// Percentuais em décimos (1000 = 100,0%) que somam exatamente 1000, pelo método
// dos maiores restos. Evita "33,3 + 33,3 + 33,3 = 99,9" na legenda.
export function shareTenths(values: number[]): number[] {
  const total = values.reduce((sum, v) => sum + v, 0);
  if (!(total > 0)) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 1000);
  const tenths = raw.map(Math.floor);
  let left = 1000 - tenths.reduce((sum, v) => sum + v, 0);
  const order = raw
    .map((v, i) => ({ i, rest: v - Math.floor(v) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    tenths[i]++;
    left--;
  }
  return tenths;
}

export const pieColor = (slot: number) => `var(--pie-${slot + 1})`;

export function buildStagePie(stages: StageInsight[]): PieModel {
  const measured = (s: StageInsight) => s.passages > 0 && s.average > 0;
  // Com mais de 8 etapas, as 7 primeiras têm cor própria e o resto é "Outras".
  const own = stages.length > PIE_SLOTS ? PIE_SLOTS - 1 : stages.length;
  const colors = new Map<string, string>();
  const entries: Omit<PieSlice, "share">[] = [];
  const tail: { key: string; label: string; value: number }[] = [];
  stages.forEach((stage, i) => {
    if (i >= own) {
      colors.set(stage.key, "var(--pie-other)");
      if (measured(stage))
        tail.push({
          key: stage.key,
          label: stage.stage.name,
          value: stage.average,
        });
      return;
    }
    colors.set(stage.key, pieColor(i));
    if (measured(stage))
      entries.push({
        key: stage.key,
        label: stage.stage.name,
        value: stage.average,
        color: pieColor(i),
      });
  });
  if (tail.length)
    entries.push({
      key: "other",
      label: `Outras etapas (${tail.length})`,
      value: tail.reduce((sum, m) => sum + m.value, 0),
      color: "var(--pie-other)",
      members: tail,
    });
  const tenths = shareTenths(entries.map((e) => e.value));
  return {
    slices: entries.map((e, i) => ({ ...e, share: tenths[i] / 10 })),
    total: entries.reduce((sum, e) => sum + e.value, 0),
    colors,
    empty: stages.filter((s) => !measured(s)),
  };
}
