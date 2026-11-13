import { describe, expect, it } from "vitest";
import { buildDashboard, stageKey } from "@/lib/calculations";
import { demoDataset } from "@/lib/demo";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import {
  buildStageInsights,
  durationTicks,
  percentile,
} from "@/lib/stage-insights";
import type { Catalog, Deal, HistoryEntry } from "@/lib/types";

const hour = 3600000;
const day = 24 * hour;
const now = Date.parse("2026-11-09T12:00:00Z");
const catalog: Catalog = {
  pipelines: [{ id: 0, name: "Comercial" }],
  stages: [
    { id: "NEW", name: "Entrada", categoryId: 0, color: "#7894bd", sort: 0 },
    { id: "WORK", name: "Negociação", categoryId: 0, color: "#e90", sort: 1 },
    { id: "WON", name: "Ganho", categoryId: 0, color: "#090", sort: 2 },
  ],
};
const entry = (
  id: number,
  owner: number,
  stage: string,
  at: number,
  semantic = "P",
): HistoryEntry => ({
  ID: id,
  OWNER_ID: owner,
  CATEGORY_ID: 0,
  STAGE_ID: stage,
  STAGE_SEMANTIC_ID: semantic,
  CREATED_TIME: new Date(at).toISOString(),
});

function scenario() {
  const deals: Deal[] = [
    {
      id: 1,
      title: "A",
      categoryId: 0,
      stageId: "WON",
      stageSemanticId: "S",
      assignedById: 7,
      opportunity: 1000,
      currencyId: "BRL",
    },
    {
      id: 2,
      title: "B",
      categoryId: 0,
      stageId: "WORK",
      stageSemanticId: "P",
      assignedById: 8,
      opportunity: 500,
      currencyId: "BRL",
    },
    {
      id: 3,
      title: "C",
      categoryId: 0,
      stageId: "WORK",
      stageSemanticId: "P",
      opportunity: 99,
      currencyId: "USD",
    },
  ];
  const history = [
    entry(1, 1, "NEW", now - 10 * day),
    entry(2, 1, "WORK", now - 9 * day),
    entry(3, 1, "WON", now - 5 * day, "S"),
    entry(4, 2, "NEW", now - 8 * day),
    entry(5, 2, "WORK", now - 6 * day),
    entry(6, 3, "NEW", now - 3 * day),
    entry(7, 3, "WORK", now - 2 * day),
  ];
  const data = buildDashboard(
    deals,
    history,
    catalog,
    {
      from: new Date(now - 30 * day).toISOString(),
      to: new Date(now).toISOString(),
    },
    { ...DEFAULT_SETTINGS, stalledHours: 48 },
    now,
    false,
  );
  return buildStageInsights(data, [
    { id: 7, name: "Ana" },
    { id: 8, name: "Bruno" },
  ]);
}

describe("buildStageInsights", () => {
  it("ordena pelo funil, separa etapas finais e acha o gargalo", () => {
    const [pipeline] = scenario().pipelines;
    expect(pipeline.stages.map((s) => s.stage.id)).toEqual([
      "NEW",
      "WORK",
      "WON",
    ]);
    expect(pipeline.stages.find((s) => s.stage.id === "WON")?.final).toBe(true);
    expect(pipeline.bottleneck?.stage.id).toBe("WORK");
    // Passagens abertas: NEW (1d, 2d, 1d) e WORK (4d, 6d, 2d) = 16d / 6.
    expect(pipeline.average).toBeCloseTo((16 * day) / 6);
    expect(pipeline.passages).toBe(6);
  });

  it("calcula tempos, responsáveis, faturamento e fluxo da etapa", () => {
    const insights = scenario();
    expect(insights.currency).toBe("BRL");
    expect(insights.otherCurrencyDeals).toBe(1);
    const work = insights.pipelines[0].stages.find(
      (s) => s.stage.id === "WORK",
    )!;
    expect(work.passages).toBe(3);
    expect(work.average).toBeCloseTo(4 * day);
    expect(work.median).toBe(4 * day);
    expect(work.minimum).toBe(2 * day);
    expect(work.maximum).toBe(6 * day);
    expect(work.open).toBe(2);
    // USD fica fora da soma; cada negócio conta uma vez.
    expect(work.revenue).toBe(1500);
    expect(work.stalledDeals).toBe(2);
    expect(work.stalledRevenue).toBe(500);
    expect(work.assignees.map((a) => a.name)).toEqual([
      "Bruno",
      "Ana",
      "Sem responsável",
    ]);
    expect(work.sources).toEqual([
      expect.objectContaining({ label: "Entrada", count: 3 }),
    ]);
    expect(work.exits).toEqual([
      expect.objectContaining({ label: "Ganho", count: 1 }),
    ]);
    expect(work.slowest[0]).toMatchObject({
      duration: 6 * day,
      current: true,
      deal: expect.objectContaining({ id: 2, assignee: "Bruno" }),
    });
    expect(work.slowest.find((p) => p.deal.id === 1)?.next?.id).toBe("WON");
    expect(work.buckets.reduce((sum, b) => sum + b.count, 0)).toBe(3);
  });

  it("usa a mesma média da tabela de etapas no modo demo", () => {
    const at = Date.now();
    const demo = demoDataset(at);
    const data = buildDashboard(
      demo.deals,
      demo.history,
      demo.catalog,
      {
        from: new Date(at - 30 * day).toISOString(),
        to: new Date(at).toISOString(),
      },
      DEFAULT_SETTINGS,
      at,
      true,
    );
    const insights = buildStageInsights(data, []);
    const stages = insights.pipelines.flatMap((p) => p.stages);
    expect(stages).toHaveLength(data.retention.length);
    for (const row of data.retention) {
      const stage = stages.find(
        (s) => s.key === stageKey(row.stage.categoryId, row.stage.id),
      )!;
      expect(stage.average).toBe(row.average);
      expect(stage.passages).toBe(row.visits);
    }
    // Nome do responsável vem do próprio negócio quando já resolvido.
    expect(
      stages
        .flatMap((s) => s.assignees)
        .every((a) => !a.name.startsWith("Usuário")),
    ).toBe(true);
  });
});

describe("auxiliares", () => {
  it("percentil interpolado", () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1);
  });
  it("marcas de eixo redondas", () => {
    expect(durationTicks(3.3 * day)).toEqual({
      top: 4 * day,
      ticks: [0, day, 2 * day, 3 * day, 4 * day],
    });
    expect(durationTicks(0).ticks).toEqual([0, hour]);
  });
});
