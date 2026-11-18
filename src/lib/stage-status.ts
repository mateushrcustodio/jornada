import type { StageStatus } from "./types";

// Situação dos negócios analisados na aba Etapas:
// - open: só negócios em andamento (padrão);
// - closed: só finalizados (ganhos e perdidos);
// - all: em andamento e finalizados juntos.
export const STAGE_STATUSES: StageStatus[] = ["open", "closed", "all"];
export const DEFAULT_STAGE_STATUS: StageStatus = "open";

export const isStageStatus = (value: unknown): value is StageStatus =>
  value === "open" || value === "closed" || value === "all";

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  open: "Em andamento",
  closed: "Finalizados",
  all: "Em andamento + finalizados",
};
