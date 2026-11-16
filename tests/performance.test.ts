import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeBitrix, parseQuery } from "./fake-bitrix";
import {
  batchWithMeta,
  listAll,
  listAllBatched,
  reserveRateSlot,
  resetRateLimits,
} from "@/lib/bitrix/client";
import type { Session } from "@/lib/bitrix/session";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { buildDashboard, buildJourney, isClosed } from "@/lib/calculations";
import { buildBenchmark } from "@/lib/autopsy";
import type { Deal, HistoryEntry } from "@/lib/types";

const { current } = vi.hoisted(() => ({
  current: { session: undefined as Session | undefined },
}));
vi.mock("@/lib/bitrix/session", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSession: async () => current.session,
}));
const service = await import("@/lib/bitrix/service");
const { POST: placement } = await import("@/app/api/bitrix/placement/route");
const { sessions, sessionIdFromCookieValue } = await import(
  "@/lib/bitrix/session"
);

const DOMAIN = "example.bitrix24.com.br";
const makeSession = (): Session => ({
  id: "perf",
  domain: DOMAIN,
  memberId: "member",
  accessToken: "token",
  refreshToken: "refresh",
  tokenExpiresAt: Date.now() + 3600000,
  expiresAt: Date.now() + 3600000,
});
const NOW = Date.parse("2026-11-11T15:00:00Z");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("BITRIX_ALLOWED_DOMAINS", DOMAIN);
  vi.stubEnv("BITRIX_CLIENT_ID", "local.test");
  vi.stubEnv("BITRIX_CLIENT_SECRET", "secret");
  vi.stubEnv("BITRIX_APP_CODE", "");
  vi.stubEnv("BITRIX_APPLICATION_TOKEN", "");
  vi.stubEnv("BITRIX_MEMBER_ID", "");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  resetRateLimits();
  current.session = makeSession();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  sessions.clear();
});
const asHistory = (rows: Record<string, unknown>[]) =>
  rows.map((r) => ({ ...r })) as unknown as HistoryEntry[];
const asDeals = (rows: Record<string, unknown>[]) =>
  rows.map((r) => ({ ...r })) as unknown as Deal[];
const withoutClock = (value: unknown) =>
  JSON.parse(JSON.stringify(value, (k, v) => (k === "queriedAt" ? undefined : v)));

describe("limitador de requisições", () => {
  it("libera a rajada e depois segura em 2 por segundo, por portal", () => {
    const t = 1_000_000;
    for (let i = 0; i < 40; i += 1) expect(reserveRateSlot("a.bitrix24.com", t)).toBe(0);
    expect(reserveRateSlot("a.bitrix24.com", t)).toBe(500);
    expect(reserveRateSlot("a.bitrix24.com", t)).toBe(1000);
    // Outro portal tem o próprio balde.
    expect(reserveRateSlot("b.bitrix24.com", t)).toBe(0);
    // 10 s depois escoaram 20 vagas.
    expect(reserveRateSlot("a.bitrix24.com", t + 10000)).toBe(0);
  });
});

describe("batch e paginação", () => {
  it("codifica chaves com operadores nos subcomandos (>=, <=, @)", async () => {
    const fake = createFakeBitrix({ now: NOW });
    vi.stubGlobal("fetch", fake.fetch);
    const from = new Date(NOW - 7 * 86400000).toISOString();
    const { results, total } = await batchWithMeta(makeSession(), [
      {
        method: "crm.stagehistory.list",
        query: {
          entityTypeId: 2,
          filter: { ">=CREATED_TIME": from, "@OWNER_ID": [1, 2, 3] },
          order: { ID: "ASC" },
          start: 0,
        },
        as: "h",
      },
    ]);
    const expected = fake.history.filter(
      (h) =>
        Date.parse(String(h.CREATED_TIME)) >= Date.parse(from) &&
        [1, 2, 3].includes(Number(h.OWNER_ID)),
    );
    expect((results[0] as { items: unknown[] }).items).toHaveLength(
      Math.min(expected.length, 50),
    );
    expect(total.h).toBe(expected.length);
    expect(parseQuery("filter%5B%3E%3DX%5D=1")).toEqual({ filter: { ">=X": "1" } });
  });
  it("lista milhares de registros em 3 idas ao Bitrix24, igual à leitura página a página", async () => {
    // O relógio do teste está parado; a leitura lenta de comparação não deve esperar o balde.
    vi.stubEnv("BITRIX_RATE_BURST", "1000");
    const fake = createFakeBitrix({ now: NOW, deals: 600, moves: () => 5 });
    vi.stubGlobal("fetch", fake.fetch);
    const params = { entityTypeId: 2, filter: {}, order: { ID: "DESC" } };
    const fast = await listAllBatched<HistoryEntry>(
      makeSession(),
      "crm.stagehistory.list",
      params,
      { idField: "ID" },
    );
    // 1 página + 71 páginas em 2 lotes (50 + 21).
    expect(fake.stats.hits).toBe(3);
    expect(fast.total).toBe(3600);
    const before = fake.stats.hits;
    const slow = await listAll<HistoryEntry>(makeSession(), "crm.stagehistory.list", params);
    expect(fake.stats.hits - before).toBe(72);
    expect(fast.items.map((h) => h.ID)).toEqual(slow.map((h) => h.ID));
  });
  it("não perde registros se uma movimentação nova entra durante a leitura", async () => {
    const fake = createFakeBitrix({ now: NOW, deals: 300, moves: () => 3 });
    let calls = 0;
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const response = await fake.fetch(input, init);
      // Depois da primeira página, entra uma movimentação nova (ID maior).
      if (++calls === 1)
        fake.history.push({ ...fake.history.at(-1)!, ID: 999999, CREATED_TIME: new Date(NOW).toISOString() });
      return response;
    });
    const original = fake.history.map((h) => Number(h.ID));
    const { items } = await listAllBatched<HistoryEntry>(
      makeSession(),
      "crm.stagehistory.list",
      { entityTypeId: 2, order: { ID: "DESC" } },
      { idField: "ID" },
    );
    const read = new Set(items.map((h) => Number(h.ID)));
    expect(original.every((id) => read.has(id))).toBe(true);
    expect(items).toHaveLength(read.size);
  });
  it("respeita o limite: recusa ou devolve parcial com o total real", async () => {
    const fake = createFakeBitrix({ now: NOW, deals: 300, moves: () => 0 });
    vi.stubGlobal("fetch", fake.fetch);
    const truncated = await listAllBatched<Deal>(
      makeSession(),
      "crm.item.list",
      { entityTypeId: 2, order: { id: "ASC" } },
      { limit: 120, overflow: "truncate", idField: "id" },
    );
    expect(truncated.items).toHaveLength(120);
    expect(truncated.total).toBe(fake.readableDeals().length);
    await expect(
      listAllBatched(makeSession(), "crm.item.list", { entityTypeId: 2 }, { limit: 120 }),
    ).rejects.toMatchObject({ code: "QUERY_TOO_LARGE" });
  });
});

describe("jornada dentro do card", () => {
  it("lê negócio e histórico numa única ida e mantém o resultado", async () => {
    const fake = createFakeBitrix({ now: NOW, moves: (id) => (id === 5 ? 70 : id % 6) });
    vi.stubGlobal("fetch", fake.fetch);
    const session = current.session!;
    const catalog = await service.getCatalog(session);
    // Negócio em andamento: a autópsia não entra na conta.
    const deal = asDeals(fake.readableDeals()).find(
      (d) => !isClosed(d) && d.id % 6 >= 2,
    )!;
    const before = fake.stats.hits;
    const journey = await service.getJourney(deal.id);
    // batch (negócio + histórico) e nomes de quem moveu.
    expect(fake.stats.hits - before).toBe(2);
    const history = asHistory(fake.history.filter((h) => h.OWNER_ID === deal.id));
    const expected = buildJourney(deal, history, catalog, NOW, false, DOMAIN);
    expect(withoutClock(journey).visits.map((v: { entry: { ID: number } }) => v.entry.ID)).toEqual(
      withoutClock(expected).visits.map((v: { entry: { ID: number } }) => v.entry.ID),
    );
    expect(journey.visits.map((v) => v.duration)).toEqual(
      expected.visits.map((v) => v.duration),
    );
    // Com nomes resolvidos, a segunda abertura do mesmo card é uma ida só.
    const again = fake.stats.hits;
    await service.getJourney(deal.id);
    expect(fake.stats.hits - again).toBe(1);
    // Mais de 50 movimentações: histórico completo.
    const long = await service.getJourney(5);
    expect(long.visits).toHaveLength(71);
  });
  it("sem acesso ao negócio, o histórico não é consultado e o erro é de permissão", async () => {
    const fake = createFakeBitrix({ now: NOW });
    vi.stubGlobal("fetch", fake.fetch);
    await service.getCatalog(current.session!);
    const historyCalls = fake.stats.byMethod["crm.stagehistory.list"] ?? 0;
    await expect(service.getJourney(37)).rejects.toMatchObject({ status: 403 });
    expect(fake.stats.byMethod["crm.stagehistory.list"] ?? 0).toBe(historyCalls);
  });
  it("compara a autópsia com a mesma amostra de antes, sem páginas sequenciais", async () => {
    const fake = createFakeBitrix({ now: NOW, deals: 200 });
    vi.stubGlobal("fetch", fake.fetch);
    const session = current.session!;
    const catalog = await service.getCatalog(session);
    const closed = asDeals(fake.readableDeals()).find((d) => isClosed(d) && d.categoryId === 0)!;
    const before = fake.stats.hits;
    // A jornada já dispara a amostra; o benchmark só aguarda.
    await service.getJourney(closed.id);
    const benchmark = await service.getBenchmark(closed.id);
    expect(fake.stats.hits - before).toBeLessThanOrEqual(5);
    const sampleDeals = asDeals(
      fake
        .readableDeals()
        .filter(
          (d) =>
            d.categoryId === closed.categoryId &&
            d.stageSemanticId === closed.stageSemanticId,
        )
        .sort((a, b) => Date.parse(String(b.movedTime)) - Date.parse(String(a.movedTime)))
        .slice(0, 50),
    );
    const ids = new Set(sampleDeals.map((d) => d.id));
    const expected = buildBenchmark(
      closed,
      sampleDeals,
      asHistory(fake.history.filter((h) => ids.has(Number(h.OWNER_ID)))),
      catalog,
      NOW,
    );
    expect(benchmark).toEqual(expected);
  });
});

describe("painel", () => {
  it("calcula o mesmo painel que os dados completos, com poucas idas ao Bitrix24", async () => {
    const fake = createFakeBitrix({ now: NOW, deals: 400 });
    vi.stubGlobal("fetch", fake.fetch);
    const filters = {
      from: new Date(NOW - 30 * 86400000).toISOString(),
      to: new Date(NOW).toISOString(),
    };
    const data = await service.getDashboard(filters, DEFAULT_SETTINGS);
    expect(fake.stats.limitErrors).toBe(0);
    expect(fake.stats.hits).toBeLessThanOrEqual(15);

    const readable = asDeals(fake.readableDeals());
    const inPeriod = new Set(
      fake.history
        .filter(
          (h) =>
            Date.parse(String(h.CREATED_TIME)) >= Date.parse(filters.from) &&
            Date.parse(String(h.CREATED_TIME)) <= Date.parse(filters.to),
        )
        .map((h) => Number(h.OWNER_ID)),
    );
    const deals = readable.filter(
      (d) => inPeriod.has(d.id) || d.stageSemanticId === "P",
    );
    const ids = new Set(deals.map((d) => d.id));
    const history = asHistory(fake.history.filter((h) => ids.has(Number(h.OWNER_ID))));
    const catalog = await service.getCatalog(current.session!);
    const expected = buildDashboard(
      deals,
      history,
      catalog,
      filters,
      DEFAULT_SETTINGS,
      NOW,
      false,
      DOMAIN,
    );
    const actual = withoutClock(data);
    expect(actual.movements.length).toBeGreaterThan(50);
    expect(actual.movements.map((m: { entry: { ID: number } }) => m.entry.ID)).toEqual(
      withoutClock(expected).movements.map((m: { entry: { ID: number } }) => m.entry.ID),
    );
    // Empates de duração podem vir em outra ordem; o conteúdo é o mesmo.
    const byDeal = (rows: { deal: { id: number } }[]) =>
      [...rows].sort((a, b) => a.deal.id - b.deal.id);
    expect(byDeal(actual.stalled)).toEqual(byDeal(withoutClock(expected.stalled)));
    for (const key of ["retention", "average"] as const)
      expect(withoutClock(actual[key])).toEqual(withoutClock(expected[key]));
    expect(actual.stalled.length).toBeGreaterThan(0);
    expect(data.partial).toBe(false);
  });
  // Painel que o app deveria devolver com todos os dados lidos: todos os
  // negócios do período e os ativos, cada um com o histórico completo.
  const expectedDashboard = async (
    fake: ReturnType<typeof createFakeBitrix>,
    filters: { from: string; to: string },
  ) => {
    const inPeriod = new Set(
      fake.history
        .filter(
          (h) =>
            Date.parse(String(h.CREATED_TIME)) >= Date.parse(filters.from) &&
            Date.parse(String(h.CREATED_TIME)) <= Date.parse(filters.to),
        )
        .map((h) => Number(h.OWNER_ID)),
    );
    const deals = asDeals(fake.readableDeals()).filter(
      (d) => inPeriod.has(d.id) || d.stageSemanticId === "P",
    );
    const ids = new Set(deals.map((d) => d.id));
    return withoutClock(
      buildDashboard(
        deals,
        asHistory(fake.history.filter((h) => ids.has(Number(h.OWNER_ID)))),
        await service.getCatalog(current.session!),
        filters,
        DEFAULT_SETTINGS,
        NOW,
        false,
        DOMAIN,
      ),
    );
  };
  const periodOf = (days: number) => ({
    from: new Date(NOW - days * 86400000).toISOString(),
    to: new Date(NOW).toISOString(),
  });
  const byDeal = (rows: { deal: { id: number } }[]) =>
    [...rows].sort((a, b) => a.deal.id - b.deal.id);
  const expectSameDashboard = (
    actual: unknown,
    expected: ReturnType<typeof withoutClock>,
  ) => {
    const data = withoutClock(actual);
    expect(
      data.movements.map((m: { entry: { ID: number } }) => m.entry.ID),
    ).toEqual(
      expected.movements.map((m: { entry: { ID: number } }) => m.entry.ID),
    );
    expect(byDeal(data.stalled)).toEqual(byDeal(expected.stalled));
    expect(data.retention).toEqual(expected.retention);
    expect(data.average).toEqual(expected.average);
  };
  const historyReads = (fake: ReturnType<typeof createFakeBitrix>) =>
    fake.stats.byMethod["crm.stagehistory.list"] ?? 0;

  it("com mais de 500 ativos, lê todos sem aviso e dentro do limite do Bitrix24", async () => {
    const fake = createFakeBitrix({ now: NOW, deals: 900, enforceLimit: true });
    vi.stubGlobal("fetch", fake.fetch);
    const filters = periodOf(30);
    const data = await service.getDashboard(filters, DEFAULT_SETTINGS);
    const activeTotal = fake
      .readableDeals()
      .filter((d) => d.stageSemanticId === "P").length;
    expect(activeTotal).toBeGreaterThan(500);
    expect(data.activeCount).toBe(activeTotal);
    expect(data.partial).toBe(false);
    expect(data.warning).toBeUndefined();
    expect(fake.stats.limitErrors).toBe(0);
    expect(fake.stats.hits).toBeLessThanOrEqual(40);
    expectSameDashboard(data, await expectedDashboard(fake, filters));
  });
  it("ativo sem movimentação no período não custa histórico por negócio", async () => {
    const fake = createFakeBitrix({ now: NOW, deals: 900, moves: () => 1 });
    vi.stubGlobal("fetch", fake.fetch);
    const filters = periodOf(1);
    const data = await service.getDashboard(filters, DEFAULT_SETTINGS);
    const activeTotal = fake
      .readableDeals()
      .filter((d) => d.stageSemanticId === "P").length;
    expect(activeTotal).toBeGreaterThan(500);
    expect(data.activeCount).toBe(activeTotal);
    expect(data.partial).toBe(false);
    // Só quem se moveu no último dia teve o histórico lido, não os ~600 ativos.
    expect(historyReads(fake)).toBeLessThan(150);
    expect(fake.stats.hits).toBeLessThanOrEqual(15);
    expectSameDashboard(data, await expectedDashboard(fake, filters));
  });
  it("acima do orçamento de chamadas, detalha os mais recentes e avisa quantos", async () => {
    vi.stubEnv("BITRIX_DASHBOARD_MAX_DEALS", "98");
    const fake = createFakeBitrix({ now: NOW, deals: 900, enforceLimit: true });
    vi.stubGlobal("fetch", fake.fetch);
    const data = await service.getDashboard(periodOf(30), DEFAULT_SETTINGS);
    const activeTotal = fake
      .readableDeals()
      .filter((d) => d.stageSemanticId === "P").length;
    expect(data.partial).toBe(true);
    expect(data.warning).toContain("Foram detalhados 98 de ");
    // O total real de ativos continua exato; só o detalhe do período é parcial.
    expect(data.activeCount).toBe(activeTotal);
    expect(fake.stats.limitErrors).toBe(0);
  });
  it("atualizar de novo reaproveita o histórico dos ativos e relê quem mudou", async () => {
    const fake = createFakeBitrix({ now: NOW, deals: 400 });
    vi.stubGlobal("fetch", fake.fetch);
    const filters = periodOf(30);
    const first = await service.getDashboard(filters, DEFAULT_SETTINGS);
    const firstReads = historyReads(fake);
    const second = await service.getDashboard(filters, DEFAULT_SETTINGS);
    const secondReads = historyReads(fake) - firstReads;
    expect(secondReads).toBeLessThan(firstReads);
    expect(withoutClock(second)).toEqual(withoutClock(first));
    expectSameDashboard(second, await expectedDashboard(fake, filters));

    // Um negócio ativo ganha uma movimentação nova: o cache dele não vale mais.
    const cached = [...current.session!.dealHistory!.keys()][0];
    const deal = fake.deals.find((d) => d.id === cached)!;
    const next = deal.categoryId === 0 ? "EXECUTING" : "C3:WORK";
    const at = new Date(NOW - 1000).toISOString();
    fake.history.push({
      ID: Math.max(...fake.history.map((h) => Number(h.ID))) + 1,
      OWNER_ID: cached,
      CATEGORY_ID: deal.categoryId,
      STAGE_ID: next,
      STAGE_SEMANTIC_ID: "P",
      CREATED_TIME: at,
      MOVED_BY: 1,
    });
    Object.assign(deal, { stageId: next, movedTime: at, movedBy: 1 });
    const third = await service.getDashboard(filters, DEFAULT_SETTINGS);
    expectSameDashboard(third, await expectedDashboard(fake, filters));
  });
});

describe("abertura pelo Bitrix24", () => {
  const form = (id: string) =>
    new URLSearchParams({
      DOMAIN,
      AUTH_ID: `access-${id}`,
      REFRESH_ID: `refresh-${id}`,
      AUTH_EXPIRES: "3600",
      member_id: "member",
      PLACEMENT: "CRM_DEAL_DETAIL_TAB",
      PLACEMENT_OPTIONS: '{"ID":"10"}',
    });
  const open = (id: string, cookie?: string) =>
    placement(
      new Request("http://localhost:3000/api/bitrix/placement", {
        method: "POST",
        headers: {
          Origin: `https://${DOMAIN}`,
          "Content-Type": "application/x-www-form-urlencoded",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: form(id),
      }),
    );
  it("reaproveita a sessão do mesmo usuário e já adianta o catálogo", async () => {
    const fake = createFakeBitrix({ now: NOW });
    vi.stubGlobal("fetch", fake.fetch);
    const first = await open("1");
    const cookie = first.headers.get("set-cookie")!.split(";")[0];
    expect(sessions.size).toBe(1);
    const [session] = sessions.values();
    expect(session.userId).toBe(7);
    await session.catalogPending;
    expect(session.catalog?.data.pipelines).toHaveLength(2);
    const second = await open("2", cookie);
    // O valor criptografado muda a cada gravação; o ID da sessão não.
    const value = (header: string) => header.split(";")[0].split("=")[1];
    expect(
      sessionIdFromCookieValue(value(second.headers.get("set-cookie")!)),
    ).toBe(sessionIdFromCookieValue(value(cookie)));
    expect(sessions.size).toBe(1);
    expect(session.accessToken).toBe("access-2");
    const catalogCalls = fake.stats.byMethod["crm.category.list"];
    await Promise.resolve();
    expect(fake.stats.byMethod["crm.category.list"]).toBe(catalogCalls);
  });
  it("não reaproveita sessão de outro usuário", async () => {
    const fake = createFakeBitrix({ now: NOW });
    vi.stubGlobal("fetch", fake.fetch);
    const first = await open("1");
    const cookie = first.headers.get("set-cookie")!.split(";")[0];
    const [session] = sessions.values();
    session.userId = 99;
    await open("2", cookie);
    expect(sessions.size).toBe(2);
    expect(session.accessToken).toBe("access-1");
  });
});
