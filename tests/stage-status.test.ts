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
    {
      id: "WORK",
      name: "Negociação",
      categoryId: 0,
      color: "#ee9900",
      sort: 1,
    },
    {
      id: "WON",
      name: "Primeira Op",
      categoryId: 0,
      color: "#009900",
      sort: 2,
    },
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

const byId = (data: ReturnType<typeof run>, id: string) =>
  data.retention.find((r) => r.stage.id === id)!;

describe("tipo de etapa na aba Etapas", () => {
  it("em andamento mostra só as etapas normais, inclusive dos negócios que depois fecharam", () => {
    const data = run("open");
    expect(stageIds(data)).toEqual(["NEW", "WORK"]);
    expect(data.retention.every((r) => !r.final)).toBe(true);
    expect(byId(data, "NEW").visits).toBe(2);
    expect(byId(data, "WORK").currentDeals).toBe(1);
  });
  it("finalizados mostra só as etapas de conclusão, sem tempo e sem negócios atuais", () => {
    const data = run("closed");
    expect(stageIds(data)).toEqual(["WON"]);
    const final = byId(data, "WON");
    expect(final.final).toBe(true);
    expect(final.visits).toBe(1);
    expect(final.sampleDeals).toBe(1);
    expect(final.average).toBe(0);
    expect(data.retention.every((r) => r.currentDeals === 0)).toBe(true);
    expect(data.stalled).toHaveLength(0);
  });
  it("em andamento + finalizados reúne as duas, e o tempo das etapas normais não muda", () => {
    const open = run("open");
    const all = run("all");
    expect(stageIds(all)).toEqual(["NEW", "WON", "WORK"]);
    expect(byId(all, "NEW")).toEqual(byId(open, "NEW"));
    expect(byId(all, "WORK")).toEqual(byId(open, "WORK"));
    expect(byId(all, "WON").final).toBe(true);
  });
  it("sem o campo (Visão geral) o resultado é o mesmo de todas as etapas", () => {
    expect(run(undefined)).toEqual(run("all"));
  });
  it("etapa de ganho reaberta, com duração real, aparece em finalizados sem ser final", () => {
    const reopened = buildDashboard(
      [{ ...won, stageId: "WORK", stageSemanticId: "P" }],
      [entry(2, "WON", 5), entry(2, "WORK", 1)],
      catalog,
      { ...base, stageStatus: "closed" },
      DEFAULT_SETTINGS,
      now,
      false,
    );
    const stage = byId(reopened, "WON");
    expect(stage.average).toBe(4 * hour);
    expect(stage.final).toBe(false);
  });
  it("matchesStageStatus e o esquema aceitam só os três valores", () => {
    expect(matchesStageStatus("P", "open")).toBe(true);
    expect(matchesStageStatus("S", "open")).toBe(false);
    expect(matchesStageStatus("F", "closed")).toBe(true);
    expect(matchesStageStatus("P", "closed")).toBe(false);
    expect(matchesStageStatus("S", "all")).toBe(true);
    expect(matchesStageStatus("S")).toBe(true);
    for (const status of STAGE_STATUSES) {
      expect(isStageStatus(status)).toBe(true);
      expect(
        filtersSchema.safeParse({ ...base, stageStatus: status }).success,
      ).toBe(true);
    }
    expect(isStageStatus("tudo")).toBe(false);
    expect(
      filtersSchema.safeParse({ ...base, stageStatus: "tudo" }).success,
    ).toBe(false);
  });
});
