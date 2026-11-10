import { afterEach, describe, expect, it, vi } from "vitest";
import { getDashboard, getJourney } from "@/lib/bitrix/service";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import type { Session } from "@/lib/bitrix/session";
const { listAll, rest, getSession } = vi.hoisted(() => ({
  listAll: vi.fn(),
  rest: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@/lib/bitrix/client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listAll,
  rest,
}));
vi.mock("@/lib/bitrix/session", () => ({ getSession }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
describe("consultas do painel real", () => {
  it("busca inativos no período, preserva sequência completa e omite negócios sem acesso", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    const now = Date.now();
    getSession.mockResolvedValue({
      id: "test",
      domain: "example.bitrix24.com.br",
      memberId: "member",
      accessToken: "token",
      refreshToken: "refresh",
      tokenExpiresAt: now + 60000,
      expiresAt: now + 60000,
      catalog: {
        data: { pipelines: [{ id: 0, name: "Comercial" }], stages: [] },
        expiresAt: now + 60000,
      },
    } satisfies Session);
    const makeEntry = (id: number, owner: number, time: number) => ({
      ID: id,
      OWNER_ID: owner,
      CATEGORY_ID: 0,
      STAGE_ID: "NEW",
      STAGE_SEMANTIC_ID: "P",
      CREATED_TIME: new Date(time).toISOString(),
    });
    listAll.mockImplementation(async (_session, method, params) => {
      if (method === "crm.stagehistory.list" && params.filter[">=CREATED_TIME"])
        return [makeEntry(1, 1, now - 1000), makeEntry(2, 999, now - 1000)];
      if (method === "crm.item.list")
        return [
          {
            id: 1,
            title: "Autorizado",
            categoryId: 0,
            stageId: "NEW",
            stageSemanticId: "P",
          },
        ];
      return [makeEntry(1, 1, now - 200 * 3600000)];
    });
    const data = await getDashboard(
      {
        from: new Date(now - 86400000).toISOString(),
        to: new Date(now + 1000).toISOString(),
      },
      DEFAULT_SETTINGS,
    );
    const activeQuery = listAll.mock.calls.find(
      (call) =>
        call[1] === "crm.item.list" && call[2].filter.stageSemanticId === "P",
    );
    expect(activeQuery?.[2].filter).toEqual({ stageSemanticId: "P" });
    const fullQuery = listAll.mock.calls.find(
      (call) => call[1] === "crm.stagehistory.list" && call[2].filter.OWNER_ID,
    );
    expect(fullQuery?.[2].filter).toEqual({ OWNER_ID: [1] });
    expect(data.stalled).toHaveLength(1);
    expect(data.stalled[0].deal.id).toBe(1);
    expect(JSON.stringify(data)).not.toContain("999");
  });
  it("consulta o item com as permissões do usuário antes do histórico", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    getSession.mockResolvedValue({});
    rest.mockRejectedValue(new Error("sem acesso"));
    await expect(getJourney(123)).rejects.toThrow("sem acesso");
    expect(rest).toHaveBeenCalledWith({}, "crm.item.get", {
      entityTypeId: 2,
      id: 123,
    });
    expect(listAll).not.toHaveBeenCalled();
  });
  it("um erro da integração real não cai silenciosamente em dados sintéticos", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    getSession.mockRejectedValue(new Error("sessão expirada"));
    await expect(
      getDashboard(
        { from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z" },
        DEFAULT_SETTINGS,
      ),
    ).rejects.toThrow("sessão expirada");
  });
});
