import type { StageStatus } from "./types";

// Tipo de etapa mostrado na aba Etapas:
// - open: só etapas em andamento, as normais do funil (padrão);
// - closed: só etapas de conclusão (ganho e perda, como "Primeira Op");
// - all: as duas.
export const STAGE_STATUSES: StageStatus[] = ["open", "closed", "all"];
export const DEFAULT_STAGE_STATUS: StageStatus = "open";

export const isStageStatus = (value: unknown): value is StageStatus =>
  value === "open" || value === "closed" || value === "all";

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  open: "Em andamento",
  closed: "Finalizados",
  all: "Em andamento + finalizados",
};
