import type { Catalog, Deal, HistoryEntry } from "./types";
// Dados sintéticos EXCLUSIVOS do modo DEMO_MODE=true. Nunca usados como fallback da API real.
export function demoDataset(now = Date.now()): {
  catalog: Catalog;
  deals: Deal[];
  history: HistoryEntry[];
} {
  const labels = [
    "Novo negócio",
    "Qualificação",
    "Proposta enviada",
    "Negociação",
    "Ganho",
    "Perdido",
  ];
  const ids = [
    "NEW",
    "PREPARATION",
    "PREPAYMENT_INVOICE",
    "EXECUTING",
    "WON",
    "LOSE",
  ];
  const colors = [
    "#7894bd",
    "#5c82e2",
    "#a48bd4",
    "#e3a255",
    "#4e9e85",
    "#c97979",
  ];
  const catalog: Catalog = {
    pipelines: [
      { id: 0, name: "Comercial" },
      { id: 3, name: "Enterprise" },
    ],
    stages: [0, 3].flatMap((categoryId) =>
      ids.map((id, i) => ({
        id: categoryId ? `C${categoryId}:${id}` : id,
        categoryId,
        name: labels[i],
        sort: i * 10,
        color: colors[i],
      })),
    ),
  };
  const names = [
    "Acme · Expansão comercial",
    "Nuvem Tech · Plataforma de gestão",
    "Aurora · Consultoria estratégica",
    "Horizonte · Projeto de integração",
    "Vértice · Licenciamento anual",
    "Atlas · Operação enterprise",
    "Solare · Transformação digital",
    "Norte · Expansão da equipe",
    "Lume · Nova operação",
    "Orbe · Parceria comercial",
    "Conecta · Plano corporativo",
    "Prisma · Implantação CRM",
    "Arco · Operação nacional",
    "Viva · Consultoria",
    "Ponto · Plataforma",
    "Alvo · Serviços",
    "Íris · Expansão",
    "Fluxo · Automação",
  ];
  const deals: Deal[] = [];
  const history: HistoryEntry[] = [];
  let entryId = 1;
  names.forEach((title, i) => {
    const categoryId = i % 3 === 0 ? 3 : 0;
    const currentIndex = i === 0 ? 3 : i % 6;
    let time = now - (12 + i * 0.7) * 86400000;
    for (let j = 0; j <= currentIndex; j++) {
      if (j > 0) time += (0.6 + ((i + j) % 4) * 0.65) * 86400000;
      // Alguns negócios se movimentam nas últimas horas; outros ficam parados.
      if (j === currentIndex && i % 4 === 1) time = now - (i + 1) * 3600000;
      const stageId = categoryId ? `C3:${ids[j]}` : ids[j];
      history.push({
        ID: entryId++,
        OWNER_ID: 8061 + i,
        CATEGORY_ID: categoryId,
        STAGE_ID: stageId,
        STAGE_SEMANTIC_ID: j === 4 ? "S" : j === 5 ? "F" : "P",
        CREATED_TIME: new Date(time).toISOString(),
        MOVED_BY_NAME: ["Mariana Silva", "Pedro Santos", "Camila Oliveira"][
          i % 3
        ],
      });
    }
    const last = history.at(-1)!;
    deals.push({
      id: 8061 + i,
      title,
      categoryId,
      stageId: last.STAGE_ID,
      stageSemanticId: last.STAGE_SEMANTIC_ID,
      movedTime: last.CREATED_TIME,
    });
  });
  return { catalog, deals, history };
}
