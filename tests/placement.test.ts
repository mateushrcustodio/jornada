import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/bitrix/placement/route";
import { sessions } from "@/lib/bitrix/session";
const input = {
  DOMAIN: "example.bitrix24.com.br",
  AUTH_ID: "secret-access",
  REFRESH_ID: "secret-refresh",
  AUTH_EXPIRES: "3600",
  member_id: "member",
  PLACEMENT: "CRM_DEAL_DETAIL_TAB",
  PLACEMENT_OPTIONS: '{"ID":"8061"}',
};
function request(changes = {}, origin = "https://example.bitrix24.com.br") {
  return new Request("http://localhost:3000/api/bitrix/placement", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ ...input, ...changes }),
  });
}
beforeEach(() => {
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("BITRIX_ALLOWED_DOMAINS", input.DOMAIN);
  vi.stubEnv("BITRIX_CLIENT_ID", "local.test");
  vi.stubEnv("BITRIX_CLIENT_SECRET", "secret");
  vi.stubEnv("BITRIX_APP_CODE", "");
  vi.stubEnv("BITRIX_APPLICATION_TOKEN", "");
  vi.stubEnv("BITRIX_MEMBER_ID", "");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ result: { CODE: "local.test" } })),
      ),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  sessions.clear();
});
describe("handler comum dos placements", () => {
  it("valida o POST e redireciona ao ID do card sem expor tokens", async () => {
    const response = await POST(request());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/deal/8061/journey",
    );
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).not.toContain("secret-access");
    expect(cookie).not.toContain("secret-refresh");
    expect(sessions.size).toBe(1);
  });
  it("abre analytics sem ID de negócio", async () => {
    const response = await POST(
      request({ PLACEMENT: "CRM_ANALYTICS_MENU", PLACEMENT_OPTIONS: "{}" }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/dashboard",
    );
  });
  it("rejeita JSON de opções malformado e ID inválido", async () => {
    for (const options of ["{broken", '{"ID":"../1"}', "{}", '{"ID":-1}']) {
      const response = await POST(request({ PLACEMENT_OPTIONS: options }));
      expect(response.status).toBe(400);
    }
    expect(sessions.size).toBe(0);
  });
  it("rejeita origem incorreta e token de aplicação divergente", async () => {
    expect((await POST(request({}, "https://evil.com"))).status).toBe(403);
    vi.stubEnv("BITRIX_APPLICATION_TOKEN", "expected");
    expect((await POST(request())).status).toBe(403);
    expect(sessions.size).toBe(0);
  });
  it("bloqueia instalação real em modo demonstração", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    expect((await POST(request())).status).toBe(409);
    expect(sessions.size).toBe(0);
  });
});
