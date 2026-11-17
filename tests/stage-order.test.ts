import { describe, expect, it } from "vitest";
import { sortRetention, sortRetentionByMaximum } from "@/lib/stage-order";
import type { Pipeline, Retention } from "@/lib/types";

const pipelines: Pipeline[] = [
  { id: 1, name: "Novos Negócios" },
  { id: 2, name: "Renovações" },
];

function row(
  categoryId: number,
  id: string,
  sort: number,
  average: number,
  visits = average > 0 ? 3 : 0,
): Retention {
  return {
    stage: { id, name: id, categoryId, color: "#000", sort },
    pipeline: pipelines.find((p) => p.id === categoryId)?.name ?? "",
    average,
    maximum: average,
    sampleDeals: visits,
    visits,
    currentDeals: 0,
    stalledDeals: 0,
  };
}

const rows = [
  row(1, "B", 20, 5),
  row(1, "A", 10, 9),
  row(1, "D", 40, 0),
  row(1, "C", 30, 2),
];
const names = (list: Retention[]) => list.map((r) => r.stage.id);

describe("sortRetention", () => {
  it("decrescente: maior tempo primeiro, sem passagem por último", () => {
    expect(names(sortRetention(rows, "desc", pipelines))).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });
  it("crescente: menor tempo primeiro, sem passagem continua por último", () => {
    expect(names(sortRetention(rows, "asc", pipelines))).toEqual([
      "C",
      "B",
      "A",
      "D",
    ]);
  });
  it("funil: pela ordem das etapas, mesmo sem passagem", () => {
    expect(names(sortRetention(rows, "funnel", pipelines))).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(
      names(sortRetention([...rows].reverse(), "funnel", pipelines)),
    ).toEqual(["A", "B", "C", "D"]);
  });
  it("funil com vários pipelines: agrupa pelo pipeline do catálogo", () => {
    const mixed = [row(2, "X", 5, 1), row(1, "B", 20, 5), row(1, "A", 10, 9)];
    expect(names(sortRetention(mixed, "funnel", pipelines))).toEqual([
      "A",
      "B",
      "X",
    ]);
  });
  it("empate de tempo segue a ordem do funil e não altera a lista original", () => {
    const tied = [row(1, "B", 20, 4), row(1, "A", 10, 4)];
    const copy = [...tied];
    expect(names(sortRetention(tied, "desc", pipelines))).toEqual(["A", "B"]);
    expect(names(sortRetention(tied, "asc", pipelines))).toEqual(["A", "B"]);
    expect(tied).toEqual(copy);
  });
});

describe("sortRetentionByMaximum", () => {
  const withMaximum = (
    categoryId: number,
    id: string,
    sort: number,
    maximum: number,
    visits = maximum > 0 ? 2 : 0,
  ): Retention => ({ ...row(categoryId, id, sort, 1, visits), maximum });
  const peaks = [
    withMaximum(1, "B", 20, 50),
    withMaximum(1, "A", 10, 90),
    withMaximum(1, "D", 40, 0),
    withMaximum(1, "C", 30, 20),
  ];
  it("decrescente: maior pico primeiro, sem passagem por último", () => {
    expect(names(sortRetentionByMaximum(peaks, "desc", pipelines))).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });
  it("crescente: menor pico primeiro, sem passagem continua por último", () => {
    expect(names(sortRetentionByMaximum(peaks, "asc", pipelines))).toEqual([
      "C",
      "B",
      "A",
      "D",
    ]);
  });
  it("empate segue a ordem do funil e não altera a lista original", () => {
    const tied = [withMaximum(1, "B", 20, 7), withMaximum(1, "A", 10, 7)];
    const copy = [...tied];
    expect(names(sortRetentionByMaximum(tied, "desc", pipelines))).toEqual([
      "A",
      "B",
    ]);
    expect(names(sortRetentionByMaximum(tied, "asc", pipelines))).toEqual([
      "A",
      "B",
    ]);
    expect(tied).toEqual(copy);
  });
});
