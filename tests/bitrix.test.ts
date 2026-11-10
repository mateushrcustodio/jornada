import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAll, rest } from "@/lib/bitrix/client";
import { validateDomain } from "@/lib/bitrix/config";
import { verifyApp } from "@/lib/bitrix/auth";
import { createSession, sessions, type Session } from "@/lib/bitrix/session";
import { assertSameOrigin } from "@/lib/http";
const session = (): Session => ({
  id: "test",
  domain: "example.bitrix24.com.br",
  memberId: "member",
  accessToken: "private-token",
  refreshToken: "private-refresh",
  tokenExpiresAt: Date.now() + 3600000,
  expiresAt: Date.now() + 3600000,
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => {
  vi.stubEnv("BITRIX_ALLOWED_DOMAINS", "example.bitrix24.com.br");
  vi.stubEnv("BITRIX_CLIENT_ID", "local.test");
  vi.stubEnv("BITRIX_CLIENT_SECRET", "secret");
  vi.stubEnv("APP_URL", "http://localhost:3000");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  sessions.clear();
});
describe("integração e segurança", () => {
  it("rejeita domínio externo, caminhos e domínios parecidos", () => {
    expect(validateDomain("example.bitrix24.com.br")).toBe(
      "example.bitrix24.com.br",
    );
    for (const value of [
      "localhost",
      "127.0.0.1",
      "example.bitrix24.com.br.evil.com",
      "example.bitrix24.com.br/path",
      "example.bitrix24.com.br@evil.com",
    ])
      expect(() => validateDomain(value)).toThrow();
  });
  it("percorre todas as páginas de result.items e resultado direto", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ result: { items: [1, 2] }, next: 50 }))
      .mockResolvedValueOnce(json({ result: [3] }));
    vi.stubGlobal("fetch", fetch);
    const result = await listAll(session(), "crm.stagehistory.list", {
      entityTypeId: 2,
    });
    expect(result).toEqual([1, 2, 3]);
    expect(JSON.parse(fetch.mock.calls[1][1].body).start).toBe(50);
  });
  it("interrompe paginação repetida e excesso sem apresentar amostra parcial", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ result: { items: [1] }, next: 0 })),
    );
    await expect(
      listAll(session(), "crm.stagehistory.list", {}),
    ).rejects.toThrow("paginação");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ result: [1, 2] })));
    await expect(
      listAll(session(), "crm.stagehistory.list", {}, "items", 1),
    ).rejects.toThrow("limite");
  });
  it("traduz erro de permissão sem vazar descrição ou token", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          json(
            {
              error: "ACCESS_DENIED",
              error_description: "private-token debug",
            },
            403,
          ),
        ),
    );
    await expect(
      rest(session(), "crm.item.get", { id: 1 }),
    ).rejects.toMatchObject({
      status: 403,
      message:
        "Você não tem permissão para consultar o histórico desses negócios.",
    });
  });
  it("rejeita autorização emitida para outra aplicação", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ result: { CODE: "other.app" } })),
    );
    await expect(verifyApp(session())).rejects.toMatchObject({
      code: "APP_CONTEXT",
    });
  });
  it("renova OAuth no servidor e mantém o domínio autorizado", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          access_token: "new-token",
          refresh_token: "new-refresh",
          member_id: "member",
          domain: "example.bitrix24.com.br",
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(json({ result: { item: { id: 1 } } }));
    vi.stubGlobal("fetch", fetch);
    const s = session();
    s.tokenExpiresAt = 0;
    await rest(s, "crm.item.get", { id: 1 });
    expect(s.accessToken).toBe("new-token");
    expect(fetch.mock.calls[0][0]).toBe(
      "https://oauth.bitrix.info/oauth/token/",
    );
    expect(JSON.parse(fetch.mock.calls[1][1].body).auth).toBe("new-token");
  });
  it("protege as mutações contra requisições de outra origem", () => {
    expect(() =>
      assertSameOrigin(
        new Request("http://localhost:3000/api/install", {
          headers: {
            Origin: "https://evil.com",
            "Content-Type": "application/json",
          },
        }),
      ),
    ).toThrow();
    expect(() =>
      assertSameOrigin(
        new Request("http://localhost:3000/api/install", {
          headers: {
            Origin: "http://localhost:3000",
            "Content-Type": "application/json",
          },
        }),
      ),
    ).not.toThrow();
  });
  it("cria sessões opacas e elimina sessões expiradas", () => {
    sessions.set("old", { ...session(), expiresAt: 0 });
    const created = createSession(session());
    expect(created.id).toMatch(/^[a-f0-9]{64}$/);
    expect(sessions.has("old")).toBe(false);
    expect(created.id).not.toContain("private-token");
  });
});
