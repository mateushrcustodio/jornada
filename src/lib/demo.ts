import type { Catalog, Deal, HistoryEntry, UserOption } from "./types";
// Responsáveis fictícios do modo demo (mesmos nomes de quem move os negócios).
export const DEMO_USERS: UserOption[] = [
  { id: 1, name: "Mariana Silva" },
  { id: 2, name: "Pedro Santos" },
  { id: 3, name: "Camila Oliveira" },
];
const DEMO_VALUES = [
  12500, 48000, 7300, 150000, 22000, 89900, 3500, 61000, 18200, 275000, 9400,
  36000, 5200, 120000, 27500, 14800, 72000, 41000,
];
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
      assignedById: DEMO_USERS[(i + 1) % 3].id,
      assignedByName: DEMO_USERS[(i + 1) % 3].name,
      opportunity: DEMO_VALUES[i % DEMO_VALUES.length],
      currencyId: "BRL",
    });
  });
  // Negócios já encerrados há meses (fora dos períodos do painel). Servem de
  // amostra para a autópsia e incluem desvios: etapa pulada e volta de etapa.
  // Cada passo é [índice da etapa, dias desde o passo anterior].
  const closed: [number, string, [number, number][]][] = [
    [
      9001,
      "Delta · Contrato anual",
      [
        [0, 0],
        [1, 2.5],
        [2, 6],
        [1, 4],
        [2, 3.5],
        [4, 2],
      ],
    ],
    [
      9002,
      "Ecos · Plano trimestral",
      [
        [0, 0],
        [1, 3],
        [2, 9],
        [3, 8],
        [4, 2],
      ],
    ],
    [
      9003,
      "Faro · Pacote básico",
      [
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 2],
        [4, 1],
      ],
    ],
    [
      9004,
      "Gaia · Renovação",
      [
        [0, 0],
        [1, 4],
        [5, 3],
      ],
    ],
    [
      9005,
      "Haste · Consultoria",
      [
        [0, 0],
        [5, 6],
      ],
    ],
    [
      9006,
      "Ibis · Licenças",
      [
        [0, 0],
        [1, 2],
        [2, 7],
        [5, 4],
      ],
    ],
  ];
  closed.forEach(([id, title, steps], index) => {
    let time = now - (100 + index * 12) * 86400000;
    steps.forEach(([stage, days], j) => {
      time += days * 86400000;
      history.push({
        ID: entryId++,
        OWNER_ID: id,
        CATEGORY_ID: 0,
        STAGE_ID: ids[stage],
        STAGE_SEMANTIC_ID: stage === 4 ? "S" : stage === 5 ? "F" : "P",
        CREATED_TIME: new Date(time).toISOString(),
        MOVED_BY_NAME: ["Mariana Silva", "Pedro Santos", "Camila Oliveira"][
          (index + j) % 3
        ],
      });
    });
    const last = history.at(-1)!;
    deals.push({
      id,
      title,
      categoryId: 0,
      stageId: last.STAGE_ID,
      stageSemanticId: last.STAGE_SEMANTIC_ID,
      movedTime: last.CREATED_TIME,
      assignedById: DEMO_USERS[index % 3].id,
      assignedByName: DEMO_USERS[index % 3].name,
      opportunity: DEMO_VALUES[(index * 5 + 2) % DEMO_VALUES.length],
      currencyId: "BRL",
    });
  });
  return { catalog, deals, history };
}
