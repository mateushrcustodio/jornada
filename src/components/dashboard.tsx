"use client";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  Clock3,
  Filter,
  Layers3,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Timer,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type {
  DashboardData,
  Deal,
  Filters,
  Movement,
  Period,
  Pipeline,
  Retention,
  StalledDeal,
  View,
} from "@/lib/types";
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
  overview: "Seu processo, em perspectiva.",
  movements: "Cada movimento, um novo caminho.",
  stalled: "Atenção onde faz diferença.",
  stages: "Encontre o ritmo do seu funil.",
};
const subtitles = {
  overview:
    "Acompanhe a movimentação dos negócios e identifique gargalos por etapa.",
  movements: "Explore as mudanças de etapa e o histórico dos seus negócios.",
  stalled: "Identifique negócios que precisam de um novo impulso para avançar.",
  stages:
    "Entenda o tempo em cada etapa e descubra os pontos de maior retenção.",
};
export function Dashboard({ view }: { view: View }) {
  const { settings, ready } = useApp();
  const [period, setPeriod] = useState<Period>();
  const [pipeline, setPipeline] = useState("");
  const [stage, setStage] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const effectivePeriod = period ?? settings.defaultPeriod;
  const validCustom =
    effectivePeriod !== "custom" ||
    (!!from &&
      !!to &&
      from <= to &&
      Date.parse(to) - Date.parse(from) <= 365 * 86400000);
  // Uma faixa estável por seleção; o relógio é atualizado no clique em Atualizar.
  const [clock, setClock] = useState(() => Date.now());
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
  const resource = useResource<DashboardData>(
    "/api/dashboard",
    body,
    ready && validCustom,
  );
  const data = resource.data;
  function refresh() {
    setClock(Date.now());
    resource.refresh();
  }
  const hasFilters =
    !!pipeline || !!stage || effectivePeriod !== settings.defaultPeriod;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="page-kicker">
            <span />
            INTELIGÊNCIA DO SEU CRM
          </div>
          <h1>{titles[view]}</h1>
          <p>{subtitles[view]}</p>
        </div>
        <div className="heading-actions">
          <button
            className="button primary"
            onClick={refresh}
            disabled={resource.loading || !validCustom}
          >
            <RefreshCw size={16} className={resource.loading ? "spin" : ""} />
            Atualizar dados
          </button>
          <span className="last-query">
            {data && !resource.loading && !resource.error
              ? `Última consulta: ${dateTime(data.queriedAt)}`
              : resource.loading
                ? "Consultando dados…"
                : "Consulta sob demanda"}
          </span>
        </div>
      </div>
      <div className="filters-panel">
        <div className="filter-icon">
          <SlidersHorizontal size={18} />
        </div>
        <label>
          <span>Período</span>
          <div className="select-wrap">
            <CalendarDays size={16} />
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
          </div>
        </label>
        <span className="filter-divider" />
        <label>
          <span>Pipeline</span>
          <select
            aria-label="Pipeline"
            value={pipeline}
            onChange={(e) => {
              setPipeline(e.target.value);
              setStage("");
            }}
          >
            <option value="">Todos os pipelines</option>
            {data?.pipelines
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
        <span className="filter-divider" />
        <label>
          <span>Etapa</span>
          <select
            aria-label="Etapa"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
          >
            <option value="">Todas as etapas</option>
            {data?.stages
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
                    ? ` · ${data.pipelines.find((p) => p.id === s.categoryId)?.name}`
                    : ""}
                </option>
              ))}
          </select>
        </label>
        <div className="filter-trailing">
          {hasFilters ? (
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
          ) : (
            <span>
              <Filter size={13} />
              Filtros da consulta
            </span>
          )}
        </div>
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
        <Empty
          title="Escolha um período"
          description="Selecione as datas inicial e final, em ordem, com intervalo de até 366 dias."
        />
      ) : resource.loading || !ready ? (
        <Skeleton />
      ) : resource.error ? (
        <ErrorState
          message={resource.error}
          code={resource.code}
          retry={refresh}
        />
      ) : data ? (
        <>
          {view === "overview" && (
            <>
              <Metrics data={data} />
              <TrackedDeals data={data} />
              <div className="overview-grid">
                <ActivityChart data={data} filters={filters!} />
                <RetentionChart rows={data.retention} />
              </div>
              <div className="section-label">
                <span>ACOMPANHAMENTO DO PIPELINE</span>
                <span>
                  Um olhar para o que precisa de atenção
                  <ArrowDown size={13} />
                </span>
              </div>
              <div className="detail-grid">
                <Movements
                  rows={data.movements}
                  pipelines={data.pipelines}
                  compact
                />
                <Stalled
                  rows={data.stalled}
                  pipelines={data.pipelines}
                  compact
                  hours={settings.stalledHours}
                />
              </div>
            </>
          )}
          {view === "movements" && (
            <Movements rows={data.movements} pipelines={data.pipelines} />
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
                rows={data.stalled}
                pipelines={data.pipelines}
                hours={settings.stalledHours}
              />
            </>
          )}
          {view === "stages" && (
            <>
              <div className="overview-grid stages-grid">
                <RetentionChart rows={data.retention} full />
                <Panel title="Como ler os tempos" eyebrow="CONTEXTO DA ANÁLISE">
                  <div className="analysis-explainer">
                    <span className="explain-icon">
                      <Timer size={24} />
                    </span>
                    <h3>Tempo é uma pista valiosa.</h3>
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
                    <span className="small-label">
                      Cada pipeline é calculado separadamente.
                    </span>
                  </div>
                </Panel>
              </div>
              <RetentionTable rows={data.retention} />
            </>
          )}
        </>
      ) : null}
    </>
  );
}

function TrackedDeals({ data }: { data: DashboardData }) {
  const unique = new Map<number, { deal: Deal; stageName: string; pipeline: string; movedTime?: string }>();
  data.movements.forEach((row) => unique.set(row.deal.id, { deal: row.deal, stageName: row.stage.name, pipeline: data.pipelines.find((pipeline) => pipeline.id === row.deal.categoryId)?.name || "Pipeline não informado", movedTime: row.deal.movedTime }));
  data.stalled.forEach((row) => unique.set(row.deal.id, { deal: row.deal, stageName: row.stage.name, pipeline: data.pipelines.find((pipeline) => pipeline.id === row.deal.categoryId)?.name || "Pipeline não informado", movedTime: row.deal.movedTime }));
  const rows = [...unique.values()].sort((a, b) => Date.parse(b.movedTime || "") - Date.parse(a.movedTime || "")).slice(0, 8);
  return (
    <Panel title="Negócios acompanhados" eyebrow="VISÃO DOS CARDS" action={<span className="count-badge">{data.activeCount} ativos</span>} className="tracked-deals-panel">
      {!rows.length ? <Empty title="Nenhum negócio encontrado" description="A consulta não retornou negócios para os filtros selecionados." /> : (
        <div className="tracked-deals-list">
          {rows.map((row) => <Link href={`/deal/${row.deal.id}/journey`} className="tracked-deal-row" key={row.deal.id}>
            <span className="tracked-deal-icon"><Activity size={16} /></span>
            <span className="tracked-deal-main"><strong>{row.deal.title}</strong><small>#{row.deal.id} · {row.pipeline}</small></span>
            <span className="tracked-deal-stage"><span>{row.stageName}</span><small>{row.movedTime ? dateTime(row.movedTime, true) : "Data não informada"}</small></span>
            <ArrowUpRight size={16} className="tracked-deal-arrow" />
          </Link>)}
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
      icon: Activity,
      color: "orange",
    },
    {
      key: "active" as const,
      label: "Negócios em andamento",
      value: data.activeCount.toLocaleString("pt-BR"),
      detail: "ativos nos filtros selecionados",
      icon: Layers3,
      color: "blue",
    },
    {
      key: "stalled" as const,
      label: "Precisam de atenção",
      value: data.stalled.length.toLocaleString("pt-BR"),
      detail: `há ${settings.stalledHours}h ou mais na etapa`,
      icon: Clock3,
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
      color: "green",
    },
  ];
  return (
    <div className="stat-grid">
      {metrics
        .filter((m) => settings.indicators[m.key])
        .map(({ key, label, value, detail, icon: Icon, color }) => (
          <article className={`stat-card stat-${color}`} key={key}>
            <div className="stat-top">
              <span>{label}</span>
              <span className="stat-icon">
                <Icon size={18} />
              </span>
            </div>
            <strong className="stat-value">{value}</strong>
            <span className="stat-detail">
              <span className="tiny-dot" />
              {detail}
            </span>
          </article>
        ))}
    </div>
  );
}
function ActivityChart({
  data,
  filters,
}: {
  data: DashboardData;
  filters: Filters;
}) {
  const start = Date.parse(filters.from),
    end = Date.parse(filters.to);
  const binCount = Math.max(
    1,
    Math.min(12, Math.ceil((end - start) / 86400000)),
  );
  const width = Math.max(1, (end - start) / binCount);
  const bins = Array.from({ length: binCount }, (_, i) => ({
    time: start + i * width,
    count: 0,
  }));
  data.movements.forEach((m) => {
    const i = Math.min(
      binCount - 1,
      Math.floor((Date.parse(m.entry.CREATED_TIME) - start) / width),
    );
    if (i >= 0) bins[i].count++;
  });
  const max = Math.max(1, ...bins.map((b) => b.count));
  return (
    <Panel
      title="O ritmo das movimentações"
      eyebrow="ATIVIDADE NO PERÍODO"
      action={
        <span className="chart-legend">
          <span />
          Movimentações
        </span>
      }
      className="activity-panel"
    >
      {!data.movements.length ? (
        <Empty
          title="Sem atividade no período"
          description="Nenhuma movimentação no período selecionado."
        />
      ) : (
        <>
          <div
            className="activity-chart"
            aria-label="Movimentações por intervalo"
          >
            <div className="chart-grid-lines">
              <span>{max}</span>
              <span>{Math.round(max / 2)}</span>
              <span>0</span>
            </div>
            <div className="chart-bars">
              {bins.map((b, i) => (
                <div className="chart-column" key={i}>
                  <span className="bar-count">{b.count}</span>
                  <div
                    className={`activity-bar ${i === bins.length - 1 ? "last" : ""}`}
                    style={{
                      height: `${Math.max(2, (b.count / max) * 118)}px`,
                    }}
                  />
                  <span className="bar-label">
                    {new Intl.DateTimeFormat("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      timeZone: "America/Sao_Paulo",
                    }).format(new Date(b.time))}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="chart-footer">
            <span>
              <strong>{data.movements.length}</strong> mudanças de etapa no
              período
            </span>
            <span>
              Consulta sob demanda
              <ArrowUpRight size={13} />
            </span>
          </div>
        </>
      )}
    </Panel>
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
      title="Onde o tempo se concentra"
      eyebrow="TEMPO MÉDIO POR ETAPA"
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
          {visible.map((r, i) => (
            <div
              className="retention-row"
              key={`${r.stage.categoryId}:${r.stage.id}`}
            >
              <div className="retention-label">
                <span className="rank">0{i + 1}</span>
                <div>
                  <strong>{r.stage.name}</strong>
                  <span>
                    {r.pipeline} · {r.sampleDeals} negócios na amostra
                  </span>
                </div>
                <strong className="retention-value">
                  {r.visits ? duration(r.average) : "Sem passagens"}
                </strong>
              </div>
              <div className="bar-track">
                <span
                  style={{
                    width: `${(r.average / max) * 100}%`,
                    background: i === 0 ? "#d57b57" : r.stage.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="panel-footnote">
        Da maior para a menor permanência média.
      </div>
    </Panel>
  );
}
function Movements({
  rows,
  pipelines,
  compact = false,
}: {
  rows: Movement[];
  pipelines: Pipeline[];
  compact?: boolean;
}) {
  const [requestedPage, setPage] = useState(1);
  const size = compact ? 5 : 10;
  const page = Math.min(
    requestedPage,
    Math.max(1, Math.ceil(rows.length / size)),
  );
  const visible = rows.slice((page - 1) * size, page * size);
  return (
    <Panel
      title="Últimas movimentações"
      eyebrow="HISTÓRICO DOS NEGÓCIOS"
      className="movements-panel"
      action={
        compact ? (
          <Link className="text-link" href="/dashboard/movements">
            Ver todas
            <ArrowRight size={14} />
          </Link>
        ) : (
          <span className="count-badge">{rows.length} registros</span>
        )
      }
    >
      {!rows.length ? (
        <Empty />
      ) : (
        <>
          <div className="table-scroll">
            <table className={compact ? "compact-table" : ""}>
              <thead>
                <tr>
                  <th>Negócio</th>
                  {!compact && <th>Pipeline</th>}
                  <th>Movimentação</th>
                  <th>Quando</th>
                  {!compact && <th>Movido por</th>}
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
                    {!compact && (
                      <td>
                        <span className="pipeline-label">
                          {pipelines.find((p) => p.id === row.entry.CATEGORY_ID)
                            ?.name || `Pipeline #${row.entry.CATEGORY_ID}`}
                        </span>
                      </td>
                    )}
                    <td>
                      <div className="movement-stages">
                        <span className="previous-stage">
                          {row.previousStage?.name || "Primeira entrada"}
                        </span>
                        <div>
                          <ArrowRight size={12} />
                          <StageBadge stage={row.stage} />
                        </div>
                      </div>
                    </td>
                    <td className="date-cell">
                      {dateTime(row.entry.CREATED_TIME)}
                    </td>
                    {!compact && (
                      <td className="actor-cell">
                        {row.actor || "Não informado pela API"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {compact ? (
            <div className="panel-footnote">
              Exibindo as {Math.min(size, rows.length)} movimentações mais
              recentes.
            </div>
          ) : (
            <Pagination
              page={page}
              total={rows.length}
              size={size}
              onChange={setPage}
            />
          )}
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
}: {
  rows: StalledDeal[];
  pipelines: Pipeline[];
  hours: number;
  compact?: boolean;
}) {
  const [requestedPage, setPage] = useState(1);
  const size = compact ? 3 : 10;
  const page = Math.min(
    requestedPage,
    Math.max(1, Math.ceil(rows.length / size)),
  );
  const visible = rows.slice((page - 1) * size, page * size);
  return (
    <Panel
      title="Negócios que pedem atenção"
      eyebrow={`PARADOS HÁ ${hours}H OU MAIS`}
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
      {!rows.length ? (
        <Empty
          title="Tudo fluindo por aqui"
          description="Nenhum negócio ativo ultrapassou o limite configurado nos filtros selecionados."
        />
      ) : compact ? (
        <>
          <div className="stalled-list">
            {visible.map((row) => (
              <article className="stalled-item" key={row.deal.id}>
                <div className="stalled-item-top">
                  <span className="company-avatar">
                    {row.deal.title.charAt(0)}
                  </span>
                  <div>
                    <Link href={`/deal/${row.deal.id}/journey`}>
                      <strong>{row.deal.title}</strong>
                    </Link>
                    <span>
                      #{row.deal.id} · {row.stage.name}
                    </span>
                    <span>
                      {
                        pipelines.find((p) => p.id === row.deal.categoryId)
                          ?.name
                      }
                    </span>
                  </div>
                  <Link
                    className="icon-button"
                    aria-label={`Ver jornada do negócio ${row.deal.id}`}
                    href={`/deal/${row.deal.id}/journey`}
                  >
                    <ArrowUpRight size={16} />
                  </Link>
                </div>
                <div className="stalled-time">
                  <span>
                    <Clock3 size={13} />
                    {duration(row.duration)} na etapa
                  </span>
                  <span>Acima do limite</span>
                </div>
              </article>
            ))}
          </div>
          <Link href="/dashboard/stalled" className="panel-link">
            Ver todos os negócios parados
            <ArrowRight size={15} />
          </Link>
        </>
      ) : (
        <>
          <div className="table-scroll">
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
            total={rows.length}
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
    <Panel
      title="Retenção por etapa"
      eyebrow="DETALHAMENTO"
      action={<ChartNoAxesCombined size={20} />}
    >
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
