"use client";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  GripVertical,
  Layers3,
  Pause,
  RefreshCw,
  Route,
  Settings2,
  Timer,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type {
  DashboardData,
  Catalog,
  Deal,
  Filters,
  Movement,
  MovementSort,
  PageData,
  Period,
  Pipeline,
  Retention,
  SortDirection,
  StalledDeal,
  StalledSort,
  UserOption,
  View,
} from "@/lib/types";
import { PAGE_SIZE } from "@/lib/types";
import { sortRetention, sortRetentionByMaximum } from "@/lib/stage-order";
import {
  dateTime,
  duration,
  money,
  parseMoney,
  periodRange,
} from "@/lib/format";
import { useColumnDrag } from "./column-drag";
import { useColumnOrder } from "./column-order";
import { useApp } from "./provider";
import { StageOrderToggle, useStageOrder } from "./stage-order";
import { StageStatusToggle, useStageStatus } from "./stage-status";
import { StageTimePanel } from "./stage-time-chart";
import { useResource } from "./use-resource";
import {
  DealLink,
  Empty,
  ErrorState,
  Pagination,
  Panel,
  Skeleton,
  StageBadge,
} from "./ui";

const titles = {
  overview: "Jornada",
  movements: "Movimentações",
  stalled: "Negócios parados",
  stages: "Etapas",
};
const subtitles = {
  overview: "Acompanhe a movimentação dos seus negócios.",
  movements: "Veja as mudanças de etapa mais recentes.",
  stalled: "Negócios que ficaram tempo demais na mesma etapa.",
  stages: "Onde o tempo se concentra no seu funil.",
};

// Filtros e consulta sobrevivem à troca de aba do painel (cada aba remonta
// este componente). Depois de 5 minutos a consulta volta a ser buscada.
const DASHBOARD_CACHE_MS = 5 * 60000;
const NO_USERS: UserOption[] = [];
const sticky: Record<string, unknown> = {};
function useSticky<T>(key: string, initial: () => T) {
  const [value, setValue] = useState<T>(() =>
    key in sticky ? (sticky[key] as T) : initial(),
  );
  function update(next: T) {
    sticky[key] = next;
    setValue(next);
  }
  return [value, update] as const;
}

export function Dashboard({ view }: { view: View }) {
  const { settings, ready, demo } = useApp();
  const catalogResource = useResource<Catalog>(
    "/api/catalog",
    undefined,
    ready,
    DASHBOARD_CACHE_MS,
  );
  const catalog = catalogResource.data;
  const [requested, setRequested] = useSticky("requested", () => demo);
  const [period, setPeriod] = useSticky<Period | undefined>(
    "period",
    () => undefined,
  );
  const [pipeline, setPipeline] = useSticky("pipeline", () => "");
  const [stage, setStage] = useSticky("stage", () => "");
  const [assigned, setAssigned] = useSticky("assigned", () => "");
  const [oppMin, setOppMin] = useSticky("oppMin", () => "");
  const [oppMax, setOppMax] = useSticky("oppMax", () => "");
  // Ordenação das Movimentações (faturamento ou data): sem clique, vale a ordem
  // por data, da mais recente para a mais antiga.
  const [sort, setSort] = useSticky<MovementSort | undefined>(
    "sort",
    () => undefined,
  );
  // Ordenação de Parados (faturamento ou tempo parado): sem clique, vale a ordem
  // padrão, do mais para o menos tempo parado.
  const [stalledSort, setStalledSort] = useSticky<StalledSort | undefined>(
    "stalledSort",
    () => undefined,
  );
  // Situação dos negócios da aba Etapas (em andamento por padrão; a escolha fica
  // salva neste navegador). Só vai ao servidor na aba Etapas.
  const [stageStatus, setStageStatus] = useStageStatus();
  const [from, setFrom] = useSticky("from", () => "");
  const [to, setTo] = useSticky("to", () => "");
  const usersResource = useResource<UserOption[]>(
    "/api/users",
    undefined,
    ready,
    DASHBOARD_CACHE_MS,
  );
  const users = usersResource.data ?? NO_USERS;
  const minValue = parseMoney(oppMin);
  const maxValue = parseMoney(oppMax);
  const rangeError =
    minValue === null || maxValue === null
      ? "Digite o faturamento só com números, por exemplo 10000 ou 10.000,50."
      : minValue !== undefined && maxValue !== undefined && minValue > maxValue
        ? "O faturamento mínimo não pode ser maior que o máximo."
        : undefined;
  const effectivePeriod = period ?? settings.defaultPeriod;
  const validCustom =
    effectivePeriod !== "custom" ||
    (!!from &&
      !!to &&
      from <= to &&
      Date.parse(to) - Date.parse(from) <= 365 * 86400000);
  // Uma faixa estável por seleção; o relógio é atualizado no clique em Atualizar.
  const [clock, setClockState] = useState(() => {
    const saved = sticky.clock as number | undefined;
    const now = Date.now();
    return saved && now - saved < DASHBOARD_CACHE_MS ? saved : now;
  });
  function setClock(value: number) {
    sticky.clock = value;
    setClockState(value);
  }
  const range = validCustom
    ? periodRange(effectivePeriod, new Date(clock), from, to)
    : undefined;
  const filters: Filters | undefined = range
    ? {
        ...range,
        pipeline: pipeline ? Number(pipeline) : undefined,
        stage: stage || undefined,
        stageStatus: view === "stages" ? stageStatus : undefined,
        assignedById: assigned ? Number(assigned) : undefined,
        opportunityMin: minValue ?? undefined,
        opportunityMax: maxValue ?? undefined,
      }
    : undefined;
  const body = JSON.stringify({ filters, settings });
  // Movimentações e Parados só buscam o total e a página aberta; a visão geral
  // e as etapas precisam de todos os dados para calcular médias e contagens.
  const paged = view === "movements" || view === "stalled";
  const canQuery = ready && validCustom && !rangeError && requested;
  // "Quando" da mais recente para a mais antiga já é a ordem padrão do servidor.
  const sortBody: MovementSort | undefined =
    view === "movements" && sort && !(sort.by === "when" && sort.dir === "desc")
      ? sort
      : undefined;
  // "Tempo parado" já aparece do maior para o menor; não precisa ir ao servidor.
  const stalledSortBody: StalledSort | undefined =
    view === "stalled" &&
    stalledSort &&
    !(stalledSort.by === "duration" && stalledSort.dir === "desc")
      ? stalledSort
      : undefined;
  function toggleSort(by: SortKey) {
    // Faturamento começa do maior para o menor; "Quando" e "Tempo parado" já
    // aparecem do mais recente / maior para o menor, então o primeiro clique
    // inverte. Depois disso cada clique alterna o sentido.
    const current: SortDirection | "" =
      sort?.by === by ? sort.dir : DEFAULT_DESC.has(by) ? "desc" : "";
    setSort({
      by: by as MovementSort["by"],
      dir: current === "desc" ? "asc" : "desc",
    });
  }
  function toggleStalledSort(by: SortKey) {
    const current: SortDirection | "" =
      stalledSort?.by === by
        ? stalledSort.dir
        : DEFAULT_DESC.has(by)
          ? "desc"
          : "";
    setStalledSort({
      by: by as StalledSort["by"],
      dir: current === "desc" ? "asc" : "desc",
    });
  }
  const resource = useResource<DashboardData>(
    "/api/dashboard",
    body,
    canQuery && !paged,
    DASHBOARD_CACHE_MS,
  );
  const data = resource.data;
  // A página volta para a primeira ao mudar de aba, filtro, configuração ou
  // ao atualizar; a assinatura evita um efeito só para zerar o contador.
  const pageSignature = `${view}\n${body}\n${clock}\n${sort?.by}:${sort?.dir}\n${stalledSort?.by}:${stalledSort?.dir}`;
  const [pageState, setPageState] = useState({ signature: "", page: 1 });
  const page = pageState.signature === pageSignature ? pageState.page : 1;
  const pageResource = useResource<PageData<Movement> | PageData<StalledDeal>>(
    "/api/dashboard/page",
    JSON.stringify({
      filters,
      settings,
      kind: view,
      page,
      asOf: clock,
      sort: view === "movements" ? sortBody : undefined,
      stalledSort: stalledSortBody,
    }),
    canQuery && paged,
    DASHBOARD_CACHE_MS,
  );
  const active = paged ? pageResource : resource;
  const queriedAt = paged ? pageResource.data?.queriedAt : data?.queriedAt;
  const paging = (rows: PageData<Movement | StalledDeal>): Paging => ({
    total: rows.total,
    page: rows.page,
    size: rows.pageSize || PAGE_SIZE,
    busy: pageResource.loading,
    onChange: (next) => setPageState({ signature: pageSignature, page: next }),
  });
  function refresh() {
    setRequested(true);
    setClock(Date.now());
    active.refresh();
  }
  const hasFilters =
    !!pipeline ||
    !!stage ||
    !!assigned ||
    !!oppMin ||
    !!oppMax ||
    (view === "movements" ? !!sort : view === "stalled" && !!stalledSort) ||
    effectivePeriod !== settings.defaultPeriod;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{titles[view]}</h1>
          <p>{subtitles[view]}</p>
        </div>
        <div className="heading-actions">
          <span className="last-query">
            {queriedAt && !active.loading && !active.error
              ? `Consulta: ${dateTime(queriedAt)}`
              : requested && active.loading
                ? "Consultando dados…"
                : ""}
          </span>
          <button
            className="button primary"
            onClick={refresh}
            disabled={
              (requested && active.loading) ||
              !validCustom ||
              !!rangeError ||
              !catalog
            }
          >
            <RefreshCw
              size={16}
              className={requested && active.loading ? "spin" : ""}
            />
            {requested ? "Atualizar" : "Consultar dados"}
          </button>
        </div>
      </div>
      <div className="filters">
        <label className="filter">
          <CalendarDays size={16} />
          <span className="sr-only">Período</span>
          <select
            aria-label="Período"
            value={effectivePeriod}
            onChange={(e) => {
              setPeriod(e.target.value as Period);
              setClock(Date.now());
            }}
          >
            <option value="today">Hoje</option>
            <option value="24h">Últimas 24 horas</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="custom">Personalizado</option>
          </select>
        </label>
        <label className="filter">
          <span className="sr-only">Pipeline</span>
          <select
            aria-label="Pipeline"
            value={pipeline}
            onChange={(e) => {
              setPipeline(e.target.value);
              setStage("");
            }}
          >
            <option value="">Todos os pipelines</option>
            {catalog?.pipelines
              .filter(
                (p) =>
                  !settings.monitoredPipelines.length ||
                  settings.monitoredPipelines.includes(p.id),
              )
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label className="filter">
          <span className="sr-only">Etapa</span>
          <select
            aria-label="Etapa"
            value={stage}
            disabled={!pipeline}
            onChange={(e) => setStage(e.target.value)}
          >
            <option value="">Todas as etapas</option>
            {catalog?.stages
              .filter(
                (s) =>
                  (!pipeline || s.categoryId === Number(pipeline)) &&
                  (!settings.monitoredPipelines.length ||
                    settings.monitoredPipelines.includes(s.categoryId)),
              )
              .map((s) => (
                <option key={`${s.categoryId}:${s.id}`} value={s.id}>
                  {s.name}
                  {!pipeline
                    ? ` · ${catalog?.pipelines.find((p) => p.id === s.categoryId)?.name}`
                    : ""}
                </option>
              ))}
          </select>
        </label>
        <label className="filter">
          <UserRound size={16} />
          <span className="sr-only">Responsável</span>
          <select
            aria-label="Responsável"
            value={assigned}
            disabled={!users.length && !assigned}
            onChange={(e) => setAssigned(e.target.value)}
          >
            <option value="">
              {usersResource.loading
                ? "Carregando pessoas…"
                : !users.length
                  ? "Responsáveis indisponíveis"
                  : "Todos os responsáveis"}
            </option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
            {assigned &&
              !users.some((user) => String(user.id) === assigned) && (
                <option value={assigned}>Usuário #{assigned}</option>
              )}
          </select>
        </label>
        <RevenueFilter
          min={oppMin}
          max={oppMax}
          invalid={!!rangeError}
          onChange={(nextMin, nextMax) => {
            setOppMin(nextMin);
            setOppMax(nextMax);
          }}
        />
        {hasFilters && (
          <button
            className="text-button"
            onClick={() => {
              setPipeline("");
              setStage("");
              setAssigned("");
              setOppMin("");
              setOppMax("");
              setSort(undefined);
              setStalledSort(undefined);
              setPeriod(settings.defaultPeriod);
              setFrom("");
              setTo("");
            }}
          >
            Limpar
            <X size={14} />
          </button>
        )}
      </div>
      {effectivePeriod === "custom" && (
        <div className="custom-period">
          <label>
            De
            <input
              type="date"
              aria-label="Data inicial"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <ArrowRight size={16} />
          <label>
            Até
            <input
              type="date"
              aria-label="Data final"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <span>Até 366 dias · horário de Brasília</span>
        </div>
      )}
      {settings.monitoredPipelines.length > 0 && (
        <p className="context-note">
          <Settings2 size={13} />A consulta considera os pipelines monitorados
          nas configurações.
        </p>
      )}
      {rangeError ? (
        <div className="dashboard-body">
          <Empty title="Revise o faturamento" description={rangeError} />
        </div>
      ) : !validCustom ? (
        <div className="dashboard-body">
          <Empty
            title="Escolha um período"
            description="Selecione as datas inicial e final, em ordem, com intervalo de até 366 dias."
          />
        </div>
      ) : !ready || catalogResource.loading ? (
        <Skeleton />
      ) : catalogResource.error ? (
        <div className="dashboard-body">
          <ErrorState
            message={catalogResource.error}
            code={catalogResource.code}
            retry={catalogResource.refresh}
          />
        </div>
      ) : !requested ? (
        <div className="dashboard-body">
          <Empty
            title="Escolha os filtros antes de consultar"
            description="Os pipelines e etapas já foram carregados. Selecione os filtros desejados e clique em Consultar dados para buscar o histórico real."
            action={
              <button
                className="button primary"
                onClick={refresh}
                disabled={!validCustom || !catalog}
              >
                Consultar dados
              </button>
            }
          />
        </div>
      ) : paged ? (
        pageResource.error ? (
          <div className="dashboard-body">
            <ErrorState
              message={pageResource.error}
              code={pageResource.code}
              retry={refresh}
            />
          </div>
        ) : !pageResource.data ? (
          <Skeleton />
        ) : (
          <div className="dashboard-body">
            {pageResource.data.warning && (
              <div className="info-banner" role="status">
                <Clock3 size={18} />
                <span>{pageResource.data.warning}</span>
              </div>
            )}
            {view === "movements" && (
              <Movements
                rows={(pageResource.data as PageData<Movement>).rows}
                pipelines={catalog?.pipelines ?? []}
                paging={paging(pageResource.data)}
                sorting={{ active: sort, onToggle: toggleSort }}
              />
            )}
            {view === "stalled" && (
              <>
                <div className="info-banner">
                  <Clock3 size={18} />
                  <span>
                    <strong>
                      Limite de {settings.stalledHours} horas na etapa atual.
                    </strong>{" "}
                    Inclui negócios ativos sem movimentações no período
                    selecionado.
                  </span>
                  <Link href="/settings">
                    Ajustar limite
                    <ArrowUpRight size={14} />
                  </Link>
                </div>
                <Stalled
                  rows={(pageResource.data as PageData<StalledDeal>).rows}
                  pipelines={catalog?.pipelines ?? []}
                  hours={settings.stalledHours}
                  paging={paging(pageResource.data)}
                  sorting={{ active: stalledSort, onToggle: toggleStalledSort }}
                />
              </>
            )}
          </div>
        )
      ) : resource.loading ? (
        <Skeleton />
      ) : resource.error ? (
        <div className="dashboard-body">
          <ErrorState
            message={resource.error}
            code={resource.code}
            retry={refresh}
          />
        </div>
      ) : data ? (
        <div className="dashboard-body">
          {data.warning && (
            <div className="info-banner" role="status">
              <Clock3 size={18} />
              <span>{data.warning}</span>
            </div>
          )}
          {view === "overview" && (
            <>
              <Metrics data={data} />
              <div className="split">
                <div className="stack">
                  <Movements
                    rows={data.movements}
                    pipelines={data.pipelines}
                    compact
                  />
                  <TrackedDeals data={data} />
                </div>
                <div className="stack">
                  <RetentionChart rows={data.retention} />
                  <Stalled
                    rows={data.stalled}
                    pipelines={data.pipelines}
                    compact
                    hours={settings.stalledHours}
                  />
                </div>
              </div>
            </>
          )}
          {view === "stages" && (
            <>
              <div className="stage-status-bar">
                <span className="muted">Negócios analisados</span>
                <StageStatusToggle
                  status={stageStatus}
                  onChange={setStageStatus}
                />
              </div>
              <div className="split">
                <RetentionChart
                  rows={data.retention}
                  pipelines={data.pipelines}
                  full
                />
                <div className="stack">
                  <Panel title="Como ler os tempos">
                    <div className="analysis-explainer">
                      <p>
                        A média considera passagens com entrada no período. Cada
                        passagem termina na próxima movimentação; uma etapa
                        aberta vai até a consulta.
                      </p>
                      <p>
                        Os contadores de negócios e parados representam a
                        posição atual, inclusive sem movimentações recentes.
                        Etapas concluídas de ganho ou perda têm duração final
                        zero e aparecem sem tempo (traço), só com as contagens.
                      </p>
                      <p>
                        O seletor &quot;Negócios analisados&quot; escolhe entre
                        os em andamento (padrão), os finalizados (ganhos e
                        perdidos) ou os dois juntos.
                      </p>
                      <p>Cada pipeline é calculado separadamente.</p>
                    </div>
                  </Panel>
                  <StageTimePanel
                    data={data}
                    users={users}
                    stalledHours={settings.stalledHours}
                  />
                </div>
              </div>
              <RetentionTable
                rows={data.retention}
                pipelines={data.pipelines}
              />
            </>
          )}
        </div>
      ) : null}
    </>
  );
}

function TrackedDeals({ data }: { data: DashboardData }) {
  const unique = new Map<
    number,
    { deal: Deal; stageName: string; pipeline: string; movedTime?: string }
  >();
  const add = (deal: Deal, stageName: string) =>
    unique.set(deal.id, {
      deal,
      stageName,
      pipeline:
        data.pipelines.find((pipeline) => pipeline.id === deal.categoryId)
          ?.name || "Pipeline não informado",
      movedTime: deal.movedTime,
    });
  data.movements.forEach((row) => add(row.deal, row.stage.name));
  data.stalled.forEach((row) => add(row.deal, row.stage.name));
  const rows = [...unique.values()]
    .sort(
      (a, b) => Date.parse(b.movedTime || "") - Date.parse(a.movedTime || ""),
    )
    .slice(0, 5);
  return (
    <Panel
      title="Negócios acompanhados"
      action={<span className="count-badge">{data.activeCount} ativos</span>}
      className="tracked-deals-panel"
    >
      {!rows.length ? (
        <Empty
          title="Nenhum negócio encontrado"
          description="A consulta não retornou negócios para os filtros selecionados."
        />
      ) : (
        <div className="tracked-deals-list">
          {rows.map((row) => (
            <Link
              href={`/deal/${row.deal.id}/journey?source=dashboard`}
              className="tracked-deal-row"
              key={row.deal.id}
            >
              <span className="tracked-deal-main">
                <strong>{row.deal.title}</strong>
                <small>
                  #{row.deal.id} · {row.pipeline}
                </small>
              </span>
              <span className="tracked-deal-stage">
                <span>{row.stageName}</span>
                <small>
                  {row.movedTime
                    ? dateTime(row.movedTime)
                    : "Data não informada"}
                </small>
              </span>
              <ArrowUpRight size={16} className="tracked-deal-arrow" />
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Metrics({ data }: { data: DashboardData }) {
  const { settings } = useApp();
  const metrics = [
    {
      key: "movements" as const,
      label: "Movimentações",
      value: data.movements.length.toLocaleString("pt-BR"),
      detail: "registradas no período",
      icon: Route,
      color: "blue",
    },
    {
      key: "active" as const,
      label: "Negócios em andamento",
      value: data.activeCount.toLocaleString("pt-BR"),
      detail: "ativos nos filtros",
      icon: Layers3,
      color: "ink",
    },
    {
      key: "stalled" as const,
      label: "Parados",
      value: data.stalled.length.toLocaleString("pt-BR"),
      detail: `há ${settings.stalledHours}h ou mais na etapa`,
      icon: Pause,
      color: "amber",
    },
    {
      key: "average" as const,
      label: "Tempo médio por etapa",
      value: duration(data.average),
      detail: data.movements.length
        ? "por passagem no período"
        : "sem passagens no período",
      icon: Timer,
      color: "ink",
    },
  ];
  return (
    <div className="stat-grid">
      {metrics
        .filter((m) => settings.indicators[m.key])
        .map(({ key, label, value, detail, color }) => (
          <article className={`stat-card stat-${color}`} key={key}>
            <div className="stat-top">{label}</div>
            <strong className="stat-value">{value}</strong>
            <span className="stat-detail">{detail}</span>
          </article>
        ))}
    </div>
  );
}

function RetentionChart({
  rows,
  pipelines = [],
  full = false,
}: {
  rows: Retention[];
  pipelines?: Pipeline[];
  full?: boolean;
}) {
  const [order, setOrder] = useStageOrder();
  // Na visão geral só aparecem as 4 etapas mais lentas (ordem fixa); a ordem
  // escolhida vale na aba Etapas, que lista todas.
  const visible = full
    ? sortRetention(rows, order, pipelines)
    : rows.slice(0, 4);
  const max = Math.max(1, ...visible.map((r) => r.average));
  return (
    <Panel
      title="Tempo médio por etapa"
      action={
        full ? (
          rows.length > 1 && (
            <StageOrderToggle order={order} onChange={setOrder} />
          )
        ) : (
          <Link
            href="/dashboard/stages"
            className="icon-button"
            aria-label="Ver análise de etapas"
          >
            <ArrowUpRight size={18} />
          </Link>
        )
      }
      className="retention-panel"
    >
      {!rows.length ? (
        <Empty
          title="Sem etapas para analisar"
          description="Altere os filtros para encontrar passagens por etapas."
        />
      ) : (
        <div className="retention-bars">
          {visible.map((r) => (
            <div
              className="retention-row"
              key={`${r.stage.categoryId}:${r.stage.id}`}
            >
              <div className="retention-label">
                <div>
                  <strong>{r.stage.name}</strong>
                  <span>
                    {r.pipeline} · {r.sampleDeals} negócios
                  </span>
                </div>
                <strong className="retention-value">
                  {!r.visits
                    ? "Sem passagens"
                    : r.final
                      ? "—"
                      : duration(r.average)}
                </strong>
              </div>
              <div className="bar-track">
                <span style={{ width: `${(r.average / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// Paginação controlada: o painel busca só a página atual e o total.
interface Paging {
  total: number;
  page: number;
  size: number;
  busy: boolean;
  onChange: (page: number) => void;
}

// Filtro de faturamento (valor do negócio): faixa com mínimo e máximo. O texto
// só vira filtro depois de uma pausa na digitação, para não consultar o
// Bitrix24 a cada tecla.
function RevenueFilter({
  min,
  max,
  invalid,
  onChange,
}: {
  min: string;
  max: string;
  invalid: boolean;
  onChange: (min: string, max: string) => void;
}) {
  const [text, setText] = useState({ min, max });
  // "Limpar" (ou outra aba) muda os valores de fora: o texto acompanha.
  useEffect(() => {
    queueMicrotask(() =>
      setText((current) =>
        current.min === min && current.max === max ? current : { min, max },
      ),
    );
  }, [min, max]);
  useEffect(() => {
    if (text.min === min && text.max === max) return;
    const timer = setTimeout(() => onChange(text.min, text.max), 600);
    return () => clearTimeout(timer);
  }, [text, min, max, onChange]);
  const commit = () => onChange(text.min, text.max);
  const field = (key: "min" | "max", label: string, placeholder: string) => (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      aria-label={label}
      aria-invalid={invalid || undefined}
      placeholder={placeholder}
      value={text[key]}
      onChange={(e) => setText({ ...text, [key]: e.target.value })}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
  return (
    <div
      className={`filter filter-range ${invalid ? "is-invalid" : ""}`}
      role="group"
      aria-label="Faturamento"
    >
      <CircleDollarSign size={16} />
      <span>Faturamento</span>
      {field("min", "Faturamento mínimo", "Mín. R$")}
      <span aria-hidden>–</span>
      {field("max", "Faturamento máximo", "Máx. R$")}
    </div>
  );
}

// Colunas das tabelas de Movimentações e Parados. A ordem padrão é a do array;
// o usuário pode arrastar os títulos para reorganizar (a ordem de cada tabela
// fica salva no navegador).
type MovementColumn =
  "deal" | "pipeline" | "movement" | "when" | "actor" | "assignee" | "revenue";
const MOVEMENT_COLUMNS: readonly MovementColumn[] = [
  "deal",
  "pipeline",
  "movement",
  "when",
  "actor",
  "assignee",
  "revenue",
];
const MOVEMENT_LABELS: Record<MovementColumn, string> = {
  deal: "Negócio",
  pipeline: "Pipeline",
  movement: "Movimentação",
  when: "Quando",
  actor: "Movido por",
  assignee: "Pessoa responsável",
  revenue: "Faturamento",
};
const MOVEMENT_ORDER_KEY = "jornada-crm.movement-columns.v1";

// Parados tem as mesmas colunas, sem "Quando": "Etapa atual" ocupa o lugar de
// "Movimentação" e "Tempo parado" vem logo depois dela.
type StalledColumn =
  "deal" | "pipeline" | "stage" | "duration" | "actor" | "assignee" | "revenue";
const STALLED_COLUMNS: readonly StalledColumn[] = [
  "deal",
  "pipeline",
  "stage",
  "duration",
  "actor",
  "assignee",
  "revenue",
];
const STALLED_LABELS: Record<StalledColumn, string> = {
  deal: "Negócio",
  pipeline: "Pipeline",
  stage: "Etapa atual",
  duration: "Tempo parado",
  actor: "Movido por",
  assignee: "Pessoa responsável",
  revenue: "Faturamento",
};
const STALLED_ORDER_KEY = "jornada-crm.stalled-columns.v1";

// Colunas que têm seta de ordenação: Movimentações (faturamento, quando),
// Parados (faturamento, tempo parado) e Detalhamento por etapa (tempo médio,
// maior tempo).
type SortKey = MovementSort["by"] | StalledSort["by"] | "average" | "maximum";
interface Sorting {
  active?: { by: SortKey; dir: SortDirection };
  onToggle: (by: SortKey) => void;
}
// Ordens que já são o padrão da lista: o primeiro clique inverte para crescente.
const DEFAULT_DESC: ReadonlySet<SortKey> = new Set<SortKey>([
  "when",
  "duration",
]);
// Textos das setas de ordenação. `first` é o sentido do primeiro clique.
const SORT_TEXT: Record<
  SortKey,
  { desc: string; asc: string; first: SortDirection }
> = {
  opportunity: {
    desc: "do maior para o menor",
    asc: "do menor para o maior",
    first: "desc",
  },
  when: {
    desc: "da mais recente para a mais antiga",
    asc: "da mais antiga para a mais recente",
    first: "asc",
  },
  duration: {
    desc: "do maior para o menor tempo parado",
    asc: "do menor para o maior tempo parado",
    first: "asc",
  },
  average: {
    desc: "do maior para o menor tempo médio",
    asc: "do menor para o maior tempo médio",
    first: "desc",
  },
  maximum: {
    desc: "do maior para o menor tempo",
    asc: "do menor para o maior tempo",
    first: "desc",
  },
};
// Colunas de Movimentações que têm seta de ordenação.
const MOVEMENT_SORT_KEYS: Partial<Record<MovementColumn, SortKey>> = {
  when: "when",
  revenue: "opportunity",
};

// Colunas de Parados que têm seta de ordenação.
const STALLED_SORT_KEYS: Partial<Record<StalledColumn, SortKey>> = {
  duration: "duration",
  revenue: "opportunity",
};

// Colunas da tabela "Detalhamento por etapa" (aba Etapas), também arrastáveis.
type StageColumn =
  "stage" | "average" | "maximum" | "sample" | "current" | "stalled";
const STAGE_COLUMNS: readonly StageColumn[] = [
  "stage",
  "average",
  "maximum",
  "sample",
  "current",
  "stalled",
];
const STAGE_LABELS: Record<StageColumn, string> = {
  stage: "Etapa / pipeline",
  average: "Tempo médio",
  maximum: "Maior tempo",
  sample: "Negócios na amostra",
  current: "Atuais",
  stalled: "Acima do limite",
};
const STAGE_ORDER_KEY = "jornada-crm.stage-columns.v1";
const STAGE_SORT_KEYS: Partial<Record<StageColumn, SortKey>> = {
  average: "average",
  maximum: "maximum",
};

const assigneeLabel = (deal: Deal) =>
  deal.assignedByName ||
  (deal.assignedById ? `Usuário #${deal.assignedById}` : "Não informado");
const revenueCell = (deal: Deal) => (
  <strong className="money">{money(deal.opportunity, deal.currencyId)}</strong>
);
const pipelineLabel = (pipelines: Pipeline[], id: number) =>
  pipelines.find((p) => p.id === id)?.name || `Pipeline #${id}`;

// Tabela com colunas arrastáveis (mouse, toque ou setas ← → na alça da coluna) e,
// nas colunas indicadas em `sortKeys`, uma seta que ordena todas as páginas.
function ReorderableTable<K extends string, R>({
  columns,
  labels,
  cells,
  cellClass,
  sortKeys,
  sorting,
  rows,
  rowKey,
  busy,
}: {
  columns: { order: K[]; move: (from: K, to: K) => void };
  labels: Record<K, string>;
  cells: Record<K, (row: R) => React.ReactNode>;
  cellClass: Partial<Record<K, string>>;
  sortKeys?: Partial<Record<K, SortKey>>;
  sorting?: Sorting;
  rows: R[];
  rowKey: (row: R) => string | number;
  busy?: boolean;
}) {
  const {
    tableRef,
    drag,
    startDrag,
    moveDrag,
    endDrag,
    cancelDrag,
    dragProps,
    keyboardMove,
  } = useColumnDrag(columns);
  return (
    <div className={`table-scroll ${busy ? "is-busy" : ""}`}>
      <table ref={tableRef} className={drag ? "is-reordering" : undefined}>
        <thead>
          <tr>
            {columns.order.map((key, index) => {
              const label = labels[key];
              const sortKey = sorting ? sortKeys?.[key] : undefined;
              const dir: SortDirection | "" =
                sortKey && sorting?.active?.by === sortKey
                  ? sorting.active.dir
                  : "";
              const text = sortKey && SORT_TEXT[sortKey];
              const moving = dragProps(key, index);
              return (
                <th
                  key={key}
                  data-column={key}
                  className={`${moving.className} ${cellClass[key] === "num-cell" ? "num-cell" : ""}`}
                  style={moving.style}
                  onPointerDown={(e) => startDrag(e, key)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={cancelDrag}
                  aria-sort={
                    sortKey
                      ? dir === "desc"
                        ? "descending"
                        : dir === "asc"
                          ? "ascending"
                          : "none"
                      : undefined
                  }
                >
                  <div className="th-inner">
                    <button
                      type="button"
                      className="col-grip"
                      aria-label={`Mover coluna ${label}`}
                      title="Arraste para reordenar (ou use as setas ← →)"
                      data-index={index}
                      onKeyDown={(e) => keyboardMove(e, key)}
                    >
                      <GripVertical size={14} />
                    </button>
                    <span>{label}</span>
                    {sortKey && text && sorting && (
                      <button
                        type="button"
                        className={`sort-button ${dir ? "is-active" : ""}`}
                        onClick={() => sorting.onToggle(sortKey)}
                        aria-label={
                          dir
                            ? `${label} ${text[dir]}. Clique para inverter.`
                            : `Ordenar por ${label.toLowerCase()}, ${text[text.first]}`
                        }
                        title={text[dir || text.first]}
                      >
                        {dir === "desc" ? (
                          <ArrowDown size={14} />
                        ) : dir === "asc" ? (
                          <ArrowUp size={14} />
                        ) : (
                          <ArrowUpDown size={14} />
                        )}
                      </button>
                    )}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.order.map((key, index) => {
                const moving = dragProps(key, index);
                return (
                  <td
                    key={key}
                    data-column={key}
                    className={`${cellClass[key] ?? ""} ${moving.className}`}
                    style={moving.style}
                  >
                    {cells[key](row)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Movements({
  rows,
  pipelines,
  compact = false,
  paging,
  sorting,
}: {
  rows: Movement[];
  pipelines: Pipeline[];
  compact?: boolean;
  paging?: Paging;
  sorting?: Sorting;
}) {
  const [requestedPage, setLocalPage] = useState(1);
  const columns = useColumnOrder(MOVEMENT_ORDER_KEY, MOVEMENT_COLUMNS);
  // Com `paging`, as linhas já são só as da página atual (buscadas sob demanda).
  const size = paging ? paging.size : compact ? 5 : 10;
  const total = paging ? paging.total : rows.length;
  const page = paging
    ? paging.page
    : Math.min(requestedPage, Math.max(1, Math.ceil(rows.length / size)));
  const visible = paging ? rows : rows.slice((page - 1) * size, page * size);
  const setPage = paging ? paging.onChange : setLocalPage;
  const customOrder =
    columns.order.join() !== MOVEMENT_COLUMNS.join()
      ? columns.reset
      : undefined;

  const cell: Record<MovementColumn, (row: Movement) => React.ReactNode> = {
    deal: (row) => (
      <DealLink id={row.deal.id} title={row.deal.title} url={row.url} />
    ),
    pipeline: (row) => (
      <span className="pipeline-label">
        {pipelineLabel(pipelines, row.entry.CATEGORY_ID)}
      </span>
    ),
    movement: (row) => (
      <div className="movement-stages">
        {row.previousStage ? (
          <>
            <StageBadge stage={row.previousStage} />
            <ArrowRight size={12} />
          </>
        ) : (
          <span>Primeira entrada</span>
        )}
        <StageBadge stage={row.stage} />
      </div>
    ),
    when: (row) => (
      <time dateTime={row.entry.CREATED_TIME}>
        {dateTime(row.entry.CREATED_TIME)}
      </time>
    ),
    actor: (row) => row.actor || "Não informado pela API",
    assignee: (row) => assigneeLabel(row.deal),
    revenue: (row) => revenueCell(row.deal),
  };
  const cellClass: Partial<Record<MovementColumn, string>> = {
    when: "date-cell",
    actor: "actor-cell",
    assignee: "actor-cell",
    revenue: "num-cell",
  };
  return (
    <Panel
      title="Últimas movimentações"
      className="movements-panel"
      action={
        compact ? (
          <Link className="text-link" href="/dashboard/movements">
            Ver todas
            <ArrowRight size={14} />
          </Link>
        ) : (
          <span className="panel-actions">
            {customOrder && (
              <button className="text-button" onClick={customOrder}>
                Restaurar colunas
              </button>
            )}
            <span className="count-badge">{total} registros</span>
          </span>
        )
      }
    >
      {!total ? (
        <Empty />
      ) : compact ? (
        <div className="movement-list">
          {visible.map((row) => (
            <div className="movement-row" key={row.entry.ID}>
              <div className="row-main">
                <strong>
                  <Link href={`/deal/${row.deal.id}/journey?source=dashboard`}>
                    {row.deal.title}
                  </Link>
                </strong>
                <span>#{row.deal.id}</span>
              </div>
              <div className="row-stages">
                {row.previousStage ? (
                  <>
                    <StageBadge stage={row.previousStage} />
                    <ArrowRight size={12} />
                  </>
                ) : (
                  <span>Novo</span>
                )}
                <StageBadge stage={row.stage} />
              </div>
              <time className="row-time" dateTime={row.entry.CREATED_TIME}>
                {dateTime(row.entry.CREATED_TIME)}
              </time>
            </div>
          ))}
        </div>
      ) : (
        <>
          <ReorderableTable
            columns={columns}
            labels={MOVEMENT_LABELS}
            cells={cell}
            cellClass={cellClass}
            sortKeys={MOVEMENT_SORT_KEYS}
            sorting={sorting}
            rows={visible}
            rowKey={(row) => row.entry.ID}
            busy={paging?.busy}
          />
          <Pagination
            page={page}
            total={total}
            size={size}
            onChange={setPage}
          />
        </>
      )}
    </Panel>
  );
}

function Stalled({
  rows,
  pipelines,
  hours,
  compact = false,
  paging,
  sorting,
}: {
  rows: StalledDeal[];
  pipelines: Pipeline[];
  hours: number;
  compact?: boolean;
  paging?: Paging;
  sorting?: Sorting;
}) {
  const [requestedPage, setLocalPage] = useState(1);
  const columns = useColumnOrder(STALLED_ORDER_KEY, STALLED_COLUMNS);
  const size = paging ? paging.size : compact ? 3 : 10;
  const total = paging ? paging.total : rows.length;
  const page = paging
    ? paging.page
    : Math.min(requestedPage, Math.max(1, Math.ceil(rows.length / size)));
  const visible = paging ? rows : rows.slice((page - 1) * size, page * size);
  const setPage = paging ? paging.onChange : setLocalPage;
  const customOrder =
    columns.order.join() !== STALLED_COLUMNS.join() ? columns.reset : undefined;
  const cell: Record<StalledColumn, (row: StalledDeal) => React.ReactNode> = {
    deal: (row) => (
      <DealLink id={row.deal.id} title={row.deal.title} url={row.url} />
    ),
    pipeline: (row) => (
      <span className="pipeline-label">
        {pipelineLabel(pipelines, row.deal.categoryId)}
      </span>
    ),
    stage: (row) => <StageBadge stage={row.stage} />,
    duration: (row) => (
      <strong className="duration-critical">{duration(row.duration)}</strong>
    ),
    actor: (row) => row.actor || "Não informado pela API",
    assignee: (row) => assigneeLabel(row.deal),
    revenue: (row) => revenueCell(row.deal),
  };
  const cellClass: Partial<Record<StalledColumn, string>> = {
    actor: "actor-cell",
    assignee: "actor-cell",
    revenue: "num-cell",
  };
  return (
    <Panel
      title="Parados há mais tempo"
      className="stalled-panel"
      action={
        compact ? (
          <span className="attention-count">{rows.length}</span>
        ) : (
          <span className="panel-actions">
            {customOrder && (
              <button className="text-button" onClick={customOrder}>
                Restaurar colunas
              </button>
            )}
            <Link href="/settings" className="text-link">
              <Settings2 size={14} />
              Configurar
            </Link>
          </span>
        )
      }
    >
      {!total ? (
        <Empty
          title="Tudo fluindo por aqui"
          description="Nenhum negócio ativo ultrapassou o limite configurado nos filtros selecionados."
        />
      ) : compact ? (
        <>
          <div className="stalled-list">
            {visible.map((row) => {
              // Crítico: o dobro (ou mais) do limite configurado.
              const critical = row.duration >= hours * 2 * 3600000;
              return (
                <article
                  className={`stalled-item ${critical ? "critical" : ""}`}
                  key={row.deal.id}
                >
                  <div className="stalled-item-top">
                    <div>
                      <Link
                        href={`/deal/${row.deal.id}/journey?source=dashboard`}
                      >
                        <strong>{row.deal.title}</strong>
                      </Link>
                      <span>
                        #{row.deal.id} · {row.stage.name}
                      </span>
                    </div>
                  </div>
                  <div className="stalled-time">
                    <span>{duration(row.duration)}</span>
                    {critical && <span>crítico</span>}
                  </div>
                  <Link
                    className="icon-button"
                    aria-label={`Ver jornada do negócio ${row.deal.id}`}
                    href={`/deal/${row.deal.id}/journey?source=dashboard`}
                  >
                    <ArrowUpRight size={16} />
                  </Link>
                </article>
              );
            })}
          </div>
          <Link href="/dashboard/stalled" className="panel-link">
            Ver todos os negócios parados
            <ArrowRight size={15} />
          </Link>
        </>
      ) : (
        <>
          <ReorderableTable
            columns={columns}
            labels={STALLED_LABELS}
            cells={cell}
            cellClass={cellClass}
            sortKeys={STALLED_SORT_KEYS}
            sorting={sorting}
            rows={visible}
            rowKey={(row) => row.deal.id}
            busy={paging?.busy}
          />
          <Pagination
            page={page}
            total={total}
            size={size}
            onChange={setPage}
          />
        </>
      )}
    </Panel>
  );
}

function RetentionTable({
  rows: unsorted,
  pipelines,
}: {
  rows: Retention[];
  pipelines: Pipeline[];
}) {
  // Mesma escolha da lista "Tempo médio por etapa": as duas seguem juntas. A
  // seta de "Tempo médio" usa essa escolha; a de "Maior tempo" vale só aqui e,
  // enquanto estiver ativa, manda na ordem da tabela.
  const [order, setOrder] = useStageOrder();
  const [maximumDir, setMaximumDir] = useState<SortDirection>();
  const columns = useColumnOrder(STAGE_ORDER_KEY, STAGE_COLUMNS);
  const rows = maximumDir
    ? sortRetentionByMaximum(unsorted, maximumDir, pipelines)
    : sortRetention(unsorted, order, pipelines);
  const [requestedPage, setPage] = useState(1);
  const size = 10,
    page = Math.min(requestedPage, Math.max(1, Math.ceil(rows.length / size)));
  const sorting: Sorting = {
    active: maximumDir
      ? { by: "maximum", dir: maximumDir }
      : order !== "funnel"
        ? { by: "average", dir: order }
        : undefined,
    onToggle: (by) => {
      setPage(1);
      if (by === "maximum") {
        // Primeiro clique: do maior para o menor; depois alterna.
        setMaximumDir(maximumDir === "desc" ? "asc" : "desc");
        return;
      }
      // Tempo médio: começa do maior para o menor e alterna (Decrescente /
      // Crescente); vindo do Funil ou de "Maior tempo", também começa pelo maior.
      const current = !maximumDir && order !== "funnel" ? order : "";
      setMaximumDir(undefined);
      setOrder(current === "desc" ? "asc" : "desc");
    },
  };
  const customOrder =
    columns.order.join() !== STAGE_COLUMNS.join() ? columns.reset : undefined;
  const cell: Record<StageColumn, (row: Retention) => React.ReactNode> = {
    stage: (row) => (
      <>
        <StageBadge stage={row.stage} />
        <span className="cell-secondary">{row.pipeline}</span>
      </>
    ),
    average: (row) => (
      <strong>
        {!row.visits
          ? "Sem passagens"
          : row.final
            ? "—"
            : duration(row.average)}
      </strong>
    ),
    maximum: (row) => (row.visits && !row.final ? duration(row.maximum) : "—"),
    sample: (row) => (
      <>
        {row.sampleDeals}{" "}
        <span className="muted">({row.visits} passagens)</span>
      </>
    ),
    current: (row) => row.currentDeals,
    stalled: (row) => (
      <span className={row.stalledDeals ? "duration-critical" : "muted"}>
        {row.stalledDeals} ·{" "}
        {row.currentDeals
          ? Math.round((row.stalledDeals / row.currentDeals) * 100)
          : 0}
        %
      </span>
    ),
  };
  return (
    <Panel
      title="Detalhamento por etapa"
      action={
        (customOrder || rows.length > 1) && (
          <span className="panel-actions">
            {customOrder && (
              <button className="text-button" onClick={customOrder}>
                Restaurar colunas
              </button>
            )}
            {rows.length > 1 && (
              <StageOrderToggle
                order={maximumDir ? undefined : order}
                onChange={(next) => {
                  setMaximumDir(undefined);
                  setOrder(next);
                  setPage(1);
                }}
              />
            )}
          </span>
        )
      }
    >
      {!rows.length ? (
        <Empty />
      ) : (
        <>
          <ReorderableTable
            columns={columns}
            labels={STAGE_LABELS}
            cells={cell}
            cellClass={{}}
            sortKeys={STAGE_SORT_KEYS}
            sorting={sorting}
            rows={rows.slice((page - 1) * size, page * size)}
            rowKey={(row) => `${row.stage.categoryId}:${row.stage.id}`}
          />
          <Pagination
            page={page}
            total={rows.length}
            size={size}
            onChange={setPage}
          />
        </>
      )}
    </Panel>
  );
}
