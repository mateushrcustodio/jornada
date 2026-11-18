export type Period = "today" | "24h" | "7d" | "30d" | "custom";
export type View = "overview" | "movements" | "stalled" | "stages";
export interface Pipeline {
  id: number;
  name: string;
}
export interface Stage {
  id: string;
  name: string;
  categoryId: number;
  color: string;
  sort: number;
}
export interface HistoryEntry {
  ID: number;
  OWNER_ID: number;
  CATEGORY_ID: number;
  STAGE_ID: string;
  STAGE_SEMANTIC_ID: string;
  CREATED_TIME: string;
  // O histórico padrão não garante autoria. Não inferir a partir do responsável.
  MOVED_BY?: number;
  MOVED_BY_NAME?: string;
}
export interface Deal {
  id: number;
  title: string;
  categoryId: number;
  stageId: string;
  stageSemanticId?: string;
  movedTime?: string;
  movedBy?: number;
  // Pessoa responsável e valor (campo padrão "Valor" do negócio, OPPORTUNITY).
  assignedById?: number;
  assignedByName?: string;
  opportunity?: number;
  currencyId?: string;
}
export interface UserOption {
  id: number;
  name: string;
}
export interface Catalog {
  pipelines: Pipeline[];
  stages: Stage[];
}
export interface Settings {
  stalledHours: number;
  monitoredPipelines: number[];
  ignoredStages: string[];
  defaultPeriod: Exclude<Period, "custom">;
  indicators: {
    movements: boolean;
    active: boolean;
    stalled: boolean;
    average: boolean;
  };
}
// Situação dos negócios na aba Etapas: em andamento (aberto), finalizados
// (ganhos e perdidos) ou os dois. Sem o campo, vale o comportamento antigo
// (nenhum recorte por situação), que é o que a Visão geral continua usando.
export type StageStatus = "open" | "closed" | "all";
export interface Filters {
  from: string;
  to: string;
  pipeline?: number;
  stage?: string;
  stageStatus?: StageStatus;
  assignedById?: number;
  // Faixa do valor (faturamento) do negócio; o valor ausente conta como 0.
  opportunityMin?: number;
  opportunityMax?: number;
}
// Ordenação opcional das Movimentações: pelo faturamento do negócio ou pela
// data da movimentação ("when": desc = mais recentes primeiro, que é a ordem
// padrão; asc = mais antigas primeiro).
export type SortDirection = "asc" | "desc";
export interface MovementSort {
  by: "opportunity" | "when";
  dir: SortDirection;
}
// Ordenação opcional de Parados: pelo faturamento do negócio ou pelo tempo
// parado ("duration": desc = parados há mais tempo primeiro, que é a ordem
// padrão; asc = parados há menos tempo primeiro).
export interface StalledSort {
  by: "opportunity" | "duration";
  dir: SortDirection;
}
export interface Visit {
  entry: HistoryEntry;
  stage: Stage;
  duration: number;
  current: boolean;
  previousStage?: Stage;
  actor?: string;
}
export interface Movement extends Visit {
  deal: Deal;
  url?: string;
}
export interface StalledDeal {
  deal: Deal;
  stage: Stage;
  enteredAt: string;
  duration: number;
  url?: string;
  // Quem fez a última movimentação do negócio (coluna "Movido por").
  actor?: string;
}
export interface Retention {
  stage: Stage;
  pipeline: string;
  average: number;
  maximum: number;
  sampleDeals: number;
  visits: number;
  currentDeals: number;
  stalledDeals: number;
  // Etapa final (ganho/perda): o negócio fecha nela e não fica parado, então a
  // duração é sempre zero e só as contagens fazem sentido.
  final: boolean;
}
export interface DashboardData extends Catalog {
  movements: Movement[];
  stalled: StalledDeal[];
  retention: Retention[];
  activeCount: number;
  average: number;
  queriedAt: string;
  demo: boolean;
  warning?: string;
  partial?: boolean;
}
// Uma página das listas de Movimentações e Parados, buscada sob demanda.
export type PageKind = "movements" | "stalled";
export const PAGE_SIZE = 10;
export interface PageData<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  queriedAt: string;
  demo: boolean;
  warning?: string;
  partial?: boolean;
}
export interface JourneyData extends Catalog {
  deal: Deal;
  visits: Visit[];
  totalDuration: number;
  lastMovement?: string;
  queriedAt: string;
  demo: boolean;
  url?: string;
  warning?: string;
}
export interface RestResponse<T> {
  result: T;
  next?: number;
  total?: number;
  error?: string;
  error_description?: string;
}
export interface RawCategory {
  id: number;
  name: string;
}
export interface RawStatus {
  STATUS_ID: string;
  NAME: string;
  SORT: string | number;
  COLOR?: string;
  EXTRA?: { COLOR?: string };
}
