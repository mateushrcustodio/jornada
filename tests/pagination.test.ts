import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeBitrix } from "./fake-bitrix";
import { resetRateLimits } from "@/lib/bitrix/client";
import type { Session } from "@/lib/bitrix/session";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { PAGE_SIZE, type Filters, type Settings } from "@/lib/types";

const { current } = vi.hoisted(() => ({
  current: { session: undefined as Session | undefined },
}));
vi.mock("@/lib/bitrix/session", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSession: async () => current.session,
}));
const service = await import("@/lib/bitrix/service");
const { sessions } = await import("@/lib/bitrix/session");

const DOMAIN = "example.bitrix24.com.br";
const NOW = Date.parse("2026-11-11T15:00:00Z");
const filters: Filters = {
  from: new Date(NOW - 30 * 86400000).toISOString(),
  to: new Date(NOW).toISOString(),
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("BITRIX_ALLOWED_DOMAINS", DOMAIN);
  vi.stubEnv("BITRIX_CLIENT_ID", "local.test");
  vi.stubEnv("BITRIX_CLIENT_SECRET", "secret");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  // Estes testes percorrem dezenas de páginas; o limitador real é testado em performance.test.ts.
  vi.stubEnv("BITRIX_RATE_BURST", "100000");
  resetRateLimits();
  current.session = {
    id: "pages",
    domain: DOMAIN,
    memberId: "member",
    accessToken: "token",
    refreshToken: "refresh",
    tokenExpiresAt: Date.now() + 3600000,
    expiresAt: Date.now() + 3600000,
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  sessions.clear();
});
// Sem negócios bloqueados: o total de movimentações é exato e comparável.
const open = () =>
  createFakeBitrix({ now: NOW, deals: 400, forbidden: () => false });
const ids = (rows: { entry: { ID: number } }[]) => rows.map((r) => r.entry.ID);
const withoutClock = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value, (k, v) => (k === "queriedAt" ? undefined : v)),
  );

describe("Movimentações sob demanda", () => {
  it("a primeira página traz o total e só lê os negócios dessa página", async () => {
    const fake = open();
    vi.stubGlobal("fetch", fake.fetch);
    const full = await service.getDashboard(filters, DEFAULT_SETTINGS);
    const fullHits = fake.stats.hits;
    fake.stats.hits = 0;
    const page = await service.getMovementsPage(filters, DEFAULT_SETTINGS, 1);
    expect(page.total).toBe(full.movements.length);
    expect(page.rows).toHaveLength(PAGE_SIZE);
    expect(ids(page.rows)).toEqual(ids(full.movements.slice(0, PAGE_SIZE)));
    expect(withoutClock(page.rows)).toEqual(
      withoutClock(full.movements.slice(0, PAGE_SIZE)),
    );
    expect(fake.stats.limitErrors).toBe(0);
    // Menos chamadas que o painel completo e uma única leitura de negócios.
    expect(fake.stats.hits).toBeLessThan(fullHits);
    // Catálogo, um bloco do histórico (traz o total), um lote com os negócios
    // da página e um lote de nomes.
    expect(fake.stats.hits).toBeLessThanOrEqual(5);
  });
  it("trocar de página só lê os negócios da nova página", async () => {
    const fake = open();
    vi.stubGlobal("fetch", fake.fetch);
    const full = await service.getDashboard(filters, DEFAULT_SETTINGS);
    await service.getMovementsPage(filters, DEFAULT_SETTINGS, 1);
    fake.stats.hits = 0;
    const second = await service.getMovementsPage(filters, DEFAULT_SETTINGS, 2);
    // Catálogo e nomes já estão na sessão: um bloco do histórico e o lote
    // com os negócios da nova página.
    expect(fake.stats.hits).toBeLessThanOrEqual(3);
    expect(ids(second.rows)).toEqual(
      ids(full.movements.slice(PAGE_SIZE, PAGE_SIZE * 2)),
    );
    expect(second.page).toBe(2);
  });
  it("percorrendo todas as páginas, a lista é igual à do painel completo", async () => {
    const fake = open();
    vi.stubGlobal("fetch", fake.fetch);
    const full = await service.getDashboard(filters, DEFAULT_SETTINGS);
    const first = await service.getMovementsPage(filters, DEFAULT_SETTINGS, 1);
    const pages = Math.ceil(first.total / PAGE_SIZE);
    const collected = [...first.rows];
    for (let page = 2; page <= pages; page += 1)
      collected.push(
        ...(await service.getMovementsPage(filters, DEFAULT_SETTINGS, page))
          .rows,
      );
    expect(ids(collected)).toEqual(ids(full.movements));
  });
  it("aplica pipeline, etapa e etapas ignoradas como o painel completo", async () => {
    const fake = open();
    vi.stubGlobal("fetch", fake.fetch);
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      ignoredStages: ["3:C3:WORK"],
    };
    const scoped = { ...filters, pipeline: 3 };
    const full = await service.getDashboard(scoped, settings);
    const page = await service.getMovementsPage(scoped, settings, 1);
    expect(page.total).toBe(full.movements.length);
    expect(ids(page.rows)).toEqual(ids(full.movements.slice(0, PAGE_SIZE)));
    expect(page.rows.every((r) => r.entry.STAGE_ID !== "C3:WORK")).toBe(true);
  });
  it("página além do fim volta para a última", async () => {
    const fake = open();
    vi.stubGlobal("fetch", fake.fetch);
    const first = await service.getMovementsPage(filters, DEFAULT_SETTINGS, 1);
    const last = Math.ceil(first.total / PAGE_SIZE);
    const beyond = await service.getMovementsPage(
      filters,
      DEFAULT_SETTINGS,
      last + 40,
    );
    expect(beyond.page).toBe(last);
    expect(beyond.rows.length).toBeGreaterThan(0);
  });
  it("não mostra movimentações de negócios sem acesso", async () => {
    const fake = createFakeBitrix({ now: NOW, deals: 400 });
    vi.stubGlobal("fetch", fake.fetch);
    const blocked = new Set(
      fake.deals
        .filter((d) => Number(d.id) % 37 === 0)
        .map((d) => Number(d.id)),
    );
    const pages = Math.ceil(
      (await service.getMovementsPage(filters, DEFAULT_SETTINGS, 1)).total /
        PAGE_SIZE,
    );
    for (let page = 1; page <= pages; page += 1) {
      const result = await service.getMovementsPage(
        filters,
        DEFAULT_SETTINGS,
        page,
      );
      expect(result.rows.some((r) => blocked.has(r.deal.id))).toBe(false);
    }
  });
  it("com filtro, a lista do período fica na sessão até Atualizar (novo asOf)", async () => {
    const fake = open();
    vi.stubGlobal("fetch", fake.fetch);
    const scoped = { ...filters, pipeline: 3 };
    await service.getMovementsPage(scoped, DEFAULT_SETTINGS, 1, 1);
    fake.stats.hits = 0;
    await service.getMovementsPage(scoped, DEFAULT_SETTINGS, 2, 1);
    // Só o lote dos negócios da página (mais um de nomes, se ainda faltar).
    expect(fake.stats.hits).toBeLessThanOrEqual(2);
    fake.stats.hits = 0;
    await service.getMovementsPage(scoped, DEFAULT_SETTINGS, 2, 2);
    expect(fake.stats.hits).toBeGreaterThan(2);
  });
  it("sem filtro, o total vem do Bitrix24 e o período não é varrido", async () => {
    const fake = createFakeBitrix({
      now: NOW,
      deals: 3000,
      forbidden: () => false,
    });
    vi.stubGlobal("fetch", fake.fetch);
    const page = await service.getMovementsPage(filters, DEFAULT_SETTINGS, 1);
    const inPeriod = fake.history.filter(
      (h) =>
        Date.parse(String(h.CREATED_TIME)) >= Date.parse(filters.from) &&
        Date.parse(String(h.CREATED_TIME)) <= Date.parse(filters.to),
    );
    expect(inPeriod.length).toBeGreaterThan(5000);
    expect(page.total).toBe(inPeriod.length);
    expect(fake.stats.hits).toBeLessThanOrEqual(5);
  });
  it("se o portal não aceitar a leitura por blocos, usa a lista completa", async () => {
    const fake = open();
    const rejecting = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.start > 0 || body.order?.CREATED_TIME === "DESC")
        return new Response(
          JSON.stringify({ error: "BAD_ORDER", error_description: "" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      return fake.fetch(input, init);
    };
    vi.stubGlobal("fetch", rejecting);
    const full = await service.getDashboard(filters, DEFAULT_SETTINGS);
    const page = await service.getMovementsPage(filters, DEFAULT_SETTINGS, 1);
    expect(page.total).toBe(full.movements.length);
    expect(ids(page.rows)).toEqual(ids(full.movements.slice(0, PAGE_SIZE)));
  });
});

describe("Parados sob demanda", () => {
  it("uma chamada traz o total e a página, igual ao painel completo", async () => {
    const fake = open();
    vi.stubGlobal("fetch", fake.fetch);
    const full = await service.getDashboard(filters, DEFAULT_SETTINGS);
    await service.getCatalog(current.session!);
    fake.stats.hits = 0;
    fake.stats.byMethod = {};
    const page = await service.getStalledPage(filters, DEFAULT_SETTINGS, 1);
    expect(page.total).toBe(full.stalled.length);
    expect(page.rows.map((r) => r.deal.id)).toEqual(
      full.stalled.slice(0, PAGE_SIZE).map((r) => r.deal.id),
    );
    expect(withoutClock(page.rows)).toEqual(
      withoutClock(full.stalled.slice(0, PAGE_SIZE)),
    );
    // Nenhuma leitura de histórico: só uma lista de negócios.
    expect(fake.stats.hits).toBe(1);
    expect(fake.stats.byMethod["crm.stagehistory.list"]).toBeUndefined();
  });
  it("lê blocos de 50 do Bitrix24 e entrega páginas de 10 em sequência", async () => {
    const fake = open();
    vi.stubGlobal("fetch", fake.fetch);
    const settings = { ...DEFAULT_SETTINGS, stalledHours: 1 };
    const full = await service.getDashboard(filters, settings);
    expect(full.stalled.length).toBeGreaterThan(60);
    await service.getCatalog(current.session!);
    const collected: { id: number; duration: number }[] = [];
    fake.stats.hits = 0;
    for (
      let page = 1;
      page <= Math.ceil(full.stalled.length / PAGE_SIZE);
      page += 1
    )
      collected.push(
        ...(await service.getStalledPage(filters, settings, page)).rows.map(
          (r) => ({ id: r.deal.id, duration: r.duration }),
        ),
      );
    // Negócios com o mesmo tempo parado podem trocar de lugar entre si; a
    // sequência de tempos e o conjunto de negócios são idênticos.
    expect(collected.map((r) => r.duration)).toEqual(
      full.stalled.map((r) => r.duration),
    );
    expect(collected.map((r) => r.id).sort((a, b) => a - b)).toEqual(
      full.stalled.map((r) => r.deal.id).sort((a, b) => a - b),
    );
    // Uma chamada por página (50 por bloco), sem nenhuma leitura extra.
    expect(fake.stats.hits).toBe(Math.ceil(full.stalled.length / PAGE_SIZE));
  });
  it("aplica pipeline e etapas ignoradas como o painel completo", async () => {
    const fake = open();
    vi.stubGlobal("fetch", fake.fetch);
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      stalledHours: 24,
      ignoredStages: ["0:NEW"],
    };
    const full = await service.getDashboard(filters, settings);
    const page = await service.getStalledPage(filters, settings, 1);
    expect(page.total).toBe(full.stalled.length);
    expect(page.rows.map((r) => r.deal.id)).toEqual(
      full.stalled.slice(0, PAGE_SIZE).map((r) => r.deal.id),
    );
    expect(page.rows.every((r) => r.deal.stageId !== "NEW")).toBe(true);
    const scoped = await service.getStalledPage(
      { ...filters, pipeline: 3 },
      settings,
      1,
    );
    expect(scoped.rows.every((r) => r.deal.categoryId === 3)).toBe(true);
    const none = await service.getStalledPage(
      { ...filters, pipeline: 3 },
      { ...settings, monitoredPipelines: [0] },
      1,
    );
    expect(none.total).toBe(0);
  });
  it("se o portal não aceitar o filtro por movedTime, usa o caminho completo", async () => {
    const fake = open();
    const rejecting = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.filter && "<=movedTime" in body.filter)
        return new Response(
          JSON.stringify({ error: "BAD_FILTER", error_description: "" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      return fake.fetch(input, init);
    };
    vi.stubGlobal("fetch", rejecting);
    const full = await service.getDashboard(filters, DEFAULT_SETTINGS);
    const page = await service.getStalledPage(filters, DEFAULT_SETTINGS, 1);
    expect(page.total).toBe(full.stalled.length);
    expect(page.rows.map((r) => r.deal.id)).toEqual(
      full.stalled.slice(0, PAGE_SIZE).map((r) => r.deal.id),
    );
  });
});

describe("modo demonstração", () => {
  it("pagina os dados sintéticos igual ao painel", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const full = await service.getDashboard(filters, DEFAULT_SETTINGS);
    const movements = await service.getMovementsPage(
      filters,
      DEFAULT_SETTINGS,
      1,
    );
    expect(movements.demo).toBe(true);
    expect(movements.total).toBe(full.movements.length);
    expect(ids(movements.rows)).toEqual(
      ids(full.movements.slice(0, PAGE_SIZE)),
    );
    const stalled = await service.getStalledPage(filters, DEFAULT_SETTINGS, 1);
    expect(stalled.total).toBe(full.stalled.length);
  });
});
