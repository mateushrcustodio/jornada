"use client";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Clock3,
  Layers3,
  Pause,
  RefreshCw,
  Route,
  Settings2,
  Timer,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type {
  DashboardData,
  Catalog,
  Deal,
  Filters,
  Movement,
  PageData,
  Period,
  Pipeline,
  Retention,
  StalledDeal,
  View,
} from "@/lib/types";
import { PAGE_SIZE } from "@/lib/types";
import { dateTime, duration, periodRange } from "@/lib/format";
import { useApp } from "./provider";
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
  const [from, setFrom] = useSticky("from", () => "");
  const [to, setTo] = useSticky("to", () => "");
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
      }
    : undefined;
  const body = JSON.stringify({ filters, settings });
  // Movimentações e Parados só buscam o total e a página aberta; a visão geral
  // e as etapas precisam de todos os dados para calcular médias e contagens.
  const paged = view === "movements" || view === "stalled";
  const canQuery = ready && validCustom && requested;
  const resource = useResource<DashboardData>(
    "/api/dashboard",
    body,
    canQuery && !paged,
    DASHBOARD_CACHE_MS,
  );
  const data = resource.data;
  // A página volta para a primeira ao mudar de aba, filtro, configuração ou
  // ao atualizar; a assinatura evita um efeito só para zerar o contador.
  const pageSignature = `${view}\n${body}\n${clock}`;
  const [pageState, setPageState] = useState({ signature: "", page: 1 });
  const page = pageState.signature === pageSignature ? pageState.page : 1;
  const pageResource = useResource<PageData<Movement> | PageData<StalledDeal>>(
    "/api/dashboard/page",
    JSON.stringify({ filters, settings, kind: view, page, asOf: clock }),
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
    !!pipeline || !!stage || effectivePeriod !== settings.defaultPeriod;
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
            disabled={(requested && active.loading) || !validCustom || !catalog}
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
        {hasFilters && (
          <button
            className="text-button"
            onClick={() => {
              setPipeline("");
              setStage("");
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
      {!validCustom ? (
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
              <div className="split">
                <RetentionChart rows={data.retention} full />
                <Panel title="Como ler os tempos">
                  <div className="analysis-explainer">
                    <p>
                      A média considera passagens com entrada no período. Cada
                      passagem termina na próxima movimentação; uma etapa aberta
                      vai até a consulta.
                    </p>
                    <p>
                      Os contadores de negócios e parados representam a posição
                      atual, inclusive sem movimentações recentes. Etapas
                      concluídas de ganho ou perda têm duração final zero.
                    </p>
                    <p>Cada pipeline é calculado separadamente.</p>
                  </div>
                </Panel>
              </div>
              <RetentionTable rows={data.retention} />
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
  full = false,
}: {
  rows: Retention[];
  full?: boolean;
}) {
  const visible = full ? rows : rows.slice(0, 4);
  const max = Math.max(1, ...visible.map((r) => r.average));
  return (
    <Panel
      title="Tempo médio por etapa"
      action={
        !full && (
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
                  {r.visits ? duration(r.average) : "Sem passagens"}
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

function Movements({
  rows,
  pipelines,
  compact = false,
  paging,
}: {
  rows: Movement[];
  pipelines: Pipeline[];
  compact?: boolean;
  paging?: Paging;
}) {
  const [requestedPage, setLocalPage] = useState(1);
  // Com `paging`, as linhas já são só as da página atual (buscadas sob demanda).
  const size = paging ? paging.size : compact ? 5 : 10;
  const total = paging ? paging.total : rows.length;
  const page = paging
    ? paging.page
    : Math.min(requestedPage, Math.max(1, Math.ceil(rows.length / size)));
  const visible = paging ? rows : rows.slice((page - 1) * size, page * size);
  const setPage = paging ? paging.onChange : setLocalPage;
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
          <span className="count-badge">{total} registros</span>
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
          <div className={`table-scroll ${paging?.busy ? "is-busy" : ""}`}>
            <table>
              <thead>
                <tr>
                  <th>Negócio</th>
                  <th>Pipeline</th>
                  <th>Movimentação</th>
                  <th>Quando</th>
                  <th>Movido por</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.entry.ID}>
                    <td>
                      <DealLink
                        id={row.deal.id}
                        title={row.deal.title}
                        url={row.url}
                      />
                    </td>
                    <td>
                      <span className="pipeline-label">
                        {pipelines.find((p) => p.id === row.entry.CATEGORY_ID)
                          ?.name || `Pipeline #${row.entry.CATEGORY_ID}`}
                      </span>
                    </td>
                    <td>
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
                    </td>
                    <td className="date-cell">
                      {dateTime(row.entry.CREATED_TIME)}
                    </td>
                    <td className="actor-cell">
                      {row.actor || "Não informado pela API"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
}: {
  rows: StalledDeal[];
  pipelines: Pipeline[];
  hours: number;
  compact?: boolean;
  paging?: Paging;
}) {
  const [requestedPage, setLocalPage] = useState(1);
  const size = paging ? paging.size : compact ? 3 : 10;
  const total = paging ? paging.total : rows.length;
  const page = paging
    ? paging.page
    : Math.min(requestedPage, Math.max(1, Math.ceil(rows.length / size)));
  const visible = paging ? rows : rows.slice((page - 1) * size, page * size);
  const setPage = paging ? paging.onChange : setLocalPage;
  return (
    <Panel
      title="Parados há mais tempo"
      className="stalled-panel"
      action={
        compact ? (
          <span className="attention-count">{rows.length}</span>
        ) : (
          <Link href="/settings" className="text-link">
            <Settings2 size={14} />
            Configurar
          </Link>
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
          <div className={`table-scroll ${paging?.busy ? "is-busy" : ""}`}>
            <table>
              <thead>
                <tr>
                  <th>Negócio / pipeline</th>
                  <th>Etapa atual</th>
                  <th>Entrada na etapa</th>
                  <th>Tempo parado</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.deal.id}>
                    <td>
                      <DealLink
                        id={row.deal.id}
                        title={row.deal.title}
                        url={row.url}
                      />
                      <span className="cell-secondary">
                        {
                          pipelines.find((p) => p.id === row.deal.categoryId)
                            ?.name
                        }
                      </span>
                    </td>
                    <td>
                      <StageBadge stage={row.stage} />
                    </td>
                    <td className="date-cell">{dateTime(row.enteredAt)}</td>
                    <td>
                      <strong className="duration-critical">
                        {duration(row.duration)}
                      </strong>
                    </td>
                    <td>
                      <span className="attention-tag">Acima do limite</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

function RetentionTable({ rows }: { rows: Retention[] }) {
  const [requestedPage, setPage] = useState(1);
  const size = 10,
    page = Math.min(requestedPage, Math.max(1, Math.ceil(rows.length / size)));
  return (
    <Panel title="Detalhamento por etapa">
      {!rows.length ? (
        <Empty />
      ) : (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Etapa / pipeline</th>
                  <th>Tempo médio</th>
                  <th>Maior tempo</th>
                  <th>Negócios na amostra</th>
                  <th>Atuais</th>
                  <th>Acima do limite</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice((page - 1) * size, page * size).map((row) => (
                  <tr key={`${row.stage.categoryId}:${row.stage.id}`}>
                    <td>
                      <StageBadge stage={row.stage} />
                      <span className="cell-secondary">{row.pipeline}</span>
                    </td>
                    <td>
                      <strong>
                        {row.visits ? duration(row.average) : "Sem passagens"}
                      </strong>
                    </td>
                    <td>{row.visits ? duration(row.maximum) : "—"}</td>
                    <td>
                      {row.sampleDeals}{" "}
                      <span className="muted">({row.visits} passagens)</span>
                    </td>
                    <td>{row.currentDeals}</td>
                    <td>
                      <span
                        className={
                          row.stalledDeals ? "duration-critical" : "muted"
                        }
                      >
                        {row.stalledDeals} ·{" "}
                        {row.currentDeals
                          ? Math.round(
                              (row.stalledDeals / row.currentDeals) * 100,
                            )
                          : 0}
                        %
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
