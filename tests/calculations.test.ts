import { describe, expect, it } from "vitest";
import {
  buildDashboard,
  buildJourney,
  calculateVisits,
  stageKey,
} from "@/lib/calculations";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import type { Catalog, Deal, HistoryEntry } from "@/lib/types";
import { periodRange } from "@/lib/format";
const hour = 3600000;
const now = Date.parse("2026-11-09T12:00:00Z");
const catalog: Catalog = {
  pipelines: [
    { id: 0, name: "Comercial" },
    { id: 3, name: "Enterprise" },
  ],
  stages: [
    { id: "NEW", name: "Entrada", categoryId: 0, color: "#7894bd", sort: 0 },
    {
      id: "WORK",
      name: "Negociação",
      categoryId: 0,
      color: "#ee9900",
      sort: 1,
    },
    { id: "WON", name: "Ganho", categoryId: 0, color: "#009900", sort: 2 },
  ],
};
const deal: Deal = {
  id: 1,
  title: "Teste",
  categoryId: 0,
  stageId: "WORK",
  stageSemanticId: "P",
};
function entry(
  id: number,
  stage: string,
  hoursAgo: number,
  owner = 1,
): HistoryEntry {
  return {
    ID: id,
    OWNER_ID: owner,
    CATEGORY_ID: 0,
    STAGE_ID: stage,
    STAGE_SEMANTIC_ID: stage === "WON" ? "S" : "P",
    CREATED_TIME: new Date(now - hoursAgo * hour).toISOString(),
  };
}
const filters = {
  from: new Date(now - 7 * 24 * hour).toISOString(),
  to: new Date(now).toISOString(),
};
describe("cálculos de jornada", () => {
  it("usa movedBy somente na entrada atual com o mesmo instante da última mudança", () => {
    const history = [entry(1, "NEW", 10), entry(2, "WORK", 4)];
    const current = {
      ...deal,
      movedBy: 17,
      movedTime: history[1].CREATED_TIME,
    };
    expect(
      calculateVisits(history, current, catalog, now).map((v) => v.actor),
    ).toEqual([undefined, "Usuário #17"]);
    expect(
      calculateVisits(
        history,
        { ...current, movedTime: history[0].CREATED_TIME },
        catalog,
        now,
      )[1].actor,
    ).toBeUndefined();
  });
  it("ordena, remove duplicatas e calcula etapas concluídas e atual", () => {
    const first = entry(1, "NEW", 10);
    const visits = calculateVisits(
      [entry(2, "WORK", 4), first, first],
      deal,
      catalog,
      now,
    );
    expect(visits.map((v) => v.duration)).toEqual([6 * hour, 4 * hour]);
    expect(visits.map((v) => v.current)).toEqual([false, true]);
    expect(visits[1].previousStage?.name).toBe("Entrada");
    expect(visits[1].actor).toBeUndefined();
  });
  it("encerra o total em ganho/perda e zera a permanência terminal", () => {
    const result = buildJourney(
      { ...deal, stageId: "WON", stageSemanticId: "S" },
      [entry(1, "NEW", 48), entry(2, "WORK", 24), entry(3, "WON", 8)],
      catalog,
      now,
      false,
    );
    expect(result.totalDuration).toBe(40 * hour);
    expect(result.visits.at(-1)?.duration).toBe(0);
  });
  it("preserva revisitas e não infere autoria do responsável", () => {
    const result = buildJourney(
      { ...deal, stageId: "NEW" },
      [entry(1, "NEW", 12), entry(2, "WORK", 10), entry(3, "NEW", 4)],
      catalog,
      now,
      false,
    );
    expect(result.visits).toHaveLength(3);
    expect(result.visits.map((v) => v.duration)).toEqual([
      2 * hour,
      6 * hour,
      4 * hour,
    ]);
    expect(result.totalDuration).toBe(12 * hour);
  });
  it("lida com histórico vazio e discrepância da etapa atual", () => {
    expect(buildJourney(deal, [], catalog, now, false).totalDuration).toBe(0);
    const mismatch = buildJourney(
      deal,
      [entry(1, "NEW", 3)],
      catalog,
      now,
      false,
    );
    expect(mismatch.warning).toBeTruthy();
    expect(mismatch.visits[0].current).toBe(false);
  });
  it("usa ID para desempatar entradas no mesmo instante", () => {
    const visits = calculateVisits(
      [entry(2, "WORK", 4), entry(1, "NEW", 4)],
      deal,
      catalog,
      now,
    );
    expect(visits.map((v) => v.entry.ID)).toEqual([1, 2]);
    expect(visits[0].duration).toBe(0);
  });
});
describe("painel e retenção", () => {
  it("inclui negócios parados sem movimentos recentes e respeita >= limite", () => {
    const result = buildDashboard(
      [deal],
      [entry(1, "WORK", 200)],
      catalog,
      filters,
      { ...DEFAULT_SETTINGS, stalledHours: 200 },
      now,
      false,
    );
    expect(result.movements).toHaveLength(0);
    expect(result.stalled).toHaveLength(1);
    expect(result.activeCount).toBe(1);
  });
  it("não considera ganhos ou perdidos como parados", () => {
    const result = buildDashboard(
      [{ ...deal, stageId: "WON", stageSemanticId: "S" }],
      [entry(1, "WON", 100)],
      catalog,
      filters,
      DEFAULT_SETTINGS,
      now,
      false,
    );
    expect(result.stalled).toHaveLength(0);
    expect(result.activeCount).toBe(0);
  });
  it("filtra a seleção depois da duração para preservar a etapa seguinte", () => {
    const result = buildDashboard(
      [deal],
      [entry(1, "NEW", 10), entry(2, "WORK", 4)],
      catalog,
      { ...filters, stage: "NEW" },
      DEFAULT_SETTINGS,
      now,
      false,
    );
    expect(result.movements).toHaveLength(1);
    expect(result.retention[0].average).toBe(6 * hour);
  });
  it("ordena retenção por média e conta negócios únicos versus passagens", () => {
    const result = buildDashboard(
      [{ ...deal, stageId: "NEW" }],
      [entry(1, "NEW", 20), entry(2, "WORK", 18), entry(3, "NEW", 2)],
      catalog,
      filters,
      DEFAULT_SETTINGS,
      now,
      false,
    );
    expect(result.retention[0].stage.id).toBe("WORK");
    expect(result.retention[1].sampleDeals).toBe(1);
    expect(result.retention[1].visits).toBe(2);
  });
  it("isola pipelines e etapas ignoradas sem quebrar a sequência", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      ignoredStages: [stageKey(0, "NEW")],
    };
    const result = buildDashboard(
      [deal],
      [entry(1, "NEW", 10), entry(2, "WORK", 4)],
      catalog,
      filters,
      settings,
      now,
      false,
    );
    expect(result.movements.map((m) => m.stage.id)).toEqual(["WORK"]);
    expect(
      buildDashboard(
        [deal],
        [entry(1, "WORK", 5)],
        catalog,
        filters,
        { ...settings, monitoredPipelines: [3] },
        now,
        false,
      ).retention,
    ).toHaveLength(0);
  });
  it("aplica o fuso de Brasília nos dias personalizados e Hoje", () => {
    expect(periodRange("today", new Date("2026-11-09T01:00:00Z")).from).toBe(
      "2026-11-08T03:00:00.000Z",
    );
    expect(
      periodRange("custom", new Date(now), "2026-11-01", "2026-11-02"),
    ).toEqual({
      from: "2026-11-01T03:00:00.000Z",
      to: "2026-11-03T02:59:59.999Z",
    });
  });
});
