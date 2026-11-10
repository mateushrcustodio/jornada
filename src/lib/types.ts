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
export interface Filters {
  from: string;
  to: string;
  pipeline?: number;
  stage?: string;
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
}
export interface DashboardData extends Catalog {
  movements: Movement[];
  stalled: StalledDeal[];
  retention: Retention[];
  activeCount: number;
  average: number;
  queriedAt: string;
  demo: boolean;
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
