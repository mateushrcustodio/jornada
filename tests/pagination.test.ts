import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeBitrix } from "./fake-bitrix";
import { resetRateLimits } from "@/lib/bitrix/client";
import type { Session } from "@/lib/bitrix/session";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import {
  PAGE_SIZE,
  type Filters,
  type MovementSort,
  type Settings,
} from "@/lib/types";

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
// O nome do responsável só é resolvido onde a tela o mostra (Movimentações e
// Parados); "actor" de Parados vem de fontes diferentes no painel completo.
const withoutClock = (value: unknown, ignore: string[] = []) =>
  JSON.parse(
    JSON.stringify(value, (k, v) =>
      k === "queriedAt" || k === "assignedByName" || ignore.includes(k)
        ? undefined
        : v,
    ),
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

async function allMovements(
  scoped: Filters,
  sort?: MovementSort,
  settings: Settings = DEFAULT_SETTINGS,
) {
  const first = await service.getMovementsPage(
    scoped,
    settings,
    1,
    undefined,
    sort,
  );
  const collected = [...first.rows];
  for (let page = 2; page <= Math.ceil(first.total / PAGE_SIZE); page += 1)
    collected.push(
      ...(
        await service.getMovementsPage(scoped, settings, page, undefined, sort)
      ).rows,
    );
  return { first, rows: collected };
}

describe("Movimentações por responsável, faturamento e ordenação", () => {
  it("filtra por responsável como o painel completo", async () => {
    const fake = open();
    vi.stubGlobal("fetch", fake.fetch);
    const scoped = { ...filters, assignedById: 3 };
    const full = await service.getDashboard(scoped, DEFAULT_SETTINGS);
    const { first, rows } = await allMovements(scoped);
    expect(full.movements.length).toBeGreaterThan(0);
    expect(first.total).toBe(full.movements.length);
    expect(ids(rows)).toEqual(ids(full.movements));
    expect(rows.every((r) => r.deal.assignedById === 3)).toBe(true);
    // Menos movimentações do que sem o filtro.
    const everyone = await service.getMovementsPage(
      filters,
      DEFAULT_SETTINGS,
      1,
    );
    expect(first.total).toBeLessThan(everyone.total);
  });
  it("filtra pela faixa de faturamento (mínimo, máximo ou os dois)", async () => {
    const fake = open();
    vi.stubGlobal("fetch", fake.fetch);
    for (const range of [
      { opportunityMin: 20000 },
      { opportunityMax: 10000 },
      { opportunityMin: 10000, opportunityMax: 30000 },
    ]) {
      const scoped = { ...filters, ...range };
      const full = await service.getDashboard(scoped, DEFAULT_SETTINGS);
      const { first, rows } = await allMovements(scoped);
      expect(first.total).toBe(full.movements.length);
      expect(ids(rows)).toEqual(ids(full.movements));
      for (const row of rows) {
        const value = row.deal.opportunity ?? 0;
        expect(value).toBeGreaterThanOrEqual(range.opportunityMin ?? 0);
        expect(value).toBeLessThanOrEqual(range.opportunityMax ?? Infinity);
      }
    }
  });
  it("combina responsável, faturamento, pipeline e etapas ignoradas", async () => {
    const fake = open();
    vi.stubGlobal("fetch", fake.fetch);
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      ignoredStages: ["0:NEW"],
    };
    const scoped = {
      ...filters,
      pipeline: 0,
      assignedById: 2,
      opportunityMin: 5000,
    };
    const full = await service.getDashboard(scoped, settings);
    const { rows } = await allMovements(scoped, undefined, settings);
    expect(rows.length).toBeGreaterThan(0);
    expect(ids(rows)).toEqual(ids(full.movements));
  });
  it("ordena todas as páginas pelo faturamento, do maior para o menor e o contrário", async () => {
    const fake = open();
    vi.stubGlobal("fetch", fake.fetch);
    const full = await service.getDashboard(filters, DEFAULT_SETTINGS);
    const desc = await allMovements(filters, {
      by: "opportunity",
      dir: "desc",
    });
    const values = desc.rows.map((r) => r.deal.opportunity ?? 0);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(desc.first.total).toBe(full.movements.length);
    // Mesmo conjunto de movimentações, só em outra ordem.
    expect(ids(desc.rows).sort((a, b) => a - b)).toEqual(
      ids(full.movements).sort((a, b) => a - b),
    );
    const asc = await allMovements(filters, { by: "opportunity", dir: "asc" });
    const ascValues = asc.rows.map((r) => r.deal.opportunity ?? 0);
    expect(ascValues).toEqual([...ascValues].sort((a, b) => a - b));
    expect(ascValues[0]).toBeLessThan(ascValues.at(-1)!);
    // Valores iguais continuam da movimentação mais recente para a mais antiga.
    for (let i = 1; i < desc.rows.length; i += 1)
      if (values[i] === values[i - 1])
        expect(
          Date.parse(desc.rows[i - 1].entry.CREATED_TIME),
        ).toBeGreaterThanOrEqual(Date.parse(desc.rows[i].entry.CREATED_TIME));
  });
  it("ordena todas as páginas pela data: crescente é o inverso exato da padrão", async () => {
    const fake = open();
    vi.stubGlobal("fetch", fake.fetch);
    // Sem filtros: o Bitrix24 devolve cada bloco já na ordem pedida.
    const full = await service.getDashboard(filters, DEFAULT_SETTINGS);
    const asc = await allMovements(filters, { by: "when", dir: "asc" });
    expect(asc.first.total).toBe(full.movements.length);
    expect(ids(asc.rows)).toEqual(ids(full.movements).reverse());
    const desc = await allMovements(filters, { by: "when", dir: "desc" });
    expect(ids(desc.rows)).toEqual(ids(full.movements));
    const times = asc.rows.map((r) => Date.parse(r.entry.CREATED_TIME));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // Com filtro: a lista do período é lida de uma vez e invertida na sessão.
    const scoped = { ...filters, pipeline: 3 };
    const fullScoped = await service.getDashboard(scoped, DEFAULT_SETTINGS);
    const ascScoped = await allMovements(scoped, { by: "when", dir: "asc" });
    expect(ascScoped.first.total).toBe(fullScoped.movements.length);
    expect(ids(ascScoped.rows)).toEqual(ids(fullScoped.movements).reverse());
    // Responsável e faturamento também combinam com a ordenação por data.
    const people = { ...filters, assignedById: 3, opportunityMin: 10000 };
    const fullPeople = await service.getDashboard(people, DEFAULT_SETTINGS);
    const ascPeople = await allMovements(people, { by: "when", dir: "asc" });
    expect(ids(ascPeople.rows)).toEqual(ids(fullPeople.movements).reverse());
  });
  it("ordenar por data sem filtro não varre o período (só o bloco da página)", async () => {
    const fake = createFakeBitrix({
      now: NOW,
      deals: 3000,
      forbidden: () => false,
    });
    vi.stubGlobal("fetch", fake.fetch);
    const page = await service.getMovementsPage(
      filters,
      DEFAULT_SETTINGS,
      1,
      undefined,
      { by: "when", dir: "asc" },
    );
    expect(page.rows.length).toBe(PAGE_SIZE);
    expect(fake.stats.hits).toBeLessThanOrEqual(5);
    const times = page.rows.map((r) => Date.parse(r.entry.CREATED_TIME));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
  it("mostra o nome do responsável e o valor de cada linha", async () => {
    const fake = open();
    vi.stubGlobal("fetch", fake.fetch);
    const page = await service.getMovementsPage(filters, DEFAULT_SETTINGS, 1);
    for (const row of page.rows) {
      expect(row.deal.assignedByName).toBe(`Pessoa ${row.deal.assignedById}`);
      expect(row.deal.opportunity).toBe(((row.deal.id * 7919) % 50) * 1000);
      expect(row.deal.currencyId).toBe("BRL");
    }
    // Sem filtro de negócio, o caminho rápido continua com poucas chamadas.
    expect(fake.stats.hits).toBeLessThanOrEqual(5);
  });
  it("com filtro de negócio lê os negócios do período em lote, uma vez só", async () => {
    const fake = open();
    vi.stubGlobal("fetch", fake.fetch);
    const scoped = { ...filters, assignedById: 1 };
    await service.getMovementsPage(scoped, DEFAULT_SETTINGS, 1, 7);
    fake.stats.hits = 0;
    fake.stats.byMethod = {};
    const second = await service.getMovementsPage(
      scoped,
      DEFAULT_SETTINGS,
      2,
      7,
    );
    expect(second.rows.length).toBeGreaterThan(0);
    // Segunda página: só o lote dos negócios da página (e nomes, se faltarem).
    expect(fake.stats.hits).toBeLessThanOrEqual(2);
    // Trocar a ordenação reaproveita a lista e os negócios do período.
    fake.stats.hits = 0;
    await service.getMovementsPage(scoped, DEFAULT_SETTINGS, 1, 7, {
      by: "opportunity",
      dir: "desc",
    });
    expect(fake.stats.hits).toBeLessThanOrEqual(2);
  });
  it("não conta nem ordena movimentações de negócios sem acesso", async () => {
    const fake = createFakeBitrix({ now: NOW, deals: 400 });
    vi.stubGlobal("fetch", fake.fetch);
    const blocked = new Set(
      fake.deals
        .filter((d) => Number(d.id) % 37 === 0)
        .map((d) => Number(d.id)),
    );
    const { first, rows } = await allMovements(
      { ...filters, opportunityMin: 0 },
      { by: "opportunity", dir: "desc" },
    );
    expect(rows.length).toBe(first.total);
    expect(rows.some((r) => blocked.has(r.deal.id))).toBe(false);
  });
  it("se o portal não aceitar batch, lê os negócios por consultas simples", async () => {
    const fake = open();
    const noBatch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      if (String(input).endsWith("/batch.json"))
        return new Response(
          JSON.stringify({ error: "BATCH_OFF", error_description: "" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      return fake.fetch(input, init);
    };
    vi.stubGlobal("fetch", noBatch);
    const scoped = { ...filters, assignedById: 4 };
    const full = await service.getDashboard(scoped, DEFAULT_SETTINGS);
    const { rows } = await allMovements(scoped);
    expect(ids(rows)).toEqual(ids(full.movements));
  });
  it("lista as pessoas ativas em ordem alfabética e guarda na sessão", async () => {
    const fake = open();
    vi.stubGlobal("fetch", fake.fetch);
    const users = await service.getUsers();
    expect(users.map((u) => u.name)).toEqual([
      "Pessoa 1",
      "Pessoa 2",
      "Pessoa 3",
      "Pessoa 4",
      "Pessoa 5",
    ]);
    fake.stats.hits = 0;
    await service.getUsers();
    expect(fake.stats.hits).toBe(0);
  });
  it("sem permissão em user.get, a lista de pessoas vem vazia", async () => {
    const fake = open();
    const denied = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      if (String(input).endsWith("/user.get.json"))
        return new Response(
          JSON.stringify({
            error: "insufficient_scope",
            error_description: "",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      return fake.fetch(input, init);
    };
    vi.stubGlobal("fetch", denied);
    expect(await service.getUsers()).toEqual([]);
  });
});

describe("Parados e visão geral com responsável e faturamento", () => {
  it("Parados aplica os mesmos filtros do painel completo", async () => {
    const fake = open();
    vi.stubGlobal("fetch", fake.fetch);
    const settings = { ...DEFAULT_SETTINGS, stalledHours: 1 };
    const scoped = { ...filters, assignedById: 2, opportunityMin: 10000 };
    const full = await service.getDashboard(scoped, settings);
    expect(full.stalled.length).toBeGreaterThan(0);
    const page = await service.getStalledPage(scoped, settings, 1);
    expect(page.total).toBe(full.stalled.length);
    expect(page.rows.every((r) => r.deal.assignedById === 2)).toBe(true);
    expect(page.rows.every((r) => (r.deal.opportunity ?? 0) >= 10000)).toBe(
      true,
    );
  });
  it("visão geral considera só os negócios do responsável", async () => {
    const fake = open();
    vi.stubGlobal("fetch", fake.fetch);
    const everyone = await service.getDashboard(filters, DEFAULT_SETTINGS);
    const mine = await service.getDashboard(
      { ...filters, assignedById: 1 },
      DEFAULT_SETTINGS,
    );
    expect(mine.movements.length).toBeGreaterThan(0);
    expect(mine.movements.length).toBeLessThan(everyone.movements.length);
    expect(mine.movements.every((m) => m.deal.assignedById === 1)).toBe(true);
    expect(mine.activeCount).toBeLessThan(everyone.activeCount);
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
    expect(withoutClock(page.rows, ["actor"])).toEqual(
      withoutClock(full.stalled.slice(0, PAGE_SIZE), ["actor"]),
    );
    // Nenhuma leitura de histórico: uma lista de negócios e, no máximo, um lote
    // com os nomes de "Movido por" e "Pessoa responsável".
    expect(fake.stats.hits).toBeLessThanOrEqual(2);
    expect(fake.stats.byMethod["crm.item.list"]).toBe(1);
    expect(fake.stats.byMethod["crm.stagehistory.list"]).toBeUndefined();
  });
  it("mostra quem fez a última movimentação e a pessoa responsável", async () => {
    const fake = open();
    vi.stubGlobal("fetch", fake.fetch);
    const settings = { ...DEFAULT_SETTINGS, stalledHours: 1 };
    const page = await service.getStalledPage(filters, settings, 1);
    expect(page.rows.length).toBeGreaterThan(0);
    for (const row of page.rows) {
      expect(row.deal.assignedByName).toBe(`Pessoa ${row.deal.assignedById}`);
      if (row.deal.movedBy) expect(row.actor).toBe(`Pessoa ${row.deal.movedBy}`);
      else expect(row.actor).toBeUndefined();
    }
    expect(page.rows.some((row) => row.actor)).toBe(true);
    // Sem permissão em user.get a página continua, só sem os nomes.
    const denied = async (input: string | URL | Request, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      if (body.includes("user.get"))
        return new Response(
          JSON.stringify({ error: "ACCESS_DENIED", error_description: "" }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
      return fake.fetch(input, init);
    };
    current.session!.userNames = undefined;
    vi.stubGlobal("fetch", denied);
    const blind = await service.getStalledPage(filters, settings, 1);
    expect(blind.total).toBe(page.total);
    expect(blind.rows.every((row) => !row.actor)).toBe(true);
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
    fake.stats.byMethod = {};
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
    // Uma chamada por página (50 por bloco), sem leitura de histórico. Os nomes
    // ficam na sessão: só pessoas ainda desconhecidas geram um lote a mais.
    const pages = Math.ceil(full.stalled.length / PAGE_SIZE);
    expect(fake.stats.byMethod["crm.item.list"]).toBe(pages);
    expect(fake.stats.byMethod["crm.stagehistory.list"]).toBeUndefined();
    expect(fake.stats.hits).toBeLessThanOrEqual(pages + 5);
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

describe("modo demonstração com responsável, faturamento e ordenação", () => {
  it("filtra e ordena os dados sintéticos igual ao painel", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const users = await service.getUsers();
    expect(users.length).toBeGreaterThan(1);
    const scoped = { ...filters, assignedById: users[0].id };
    const full = await service.getDashboard(scoped, DEFAULT_SETTINGS);
    const page = await service.getMovementsPage(scoped, DEFAULT_SETTINGS, 1);
    expect(page.total).toBe(full.movements.length);
    expect(page.total).toBeGreaterThan(0);
    expect(page.rows.every((r) => r.deal.assignedById === users[0].id)).toBe(
      true,
    );
    const sorted = await service.getMovementsPage(
      filters,
      DEFAULT_SETTINGS,
      1,
      undefined,
      { by: "opportunity", dir: "desc" },
    );
    const values = sorted.rows.map((r) => r.deal.opportunity ?? 0);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    const ranged = await service.getMovementsPage(
      { ...filters, opportunityMin: 100000 },
      DEFAULT_SETTINGS,
      1,
    );
    expect(ranged.rows.length).toBeGreaterThan(0);
    expect(ranged.rows.every((r) => (r.deal.opportunity ?? 0) >= 100000)).toBe(
      true,
    );
  });
});
