import { test, expect } from "@playwright/test";
test("painel, filtros e atualização manual", async ({ page }, testInfo) => {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Seu processo, em perspectiva." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Atualizar dados" }),
  ).toBeEnabled();
  await expect(
    page.getByText("Modo demonstração", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `docs/screenshots/dashboard-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByLabel("Pipeline", { exact: true }).selectOption("3");
  await expect(
    page.getByRole("button", { name: "Atualizar dados" }),
  ).toBeEnabled();
  const responsePromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/dashboard") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Atualizar dados" }).click();
  const data = await (await responsePromise).json();
  expect(
    data.movements.every(
      (m: { entry: { CATEGORY_ID: number } }) => m.entry.CATEGORY_ID === 3,
    ),
  ).toBeTruthy();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("jornada mostra timeline e dados próprios do histórico", async ({
  page,
}, testInfo) => {
  await page.goto("/deal/8061/journey");
  await expect(
    page.getByRole("heading", { name: "Acme · Expansão comercial" }),
  ).toBeVisible();
  await expect(page.getByText("Você está aqui")).toBeVisible();
  await expect(page.locator(".timeline-item")).toHaveCount(4);
  await expect(
    page.getByText("Movido por Mariana Silva").first(),
  ).toBeVisible();
  await expect(page.locator(".journey-heading")).not.toContainText(
    "Enterprise",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `docs/screenshots/journey-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
test("configurações persistem e afetam o painel", async ({ page }) => {
  await page.goto("/settings");
  await page
    .getByRole("spinbutton", { name: "Limite de horas para card parado" })
    .fill("24");
  await page
    .getByRole("switch", { name: "Movimentações", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Salvar preferências" }).click();
  await expect(page.getByRole("status")).toContainText("Preferências salvas");
  await page.reload();
  await expect(page.getByRole("spinbutton")).toHaveValue("24");
  await page.goto("/dashboard");
  await expect(
    page.getByRole("button", { name: "Atualizar dados" }),
  ).toBeEnabled();
  await expect(page.locator(".stat-card")).toHaveCount(3);
});
test("carregamento, erro com nova tentativa e lista vazia", async ({
  page,
}) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/dashboard", async (route) => {
    await gate;
    await route.fulfill({
      status: 403,
      json: {
        error:
          "Você não tem permissão para consultar o histórico desses negócios.",
        code: "ACCESS_DENIED",
      },
    });
  });
  await page.goto("/dashboard");
  await expect(
    page.getByRole("status", { name: "Carregando dados" }),
  ).toBeVisible();
  release();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Você não tem permissão",
  );
  await page.unroute("**/api/dashboard");
  await page.route("**/api/dashboard", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      json: {
        ...data,
        movements: [],
        stalled: [],
        retention: [],
        activeCount: 0,
        average: 0,
      },
    });
  });
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(
    page.locator(".movements-panel").getByRole("heading", {
      name: "Nenhuma movimentação encontrada",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Tudo fluindo por aqui")).toBeVisible();
});
test("telas de gestão, instalação e estado de negócio ausente", async ({
  page,
}) => {
  for (const [path, title] of [
    ["movements", "Cada movimento, um novo caminho."],
    ["stalled", "Atenção onde faz diferença."],
    ["stages", "Encontre o ritmo do seu funil."],
  ]) {
    await page.goto(`/dashboard/${path}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Atualizar dados" }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.goto("/install");
  await expect(
    page.getByRole("button", { name: "Registrar placements" }),
  ).toBeDisabled();
  await page.goto("/deal/999999/journey");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Negócio não encontrado",
  );
});
test("valida período personalizado sem enviar consultas inválidas", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await page.getByLabel("Período", { exact: true }).selectOption("custom");
  await expect(
    page.getByText("Escolha um período", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Data inicial").fill("2020-01-01");
  await page.getByLabel("Data final").fill("2020-01-02");
  await expect(
    page.locator(".movements-panel").getByRole("heading", {
      name: "Nenhuma movimentação encontrada",
      exact: true,
    }),
  ).toBeVisible();
});
test("histórico vazio e erro de consulta na aba do card", async ({ page }) => {
  await page.route("**/api/deal/8061", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      json: { ...data, visits: [], totalDuration: 0, lastMovement: null },
    });
  });
  await page.goto("/deal/8061/journey");
  await expect(
    page.getByText(
      "Nenhum histórico de etapas foi retornado para este negócio.",
      { exact: false },
    ),
  ).toBeVisible();
  await page.unroute("**/api/deal/8061");
  await page.route("**/api/deal/8061", (route) =>
    route.fulfill({
      status: 502,
      json: { error: "O Bitrix24 não respondeu a tempo.", code: "NETWORK" },
    }),
  );
  await page
    .getByRole("button", { name: "Atualizar jornada", exact: true })
    .first()
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "O Bitrix24 não respondeu a tempo",
  );
});

test("navega pelo menu e usa a paginação das movimentações", async ({
  page,
  isMobile,
}) => {
  await page.goto("/dashboard");
  if (isMobile) await page.getByRole("button", { name: "Abrir menu" }).click();
  await page
    .getByRole("navigation", { name: "Navegação principal" })
    .getByRole("link", { name: "Movimentações", exact: true })
    .click();
  await expect(page).toHaveURL("/dashboard/movements");
  await page.getByLabel("Período", { exact: true }).selectOption("30d");
  await expect(
    page.getByRole("button", { name: "Atualizar dados" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Próxima página" }).click();
  await expect(page.locator(".pagination")).toContainText("Página 2");
  await page.getByRole("button", { name: "Página anterior" }).click();
  await expect(page.locator(".pagination")).toContainText("Página 1");
});
