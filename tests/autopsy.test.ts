import { describe, expect, it } from "vitest";
import { demoDataset } from "@/lib/demo";
import { buildJourney } from "@/lib/calculations";
import {
  MIN_SAMPLE,
  autopsyText,
  buildAutopsy,
  buildBenchmark,
  median,
  paceSentence,
} from "@/lib/autopsy";

const now = Date.now();
const { catalog, deals, history } = demoDataset(now);
const journeyOf = (id: number) =>
  buildJourney(
    deals.find((d) => d.id === id)!,
    history,
    catalog,
    now,
    true,
  );
const benchmarkOf = (id: number) =>
  buildBenchmark(
    deals.find((d) => d.id === id)!,
    deals,
    history,
    catalog,
    now,
  );

describe("autópsia do negócio", () => {
  it("não existe para negócio em andamento", () => {
    expect(buildAutopsy(journeyOf(8061))).toBeNull();
    expect(benchmarkOf(8061)).toBeNull();
  });
  it("detecta etapa pulada e volta de etapa em negócio ganho", () => {
    const autopsy = buildAutopsy(journeyOf(9001), benchmarkOf(9001))!;
    expect(autopsy.outcome).toBe("won");
    expect(autopsy.finalStage.id).toBe("WON");
    expect(autopsy.skipped.map((s) => s.name)).toEqual(["Negociação"]);
    expect(autopsy.returns).toHaveLength(1);
    expect(autopsy.returns[0].from.name).toBe("Proposta enviada");
    expect(autopsy.returns[0].to.name).toBe("Qualificação");
    expect(autopsy.stepsBefore).toBe(3);
  });
  it("trata caminho linear sem desvios", () => {
    const autopsy = buildAutopsy(journeyOf(9003), benchmarkOf(9003))!;
    expect(autopsy.skipped).toEqual([]);
    expect(autopsy.returns).toEqual([]);
  });
  it("não lista etapa final como pulada em negócio perdido", () => {
    const autopsy = buildAutopsy(journeyOf(9006), benchmarkOf(9006))!;
    expect(autopsy.outcome).toBe("lost");
    expect(autopsy.skipped.map((s) => s.id)).toEqual([]);
    const direct = buildAutopsy(journeyOf(9005), benchmarkOf(9005))!;
    expect(direct.skipped).toEqual([]);
    expect(direct.stepsBefore).toBe(1);
  });
  it("etapa mais demorada soma as duas passagens pela mesma etapa", () => {
    const autopsy = buildAutopsy(journeyOf(9001))!;
    // Qualificação: 6d + 3,5d (depois da volta) = 9,5d; Proposta: 4d + 2d = 6d
    expect(autopsy.longest?.stage.name).toBe("Qualificação");
    expect(autopsy.longest?.duration).toBe(9.5 * 86400000);
    expect(autopsy.total).toBe(18 * 86400000);
  });
  it("compara com a mediana apenas de negócios do mesmo resultado e pipeline", () => {
    const benchmark = benchmarkOf(9001)!;
    expect(benchmark.outcome).toBe("S");
    // ganhos do pipeline 0, exceto o próprio: 8065, 8071, 8077, 9002, 9003
    expect(benchmark.sample).toBe(5);
    const autopsy = buildAutopsy(journeyOf(9001), benchmark)!;
    expect(autopsy.pace?.sample).toBe(5);
    expect(paceSentence(autopsy)).toContain("negócios ganhos deste funil");
  });
  it("usa múltiplo quando o ciclo é pelo menos o dobro do típico", () => {
    const base = benchmarkOf(9001)!;
    const slow = buildAutopsy(journeyOf(9001), {
      ...base,
      medianTotal: 6 * 86400000,
    })!;
    expect(paceSentence(slow)).toMatch(/^Ciclo 3,0× o típico/);
    const mild = buildAutopsy(journeyOf(9001), {
      ...base,
      medianTotal: 14 * 86400000,
    })!;
    expect(paceSentence(mild)).toMatch(/^Ciclo 29% mais longo/);
  });
  it("omite a comparação quando a amostra é pequena", () => {
    const base = benchmarkOf(9001)!;
    const autopsy = buildAutopsy(journeyOf(9001), {
      ...base,
      sample: MIN_SAMPLE - 1,
    })!;
    expect(autopsy.pace).toBeUndefined();
    expect(autopsy.longest?.typical).toBeUndefined();
    expect(paceSentence(autopsy)).toBeUndefined();
  });
  it("gera texto no formato do Bitrix24 sem markdown", () => {
    const data = journeyOf(9001);
    const text = autopsyText(data, buildAutopsy(data, benchmarkOf(9001))!);
    expect(text).toMatch(/^\[b\]Autópsia do negócio · Ganho\[\/b\]/);
    expect(text).toContain("Etapas puladas: Negociação.");
    expect(text).toContain("Proposta enviada → Qualificação");
    expect(text).not.toMatch(/\*\*|^#|\|/m);
  });
  it("mediana de lista par, ímpar e vazia", () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});
