import { describe, expect, it } from "vitest";
import { buildDashboard, matchesStageStatus } from "@/lib/calculations";
import { DEFAULT_SETTINGS, filtersSchema } from "@/lib/settings";
import { buildStageInsights } from "@/lib/stage-insights";
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
    const legacy = run(undefined);
    const all = run("all");
    // Só o ciclo até concluir (extra da aba Etapas) separa as duas respostas.
    const noCycle = (data: typeof all) =>
      data.movements.map(({ cycle, ...rest }) => (void cycle, rest));
    expect(noCycle(all)).toEqual(noCycle(legacy));
    expect(all.retention).toEqual(legacy.retention);
    expect(legacy.movements.every((m) => m.cycle === undefined)).toBe(true);
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

describe("estatísticas das etapas de conclusão", () => {
  // Negócio ganho: NEW 10h atrás, WORK 6h, WON 4h => ciclo de 6h até concluir.
  // Segundo negócio perdido em outra etapa final, para testar ticket e médias.
  const won2: Deal = {
    id: 3,
    title: "Ganho 2",
    categoryId: 0,
    stageId: "WON",
    stageSemanticId: "S",
    opportunity: 3000,
    currencyId: "BRL",
    assignedById: 7,
    assignedByName: "Ana",
  };
  const wonValued: Deal = {
    ...won,
    opportunity: 1000,
    currencyId: "BRL",
    assignedById: 7,
    assignedByName: "Ana",
  };
  const more = [
    ...history,
    entry(3, "NEW", 30),
    entry(3, "WORK", 20),
    entry(3, "WON", 2),
  ];
  const build = (stageStatus: "open" | "closed" | "all" | undefined) =>
    buildDashboard(
      [open, wonValued, won2],
      more,
      catalog,
      { ...base, stageStatus },
      DEFAULT_SETTINGS,
      now,
      false,
    );
  it("calcula o ciclo desde a primeira etapa só em finalizados e em todas", () => {
    const cycles = (status: "open" | "closed" | "all" | undefined) =>
      build(status)
        .movements.filter((m) => m.cycle !== undefined)
        .map((m) => [m.deal.id, m.cycle]);
    expect(cycles("closed").sort()).toEqual([
      [2, 6 * hour],
      [3, 28 * hour],
    ]);
    expect(cycles("all").sort()).toEqual(cycles("closed").sort());
    expect(cycles("open")).toEqual([]);
    expect(cycles(undefined)).toEqual([]);
  });
  it("resume a etapa final com faturamento, ticket, ciclo, origem e responsável", () => {
    const insights = buildStageInsights(build("closed"), []);
    const stage = insights.pipelines[0].stages.find((s) => s.final)!;
    expect(stage.stage.id).toBe("WON");
    expect(stage.deals).toBe(2);
    expect(stage.revenue).toBe(4000);
    expect(stage.ticket).toBe(2000);
    expect(stage.cycle).toEqual({
      average: 17 * hour,
      median: 17 * hour,
      maximum: 28 * hour,
      samples: 2,
    });
    expect(stage.sources.map((s) => [s.label, s.count])).toEqual([
      ["Negociação", 2],
    ]);
    const ana = stage.assignees.find((a) => a.name === "Ana")!;
    expect(ana.deals).toBe(2);
    expect(ana.revenue).toBe(4000);
  });
  it("etapas normais não ganham ciclo", () => {
    const insights = buildStageInsights(build("all"), []);
    const normal = insights.pipelines[0].stages.filter((s) => !s.final);
    expect(normal.every((s) => s.cycle === undefined)).toBe(true);
  });
});
