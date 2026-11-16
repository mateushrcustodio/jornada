import { describe, expect, it } from "vitest";
import {
  hasDealFilters,
  matchesDealFilters,
  sortByOpportunity,
  sortByWhen,
} from "@/lib/calculations";
import { money, parseMoney } from "@/lib/format";
import { filtersSchema, sortSchema } from "@/lib/settings";
import type { Deal } from "@/lib/types";

const deal = (extra: Partial<Deal> = {}): Deal => ({
  id: 1,
  title: "Negócio",
  categoryId: 0,
  stageId: "NEW",
  ...extra,
});
const period = {
  from: "2026-11-01T00:00:00.000Z",
  to: "2026-11-10T00:00:00.000Z",
};

describe("filtros por negócio", () => {
  it("sem responsável nem faixa, todo negócio passa", () => {
    expect(hasDealFilters(period)).toBe(false);
    expect(matchesDealFilters(deal(), period)).toBe(true);
  });
  it("filtra pelo responsável", () => {
    const filters = { ...period, assignedById: 7 };
    expect(hasDealFilters(filters)).toBe(true);
    expect(matchesDealFilters(deal({ assignedById: 7 }), filters)).toBe(true);
    expect(matchesDealFilters(deal({ assignedById: 8 }), filters)).toBe(false);
    expect(matchesDealFilters(deal(), filters)).toBe(false);
  });
  it("faixa de faturamento é inclusiva e valor ausente conta como zero", () => {
    const filters = { ...period, opportunityMin: 100, opportunityMax: 500 };
    expect(matchesDealFilters(deal({ opportunity: 100 }), filters)).toBe(true);
    expect(matchesDealFilters(deal({ opportunity: 500 }), filters)).toBe(true);
    expect(matchesDealFilters(deal({ opportunity: 99.99 }), filters)).toBe(
      false,
    );
    expect(matchesDealFilters(deal({ opportunity: 500.01 }), filters)).toBe(
      false,
    );
    expect(matchesDealFilters(deal(), filters)).toBe(false);
    expect(matchesDealFilters(deal(), { ...period, opportunityMax: 10 })).toBe(
      true,
    );
    expect(matchesDealFilters(deal(), { ...period, opportunityMin: 0 })).toBe(
      true,
    );
  });
  it("o esquema aceita os campos novos e recusa faixa invertida", () => {
    expect(
      filtersSchema.safeParse({
        ...period,
        assignedById: 3,
        opportunityMin: 0,
        opportunityMax: 1000.5,
      }).success,
    ).toBe(true);
    expect(
      filtersSchema.safeParse({
        ...period,
        opportunityMin: 10,
        opportunityMax: 5,
      }).success,
    ).toBe(false);
    expect(
      filtersSchema.safeParse({ ...period, opportunityMin: -1 }).success,
    ).toBe(false);
    expect(
      filtersSchema.safeParse({ ...period, assignedById: 0 }).success,
    ).toBe(false);
    expect(
      sortSchema.safeParse({ by: "opportunity", dir: "desc" }).success,
    ).toBe(true);
    expect(sortSchema.safeParse({ by: "when", dir: "asc" }).success).toBe(true);
    expect(sortSchema.safeParse({ by: "title", dir: "desc" }).success).toBe(
      false,
    );
  });
});

describe("ordenação por faturamento", () => {
  const rows = [
    { id: "a", value: 10 },
    { id: "b", value: undefined },
    { id: "c", value: 30 },
    { id: "d", value: 10 },
  ];
  const value = (row: (typeof rows)[number]) => row.value;
  it("sem ordenação mantém a ordem original", () => {
    expect(sortByOpportunity(rows, undefined, value)).toBe(rows);
  });
  it("decrescente e crescente, estável nos empates, valor ausente como zero", () => {
    const sort = (dir: "asc" | "desc") =>
      sortByOpportunity(rows, { by: "opportunity", dir }, value).map(
        (r) => r.id,
      );
    expect(sort("desc")).toEqual(["c", "a", "d", "b"]);
    expect(sort("asc")).toEqual(["b", "a", "d", "c"]);
  });
});

describe("ordenação por data (Quando)", () => {
  // Lista já da mais recente para a mais antiga, como as Movimentações chegam.
  const rows = ["novo", "meio", "antigo"];
  it("sem ordenação e decrescente mantêm a ordem (mais recentes primeiro)", () => {
    expect(sortByWhen(rows, undefined)).toBe(rows);
    expect(sortByWhen(rows, { by: "when", dir: "desc" })).toBe(rows);
  });
  it("crescente inverte a lista sem alterar a original", () => {
    expect(sortByWhen(rows, { by: "when", dir: "asc" })).toEqual([
      "antigo",
      "meio",
      "novo",
    ]);
    expect(rows).toEqual(["novo", "meio", "antigo"]);
  });
  it("a ordenação por faturamento não mexe na por data, e vice-versa", () => {
    expect(sortByWhen(rows, { by: "opportunity", dir: "asc" })).toBe(rows);
    expect(
      sortByOpportunity(rows, { by: "when", dir: "asc" }, () => 1),
    ).toBe(rows);
  });
});

describe("valor digitado e exibido", () => {
  it("lê os formatos usados no Brasil", () => {
    expect(parseMoney("")).toBeUndefined();
    expect(parseMoney("   ")).toBeUndefined();
    expect(parseMoney("10000")).toBe(10000);
    expect(parseMoney("10.000")).toBe(10000);
    expect(parseMoney("1.234.567")).toBe(1234567);
    expect(parseMoney("10.000,50")).toBe(10000.5);
    expect(parseMoney("1500,5")).toBe(1500.5);
    expect(parseMoney("1500.5")).toBe(1500.5);
    expect(parseMoney("R$ 2.500")).toBe(2500);
    expect(parseMoney("0")).toBe(0);
  });
  it("texto que não é número vale inválido", () => {
    for (const text of ["abc", "-5", "1,2,3", "10k", "1e5", "--"])
      expect(parseMoney(text)).toBeNull();
  });
  it("mostra o valor na moeda do negócio", () => {
    expect(money(12500, "BRL").replace(/\s/g, " ")).toBe("R$ 12.500,00");
    expect(money(0, "BRL").replace(/\s/g, " ")).toBe("R$ 0,00");
    expect(money(undefined, "BRL")).toBe("—");
    expect(money(10, "USD")).toContain("US$");
    // Moeda desconhecida cai no real em vez de quebrar a tela.
    expect(money(10, "???").replace(/\s/g, " ")).toBe("R$ 10,00");
  });
});
