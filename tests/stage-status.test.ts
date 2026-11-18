import { describe, expect, it } from "vitest";
import { buildDashboard, matchesStageStatus } from "@/lib/calculations";
import { DEFAULT_SETTINGS, filtersSchema } from "@/lib/settings";
import { isStageStatus, STAGE_STATUSES } from "@/lib/stage-status";
import type { Catalog, Deal, HistoryEntry } from "@/lib/types";

const hour = 3600000;
const now = Date.parse("2026-11-09T12:00:00Z");
const catalog: Catalog = {
  pipelines: [{ id: 0, name: "Comercial" }],
  stages: [
    { id: "NEW", name: "Entrada", categoryId: 0, color: "#7894bd", sort: 0 },
    { id: "WORK", name: "Negociação", categoryId: 0, color: "#ee9900", sort: 1 },
    { id: "WON", name: "Primeira Op", categoryId: 0, color: "#009900", sort: 2 },
  ],
};
const open: Deal = {
  id: 1,
  title: "Em andamento",
  categoryId: 0,
  stageId: "WORK",
  stageSemanticId: "P",
};
const won: Deal = {
  id: 2,
  title: "Ganho",
  categoryId: 0,
  stageId: "WON",
  stageSemanticId: "S",
};
let entryId = 1;
function entry(owner: number, stage: string, hoursAgo: number): HistoryEntry {
  return {
    ID: entryId++,
    OWNER_ID: owner,
    CATEGORY_ID: 0,
    STAGE_ID: stage,
    STAGE_SEMANTIC_ID: stage === "WON" ? "S" : "P",
    CREATED_TIME: new Date(now - hoursAgo * hour).toISOString(),
  };
}
const history = [
  entry(1, "NEW", 8),
  entry(1, "WORK", 2),
  entry(2, "NEW", 10),
  entry(2, "WORK", 6),
  entry(2, "WON", 4),
];
const base = {
  from: new Date(now - 7 * 24 * hour).toISOString(),
  to: new Date(now).toISOString(),
};
const run = (stageStatus?: "open" | "closed" | "all") =>
  buildDashboard(
    [open, won],
    history,
    catalog,
    { ...base, stageStatus },
    DEFAULT_SETTINGS,
    now,
    false,
  );
const stageIds = (data: ReturnType<typeof run>) =>
  data.retention.map((r) => r.stage.id).sort();

describe("situação dos negócios na aba Etapas", () => {
  it("em andamento (padrão) ignora os negócios ganhos e perdidos", () => {
    const data = run("open");
    expect(new Set(data.movements.map((m) => m.deal.id))).toEqual(new Set([1]));
    expect(stageIds(data)).toEqual(["NEW", "WORK"]);
    expect(data.retention.every((r) => !r.final)).toBe(true);
    expect(data.activeCount).toBe(1);
  });
  it("finalizados traz só os fechados; a etapa final fica sem tempo", () => {
    const data = run("closed");
    expect(new Set(data.movements.map((m) => m.deal.id))).toEqual(new Set([2]));
    expect(stageIds(data)).toEqual(["NEW", "WON", "WORK"]);
    const final = data.retention.find((r) => r.stage.id === "WON")!;
    expect(final.final).toBe(true);
    expect(final.visits).toBe(1);
    expect(final.sampleDeals).toBe(1);
    expect(final.average).toBe(0);
    // O tempo das etapas anteriores do negócio fechado continua real.
    expect(data.retention.find((r) => r.stage.id === "NEW")!.average).toBe(
      4 * hour,
    );
    // Negócio fechado não é "atual" nem "parado".
    expect(data.retention.every((r) => r.currentDeals === 0)).toBe(true);
    expect(data.activeCount).toBe(0);
  });
  it("em andamento + finalizados soma os dois grupos", () => {
    const data = run("all");
    expect(new Set(data.movements.map((m) => m.deal.id))).toEqual(
      new Set([1, 2]),
    );
    expect(data.retention.find((r) => r.stage.id === "NEW")!.visits).toBe(2);
    expect(data.retention.find((r) => r.stage.id === "WON")!.final).toBe(true);
  });
  it("sem o campo (Visão geral) o resultado é o mesmo de todos os negócios", () => {
    expect(run(undefined)).toEqual(run("all"));
  });
  it("etapa de ganho reaberta, com duração real, deixa de ser final", () => {
    const reopened = buildDashboard(
      [{ ...won, stageId: "WORK", stageSemanticId: "P" }],
      [entry(2, "WON", 5), entry(2, "WORK", 1)],
      catalog,
      { ...base, stageStatus: "all" },
      DEFAULT_SETTINGS,
      now,
      false,
    );
    const stage = reopened.retention.find((r) => r.stage.id === "WON")!;
    expect(stage.average).toBe(4 * hour);
    expect(stage.final).toBe(false);
  });
  it("matchesStageStatus e o esquema aceitam só os três valores", () => {
    expect(matchesStageStatus(open, "open")).toBe(true);
    expect(matchesStageStatus(won, "open")).toBe(false);
    expect(matchesStageStatus(won, "closed")).toBe(true);
    expect(matchesStageStatus(open, "closed")).toBe(false);
    expect(matchesStageStatus(won, "all")).toBe(true);
    expect(matchesStageStatus(won)).toBe(true);
    for (const status of STAGE_STATUSES) {
      expect(isStageStatus(status)).toBe(true);
      expect(filtersSchema.safeParse({ ...base, stageStatus: status }).success).toBe(true);
    }
    expect(isStageStatus("tudo")).toBe(false);
    expect(filtersSchema.safeParse({ ...base, stageStatus: "tudo" }).success).toBe(false);
  });
});
