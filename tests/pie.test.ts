import { describe, expect, it } from "vitest";
import { buildStagePie, shareTenths } from "@/lib/pie";
import type { StageInsight } from "@/lib/stage-insights";

const hour = 3600000;
function stage(i: number, average: number, passages = average ? 3 : 0) {
  return {
    key: `0:S${i}`,
    stage: {
      id: `S${i}`,
      name: `Etapa ${i}`,
      categoryId: 0,
      color: "#000",
      sort: i,
    },
    average,
    passages,
  } as unknown as StageInsight;
}

describe("shareTenths", () => {
  it("soma exatamente 100,0% mesmo com restos", () => {
    const tenths = shareTenths([1, 1, 1]);
    expect(tenths.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(tenths).toEqual([334, 333, 333]);
  });
  it("mantém a proporção e trata total zero", () => {
    expect(shareTenths([3, 1])).toEqual([750, 250]);
    expect(shareTenths([0, 0])).toEqual([0, 0]);
    expect(shareTenths([])).toEqual([]);
  });
});

describe("buildStagePie", () => {
  it("fatias proporcionais ao tempo médio, na ordem do funil", () => {
    const pie = buildStagePie([
      stage(0, 1 * hour),
      stage(1, 3 * hour),
      stage(2, 4 * hour),
    ]);
    expect(pie.slices.map((s) => s.label)).toEqual([
      "Etapa 0",
      "Etapa 1",
      "Etapa 2",
    ]);
    expect(pie.slices.map((s) => s.share)).toEqual([12.5, 37.5, 50]);
    expect(pie.total).toBe(8 * hour);
    expect(pie.slices.map((s) => s.color)).toEqual([
      "var(--pie-1)",
      "var(--pie-2)",
      "var(--pie-3)",
    ]);
  });
  it("etapa sem passagem fica fora da pizza e a cor não muda", () => {
    const pie = buildStagePie([
      stage(0, 2 * hour),
      stage(1, 0),
      stage(2, 2 * hour),
    ]);
    expect(pie.slices.map((s) => s.key)).toEqual(["0:S0", "0:S2"]);
    expect(pie.empty.map((s) => s.key)).toEqual(["0:S1"]);
    // A etapa 2 continua com a 3ª cor, como se a etapa 1 tivesse tempo.
    expect(pie.colors.get("0:S2")).toBe("var(--pie-3)");
  });
  it("mais de 8 etapas: as 7 primeiras têm cor, o resto vira Outras etapas", () => {
    const stages = Array.from({ length: 10 }, (_, i) =>
      stage(i, (i + 1) * hour),
    );
    const pie = buildStagePie(stages);
    expect(pie.slices).toHaveLength(8);
    const other = pie.slices[7];
    expect(other.label).toBe("Outras etapas (3)");
    expect(other.value).toBe((8 + 9 + 10) * hour);
    expect(other.members?.map((m) => m.label)).toEqual([
      "Etapa 7",
      "Etapa 8",
      "Etapa 9",
    ]);
    expect(pie.total).toBe(55 * hour);
    expect(pie.slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(100);
  });
});
