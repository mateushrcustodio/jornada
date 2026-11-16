import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Cookies da requisição simulados: o mesmo "navegador" falando com instâncias
// diferentes do servidor (cada instância = Map de sessões vazio).
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name)! } : undefined,
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
  }),
}));

const { POST } = await import("@/app/api/bitrix/placement/route");
const { rest } = await import("@/lib/bitrix/client");
const {
  createSession,
  getSession,
  sealSession,
  sessionCookieValue,
  sessions,
  SESSION_COOKIE,
  unsealSession,
} = await import("@/lib/bitrix/session");

const DOMAIN = "example.bitrix24.com.br";
const data = () => ({
  domain: DOMAIN,
  memberId: "member",
  accessToken: "private-token",
  refreshToken: "private-refresh",
  tokenExpiresAt: Date.now() + 3600000,
  userId: 7,
});
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("BITRIX_ALLOWED_DOMAINS", DOMAIN);
  vi.stubEnv("BITRIX_CLIENT_ID", "local.test");
  vi.stubEnv("BITRIX_CLIENT_SECRET", "secret");
  vi.stubEnv("SESSION_SECRET", "");
  vi.stubEnv("BITRIX_APP_CODE", "");
  vi.stubEnv("BITRIX_APPLICATION_TOKEN", "");
  vi.stubEnv("BITRIX_MEMBER_ID", "");
  vi.stubEnv("APP_URL", "http://localhost:3000");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  sessions.clear();
  jar.clear();
});

describe("cookie de sessão criptografado", () => {
  it("não expõe tokens e recusa cookie adulterado ou de outra chave", () => {
    const session = createSession(data());
    const value = sessionCookieValue(session);
    expect(value).not.toContain("private-token");
    expect(value).not.toContain("private-refresh");
    expect(Buffer.from(value.slice(3), "base64url").toString()).not.toContain(
      "private",
    );
    expect(unsealSession(value)).toMatchObject({
      id: session.id,
      accessToken: "private-token",
      userId: 7,
    });
    const last = value.at(-1) === "A" ? "B" : "A";
    expect(unsealSession(value.slice(0, -1) + last)).toBeUndefined();
    expect(unsealSession("v1.lixo")).toBeUndefined();
    expect(unsealSession(session.id)).toBeUndefined();
    vi.stubEnv("SESSION_SECRET", "x".repeat(32));
    expect(unsealSession(value)).toBeUndefined();
  });

  it("exige SESSION_SECRET longa quando definida", () => {
    vi.stubEnv("SESSION_SECRET", "curta");
    expect(() => sealSession(createSession(data()))).toThrow(/SESSION_SECRET/);
  });

  it("outra instância do servidor recria a sessão a partir do cookie", async () => {
    const original = createSession(data());
    jar.set(SESSION_COOKIE, sessionCookieValue(original));
    sessions.clear(); // a próxima requisição caiu numa instância sem memória
    const restored = await getSession();
    expect(restored.id).toBe(original.id);
    expect(restored.accessToken).toBe("private-token");
    expect(restored.userId).toBe(7);
    expect(sessions.get(original.id)).toBe(restored);
    expect(await getSession()).toBe(restored);
  });

  it("sem cookie, cookie inválido ou vencido continua pedindo nova sessão", async () => {
    await expect(getSession()).rejects.toMatchObject({ status: 401 });
    jar.set(SESSION_COOKIE, "a".repeat(64));
    await expect(getSession()).rejects.toMatchObject({ status: 401 });
    const expired = createSession(data());
    expired.expiresAt = Date.now() - 1;
    jar.set(SESSION_COOKIE, sessionCookieValue(expired));
    await expect(getSession()).rejects.toMatchObject({ status: 401 });
  });

  it("usa os tokens mais novos entre memória e cookie", async () => {
    const session = createSession(data());
    jar.set(
      SESSION_COOKIE,
      sealSession({
        ...session,
        accessToken: "newer",
        refreshToken: "newer-refresh",
        tokenExpiresAt: session.tokenExpiresAt + 60000,
      }),
    );
    const current = await getSession();
    expect(current).toBe(session);
    expect(current.accessToken).toBe("newer");
    expect(current.refreshToken).toBe("newer-refresh");
  });

  it("ao renovar o token, regrava o cookie com o refresh token novo", async () => {
    const session = createSession({ ...data(), tokenExpiresAt: 0 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).startsWith("https://oauth.bitrix.info")
          ? json({
              access_token: "renewed",
              refresh_token: "renewed-refresh",
              expires_in: 3600,
              member_id: "member",
              domain: DOMAIN,
            })
          : json({ result: { ok: true } }),
      ),
    );
    await rest(session, "profile");
    const cookie = unsealSession(jar.get(SESSION_COOKIE)!);
    expect(cookie).toMatchObject({
      id: session.id,
      accessToken: "renewed",
      refreshToken: "renewed-refresh",
    });
  });

  it("app aberto numa instância continua funcionando em outra", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("/rest/profile")
          ? json({ result: { ID: "7" } })
          : String(url).includes("/rest/app.info")
            ? json({ result: { CODE: "local.test" } })
            : json({ result: [] }),
      ),
    );
    const response = await POST(
      new Request("http://localhost:3000/api/bitrix/placement", {
        method: "POST",
        headers: {
          Origin: `https://${DOMAIN}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          DOMAIN,
          AUTH_ID: "access-1",
          REFRESH_ID: "refresh-1",
          AUTH_EXPIRES: "3600",
          member_id: "member",
          PLACEMENT: "CRM_ANALYTICS_MENU",
        }),
      }),
    );
    expect(response.status).toBe(303);
    const header = response.headers.get("set-cookie")!;
    expect(header).not.toContain("access-1");
    const value = header.split(";")[0].split("=")[1];
    const [opened] = sessions.values();
    sessions.clear();
    jar.set(SESSION_COOKIE, value);
    const session = await getSession();
    expect(session.id).toBe(opened.id);
    expect(session.accessToken).toBe("access-1");
    expect(session.userId).toBe(7);
  });
});
