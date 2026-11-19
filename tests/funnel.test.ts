import { describe, expect, it } from "vitest";
import { buildDashboard } from "@/lib/calculations";
import {
  classifyPassage,
  compareStages,
  summarizeFunnel,
  type FunnelOutcome,
} from "@/lib/funnel";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { buildStageInsights } from "@/lib/stage-insights";
import type { Catalog, Deal, HistoryEntry, Stage } from "@/lib/types";

const day = 24 * 3600000;
const now = Date.parse("2026-11-09T12:00:00Z");
const catalog: Catalog = {
  pipelines: [
    { id: 0, name: "Comercial" },
    { id: 1, name: "Outro" },
  ],
  stages: [
    { id: "NEW", name: "Entrada", categoryId: 0, color: "#7894bd", sort: 0 },
    { id: "WORK", name: "Negociação", categoryId: 0, color: "#e90", sort: 1 },
    { id: "WON", name: "Ganho", categoryId: 0, color: "#090", sort: 2 },
    { id: "LOST", name: "Perdido", categoryId: 0, color: "#c33", sort: 3 },
    { id: "X", name: "Outra etapa", categoryId: 1, color: "#999", sort: 0 },
  ],
};
let seq = 0;
const entry = (
  owner: number,
  stage: string,
  daysAgo: number,
  semantic = "P",
  category = 0,
): HistoryEntry => ({
  ID: ++seq,
  OWNER_ID: owner,
  CATEGORY_ID: category,
  STAGE_ID: stage,
  STAGE_SEMANTIC_ID: semantic,
  CREATED_TIME: new Date(now - daysAgo * day).toISOString(),
});
const deal = (
  id: number,
  stageId: string,
  semantic = "P",
  categoryId = 0,
): Deal => ({
  id,
  title: `Negócio ${id}`,
  categoryId,
  stageId,
  stageSemanticId: semantic,
});

// 1: NEW → WORK → WON | 2: NEW → WORK (ainda lá) | 3: NEW → WORK → NEW (voltou)
// 4: NEW → LOST      | 5: NEW → etapa de outro pipeline
const deals = [
  deal(1, "WON", "S"),
  deal(2, "WORK"),
  deal(3, "NEW"),
  deal(4, "LOST", "F"),
  deal(5, "X", "P", 1),
];
const history = [
  entry(1, "NEW", 20),
  entry(1, "WORK", 18),
  entry(1, "WON", 15, "S"),
  entry(2, "NEW", 20),
  entry(2, "WORK", 17),
  entry(3, "NEW", 20),
  entry(3, "WORK", 16),
  entry(3, "NEW", 12),
  entry(4, "NEW", 19),
  entry(4, "LOST", 10, "F"),
  entry(5, "NEW", 14),
  entry(5, "X", 13, "P", 1),
];
const base = {
  from: new Date(now - 30 * day).toISOString(),
  to: new Date(now).toISOString(),
};
const run = (stageStatus?: "open" | "closed" | "all") =>
  buildDashboard(
    deals,
    history,
    catalog,
    { ...base, stageStatus },
    DEFAULT_SETTINGS,
    now,
    false,
  );
const funnelOf = (stageStatus: "open" | "closed" | "all" | undefined) => {
  const stages = buildStageInsights(run(stageStatus), []).pipelines.flatMap(
    (p) => p.stages,
  );
  const get = (id: string) => stages.find((s) => s.stage.id === id)?.funnel;
  return { NEW: get("NEW"), WORK: get("WORK") };
};

describe("funil de conversão por etapa", () => {
  it("classifica o destino de cada entrada, inclusive ganho e perda", () => {
    const { NEW, WORK } = funnelOf("open");
    // Entrada: 1, 2 e 3 avançaram; 4 foi perdido; 3 voltou e está de novo na
    // etapa; 5 saiu para outro pipeline.
    expect(NEW).toMatchObject({
      entries: 6,
      advanced: 3,
      lost: 1,
      staying: 1,
      other: 1,
      returned: 0,
      won: 0,
      left: 5,
    });
    expect(NEW?.advanceRate).toBeCloseTo(3 / 5);
    // Negociação: 1 ganhou, 2 continua lá e 3 voltou para a Entrada.
    expect(WORK).toMatchObject({
      entries: 3,
      won: 1,
      staying: 1,
      returned: 1,
      advanced: 0,
      left: 2,
    });
    expect(WORK?.advanceRate).toBeCloseTo(1 / 2);
  });

  it("não muda com o tipo de etapa: ganho e perda contam mesmo filtrados", () => {
    const open = funnelOf("open");
    expect(funnelOf("all")).toEqual(open);
    // Sem o campo (Visão geral) o destino sai da movimentação seguinte do painel.
    expect(funnelOf(undefined)).toEqual(open);
  });

  it("guarda o destino só quando a aba Etapas pede", () => {
    expect(run(undefined).movements.every((m) => m.exit === undefined)).toBe(
      true,
    );
    const open = run("open");
    // A etapa Perdido nem aparece em "Em andamento", mas o destino continua lá.
    expect(open.movements.some((m) => m.stage.id === "LOST")).toBe(false);
    const toLost = open.movements.find(
      (m) => m.deal.id === 4 && m.stage.id === "NEW",
    );
    expect(toLost?.exit).toEqual({
      categoryId: 0,
      stageId: "LOST",
      semanticId: "F",
    });
    // Negócio que ainda está na etapa não tem destino.
    expect(
      open.movements.find((m) => m.deal.id === 2 && m.stage.id === "WORK")?.exit,
    ).toBeUndefined();
  });
});

describe("classifyPassage / summarizeFunnel", () => {
  const stage = (id: string, sort: number, name = id): Stage => ({
    id,
    name,
    categoryId: 0,
    color: "#000",
    sort,
  });
  const a = stage("A", 1);
  const b = stage("B", 2);
  const lookup = (categoryId: number, id: string) =>
    [a, b].find((s) => s.categoryId === categoryId && s.id === id);
  const exit = (stageId: string, semanticId = "P", categoryId = 0) => ({
    categoryId,
    stageId,
    semanticId,
  });

  it("compara etapas pelo SORT e, em empate, pelo nome", () => {
    expect(compareStages(a, b)).toBeLessThan(0);
    expect(compareStages(stage("X", 1, "Zeta"), stage("Y", 1, "Alfa"))).toBeGreaterThan(
      0,
    );
  });

  it("cobre todos os destinos", () => {
    expect(classifyPassage(a, true, undefined, lookup)).toBe("staying");
    expect(classifyPassage(a, false, undefined, lookup)).toBe("other");
    expect(classifyPassage(a, false, exit("B"), lookup)).toBe("advanced");
    expect(classifyPassage(b, false, exit("A"), lookup)).toBe("returned");
    expect(classifyPassage(a, false, exit("W", "S"), lookup)).toBe("won");
    expect(classifyPassage(a, false, exit("L", "F"), lookup)).toBe("lost");
    // Outro pipeline, etapa removida (fora do catálogo) e mesma etapa.
    expect(classifyPassage(a, false, exit("B", "P", 9), lookup)).toBe("other");
    expect(classifyPassage(a, false, exit("REMOVIDA"), lookup)).toBe("other");
    expect(classifyPassage(a, false, exit("A"), lookup)).toBe("other");
  });

  it("não inventa taxa de avanço quando ninguém saiu da etapa", () => {
    const stat = summarizeFunnel(["staying", "staying"]);
    expect(stat).toMatchObject({ entries: 2, left: 0, staying: 2 });
    expect(stat.advanceRate).toBeUndefined();
    const empty = summarizeFunnel([]);
    expect(empty.entries).toBe(0);
    expect(empty.advanceRate).toBeUndefined();
  });

  it("a soma dos resultados é sempre o total de entradas", () => {
    const outcomes: FunnelOutcome[] = [
      "advanced",
      "won",
      "returned",
      "lost",
      "staying",
      "other",
      "advanced",
    ];
    const stat = summarizeFunnel(outcomes);
    expect(
      stat.advanced +
        stat.won +
        stat.returned +
        stat.lost +
        stat.staying +
        stat.other,
    ).toBe(stat.entries);
    expect(stat.advanceRate).toBeCloseTo(3 / 6);
  });
});
