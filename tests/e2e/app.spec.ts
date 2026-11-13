import { test, expect } from "@playwright/test";
test("painel, filtros e atualização manual", async ({ page }, testInfo) => {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Jornada", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Atualizar", exact: true }),
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
    page.getByRole("button", { name: "Atualizar", exact: true }),
  ).toBeEnabled();
  const responsePromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/dashboard") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Atualizar", exact: true }).click();
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
    page.getByRole("button", { name: "Atualizar", exact: true }),
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
    ["movements", "Movimentações"],
    ["stalled", "Negócios parados"],
    ["stages", "Etapas"],
  ]) {
    await page.goto(`/dashboard/${path}`);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Atualizar", exact: true }),
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
}) => {
  await page.goto("/dashboard");
  await page
    .getByRole("navigation", { name: "Navegação principal" })
    .getByRole("link", { name: "Movimentações", exact: true })
    .click();
  await expect(page).toHaveURL("/dashboard/movements");
  await page.getByLabel("Período", { exact: true }).selectOption("30d");
  await expect(
    page.getByRole("button", { name: "Atualizar", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Próxima página" }).click();
  await expect(page.locator(".pagination")).toContainText("Página 2");
  await page.getByRole("button", { name: "Página anterior" }).click();
  await expect(page.locator(".pagination")).toContainText("Página 1");
});
test("autópsia aparece só em negócio fechado, com desvios e publicação", async ({
  page,
}, testInfo) => {
  await page.goto("/deal/8061/journey");
  await expect(page.getByText("Você está aqui")).toBeVisible();
  await expect(page.getByText("Autópsia do negócio")).toHaveCount(0);

  await page.goto("/deal/9001/journey");
  const panel = page.locator(".autopsy-panel");
  await expect(
    panel.getByRole("heading", { name: "Autópsia do negócio" }),
  ).toBeVisible();
  await expect(panel.locator(".outcome.won")).toBeVisible();
  await expect(panel.getByText("Negociação")).toBeVisible();
  await expect(
    panel.getByText("Proposta enviada → Qualificação"),
  ).toBeVisible();
  await expect(panel.getByText(/negócios ganhos deste funil/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `docs/screenshots/autopsy-${testInfo.project.name}.png`,
    fullPage: true,
  });

  const request = page.waitForRequest(
    (r) => r.url().endsWith("/api/deal/9001/autopsy") && r.method() === "POST",
  );
  await panel.getByRole("button", { name: "Publicar na timeline" }).click();
  await request;
  await expect(panel.getByRole("status")).toContainText("Publicação simulada");
  await expect(panel.getByRole("button", { name: "Publicada" })).toBeDisabled();

  await page.goto("/deal/9005/journey");
  await expect(panel.locator(".outcome.lost")).toBeVisible();
  await expect(panel.getByText("Etapas puladas")).toBeVisible();
});
test("card aberto pelo painel tem botão para voltar ao painel", async ({
  page,
}) => {
  await page.goto("/dashboard/stalled");
  await page.locator('a[href*="/journey?source=dashboard"]').first().click();
  await expect(page).toHaveURL(/\/deal\/\d+\/journey\?source=dashboard/);
  const back = page.getByRole("link", { name: "Voltar ao painel" });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("link", { name: "Visão geral" })).toBeVisible();
});
test("card aberto dentro do Bitrix24 não mostra o botão de voltar", async ({
  page,
}) => {
  await page.goto("/deal/8061/journey");
  await expect(
    page.getByRole("heading", { name: "Acme · Expansão comercial" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Voltar ao painel" }),
  ).toHaveCount(0);
});
test("Movimentações e Parados buscam só a página aberta", async ({ page }) => {
  const full: string[] = [];
  const pages: { kind: string; page: number }[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    if (request.url().endsWith("/api/dashboard")) full.push(request.url());
    if (request.url().endsWith("/api/dashboard/page"))
      pages.push(request.postDataJSON());
  });
  await page.goto("/dashboard/movements");
  await page.getByLabel("Período", { exact: true }).selectOption("30d");
  await expect(page.locator(".pagination")).toContainText("Página 1");
  await page.getByRole("button", { name: "Próxima página" }).click();
  await expect(page.locator(".pagination")).toContainText("Página 2");
  // Voltar para uma página já vista não busca de novo.
  const before = pages.length;
  await page.getByRole("button", { name: "Página anterior" }).click();
  await expect(page.locator(".pagination")).toContainText("Página 1");
  expect(pages.length).toBe(before);
  expect(pages.every((body) => body.kind === "movements")).toBe(true);
  expect(pages.map((body) => body.page)).toContain(2);
  await page.goto("/dashboard/stalled");
  await expect(
    page.getByRole("heading", { name: "Negócios parados", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".stalled-panel")).toBeVisible();
  expect(pages.at(-1)?.kind).toBe("stalled");
  // Nenhuma das duas abas pediu o painel completo.
  expect(full).toHaveLength(0);
});

// Lê uma coluna da tabela de Movimentações pelo título.
async function column(page: import("@playwright/test").Page, title: string) {
  return page.evaluate((name) => {
    const headers = [...document.querySelectorAll("thead th")];
    const index = headers.findIndex((th) => th.textContent?.trim() === name);
    return [...document.querySelectorAll("tbody tr")].map(
      (row) => row.children[index]?.textContent?.trim() ?? "",
    );
  }, title);
}
const reais = (text: string) =>
  Number(text.replace(/[^\d,]/g, "").replace(",", "."));
const DEFAULT_COLUMNS = [
  "Negócio",
  "Pipeline",
  "Movimentação",
  "Quando",
  "Movido por",
  "Pessoa responsável",
  "Faturamento",
];

test("Movimentações: filtros por responsável e faturamento", async ({
  page,
}) => {
  await page.goto("/dashboard/movements");
  await page.getByLabel("Período", { exact: true }).selectOption("30d");
  await expect(page.locator("thead th")).toHaveText(DEFAULT_COLUMNS);
  await expect
    .poll(async () => (await column(page, "Faturamento")).length)
    .toBeGreaterThan(0);
  const everyone = await page
    .locator(".count-badge")
    .filter({ hasText: "registros" })
    .textContent();
  const names = await column(page, "Pessoa responsável");
  expect(names.every((name) => name && name !== "Não informado")).toBe(true);

  await page
    .getByLabel("Responsável", { exact: true })
    .selectOption({ label: "Pedro Santos" });
  await expect
    .poll(async () => {
      const rows = await column(page, "Pessoa responsável");
      return rows.length > 0 && rows.every((name) => name === "Pedro Santos");
    })
    .toBe(true);
  await expect(
    page.locator(".count-badge").filter({ hasText: "registros" }),
  ).not.toHaveText(everyone ?? "");

  await page.getByRole("button", { name: "Limpar" }).click();
  await page.getByLabel("Faturamento mínimo").fill("50.000");
  await expect
    .poll(async () => {
      const rows = await column(page, "Faturamento");
      return rows.length > 0 && rows.every((text) => reais(text) >= 50000);
    })
    .toBe(true);
  await page.getByLabel("Faturamento máximo").fill("100000");
  await expect
    .poll(async () => {
      const rows = (await column(page, "Faturamento")).map(reais);
      return rows.length > 0 && rows.every((v) => v >= 50000 && v <= 100000);
    })
    .toBe(true);
  // Faixa invertida não consulta e explica o motivo.
  await page.getByLabel("Faturamento mínimo").fill("200000");
  await expect(
    page.getByText("O faturamento mínimo não pode ser maior"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Limpar" }).click();
  await expect(page.getByLabel("Faturamento mínimo")).toHaveValue("");
  await expect(page.getByLabel("Faturamento máximo")).toHaveValue("");
  await expect
    .poll(async () => (await column(page, "Faturamento")).length)
    .toBeGreaterThan(0);
});

test("Movimentações: seta do faturamento alterna maior→menor e menor→maior", async ({
  page,
}) => {
  await page.goto("/dashboard/movements");
  await page.getByLabel("Período", { exact: true }).selectOption("30d");
  await expect
    .poll(async () => (await column(page, "Faturamento")).length)
    .toBeGreaterThan(0);
  const header = page.locator("th", { hasText: "Faturamento" });
  await expect(header).toHaveAttribute("aria-sort", "none");
  const sortButton = header.locator(".sort-button");
  const sortedValues = async (direction: "desc" | "asc") => {
    await expect(header).toHaveAttribute(
      "aria-sort",
      direction === "desc" ? "descending" : "ascending",
    );
    return (await column(page, "Faturamento")).map(reais);
  };
  await sortButton.click();
  const desc = await expect
    .poll(async () => {
      const values = (await column(page, "Faturamento")).map(reais);
      return (
        values.length > 1 && values.every((v, i) => !i || values[i - 1] >= v)
      );
    })
    .toBe(true)
    .then(() => sortedValues("desc"));
  await sortButton.click();
  await expect
    .poll(async () => {
      const values = (await column(page, "Faturamento")).map(reais);
      return (
        values.length > 1 && values.every((v, i) => !i || values[i - 1] <= v)
      );
    })
    .toBe(true);
  const asc = await sortedValues("asc");
  // O maior valor de todas as páginas vem primeiro na ordem decrescente.
  expect(desc[0]).toBeGreaterThanOrEqual(asc.at(-1)!);
  expect(asc[0]).toBeLessThanOrEqual(desc.at(-1)!);
  // A ordenação vale para todas as páginas, não só a visível.
  await page.getByRole("button", { name: "Próxima página" }).click();
  await expect(page.locator(".pagination")).toContainText("Página 2");
  const second = (await column(page, "Faturamento")).map(reais);
  expect(second[0]).toBeGreaterThanOrEqual(asc.at(-1)!);
});

test("Movimentações: colunas se reorganizam pelo teclado e a ordem fica salva", async ({
  page,
}) => {
  await page.goto("/dashboard/movements");
  await page.getByLabel("Período", { exact: true }).selectOption("30d");
  await expect(page.locator("thead th")).toHaveText(DEFAULT_COLUMNS);
  await page.getByRole("button", { name: "Mover coluna Faturamento" }).focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  const moved = [
    "Negócio",
    "Pipeline",
    "Movimentação",
    "Quando",
    "Faturamento",
    "Movido por",
    "Pessoa responsável",
  ];
  await expect(page.locator("thead th")).toHaveText(moved);
  // Os valores acompanham o título.
  expect((await column(page, "Faturamento")).every((v) => /\d/.test(v))).toBe(
    true,
  );
  await page.reload();
  await page.getByLabel("Período", { exact: true }).selectOption("30d");
  await expect(page.locator("thead th")).toHaveText(moved);
  await page.getByRole("button", { name: "Restaurar colunas" }).click();
  await expect(page.locator("thead th")).toHaveText(DEFAULT_COLUMNS);
  await expect(
    page.getByRole("button", { name: "Restaurar colunas" }),
  ).toHaveCount(0);
});

test("Movimentações: arrastar acompanha o ponteiro, as vizinhas deslizam e a coluna assenta", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "arraste com mouse");
  await page.goto("/dashboard/movements");
  await page.getByLabel("Período", { exact: true }).selectOption("30d");
  await expect(page.locator("thead th")).toHaveText(DEFAULT_COLUMNS);
  const grip = page.getByRole("button", { name: "Mover coluna Pipeline" });
  const header = (await page
    .locator('th[data-column="pipeline"]')
    .boundingBox())!;
  const neighbour = (await page
    .locator('th[data-column="movement"]')
    .boundingBox())!;
  const from = (await grip.boundingBox())!;
  // A coluna assenta onde fica o seu centro: andar a metade de cada largura
  // leva o centro de Pipeline até o meio de Movimentação.
  const distance = (header.width + neighbour.width) / 2;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    from.x + from.width / 2 + distance,
    from.y + from.height / 2,
    { steps: 8 },
  );
  // Durante o arraste a coluna (cabeçalho e linhas) segue o ponteiro...
  const dragged = page.locator('th[data-column="pipeline"]');
  await expect(dragged).toHaveClass(/col-dragged/);
  await expect(page.locator("tbody tr:first-child td.col-dragged")).toHaveCount(
    1,
  );
  const moved = (await dragged.boundingBox())!;
  expect(moved.x).toBeGreaterThan(from.x + 50);
  // ...e a vizinha desliza para a casa que ficou livre.
  await expect(page.locator('th[data-column="movement"]')).toHaveCSS(
    "transform",
    /matrix\(1, 0, 0, 1, -\d+/,
  );
  await page.mouse.up();
  await expect(page.locator("thead th")).toHaveText([
    "Negócio",
    "Movimentação",
    "Pipeline",
    "Quando",
    "Movido por",
    "Pessoa responsável",
    "Faturamento",
  ]);
  // Depois de assentar, nada fica deslocado nem marcado como arrastado.
  await expect(page.locator(".col-dragged, .col-shift")).toHaveCount(0);
  await expect(page.locator('th[data-column="pipeline"]')).toHaveCSS(
    "transform",
    "none",
  );
});

test("Movimentações: arrastar pelo texto do título funciona e um clique não troca nada", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "arraste com mouse");
  await page.goto("/dashboard/movements");
  await page.getByLabel("Período", { exact: true }).selectOption("30d");
  await expect(page.locator("thead th")).toHaveText(DEFAULT_COLUMNS);
  await page.locator("th", { hasText: "Quando" }).getByText("Quando").click();
  await expect(page.locator("thead th")).toHaveText(DEFAULT_COLUMNS);
  const label = (await page
    .locator("th", { hasText: "Faturamento" })
    .getByText("Faturamento")
    .boundingBox())!;
  const first = (await page
    .locator("th", { hasText: "Negócio" })
    .boundingBox())!;
  await page.mouse.move(label.x + 5, label.y + label.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + 20, first.y + first.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(page.locator("thead th")).toHaveText([
    "Faturamento",
    "Negócio",
    "Pipeline",
    "Movimentação",
    "Quando",
    "Movido por",
    "Pessoa responsável",
  ]);
});
