"use client";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChartColumnBig,
  Pause,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DashboardData, UserOption } from "@/lib/types";
import { dateTime, duration, money } from "@/lib/format";
import {
  buildStageInsights,
  durationTicks,
  type AssigneeStat,
  type FlowItem,
  type PipelineInsight,
  type StageInsight,
  type StageInsights,
} from "@/lib/stage-insights";
import { buildStagePie, type PieModel } from "@/lib/pie";
import { ChartTip, TipRows, useTip } from "./chart-tip";
import {
  ModeToggle,
  PieChart,
  formatShare,
  useChartMode,
  type PieView,
} from "./stage-pie";
import { DealLink, Empty, Panel, StageBadge } from "./ui";

const HOUR = 3600000;
const DAY = 24 * HOUR;

// Rótulo curto para eixos e topo das colunas: "3d", "8h", "3d 8h", "45min".
function shortDuration(ms: number) {
  if (ms <= 0) return "0";
  if (ms % DAY === 0) return `${ms / DAY}d`;
  // Arredonda para baixo, igual a duration(), para os rótulos nunca divergirem.
  if (ms < HOUR) return `${Math.max(1, Math.floor(ms / 60000))}min`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  return hours ? `${days}d ${hours}h` : `${days}d`;
}
const ratio = (value: number) =>
  `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×`;
const count = (value: number) => value.toLocaleString("pt-BR");
const plural = (n: number, one: string, many: string) =>
  `${count(n)} ${n === 1 ? one : many}`;

// Dados das fatias: os mesmos números do gráfico de colunas, só em outra forma.
function pieViews(
  model: PieModel,
  stages: StageInsight[],
  stalledHours: number,
): PieView[] {
  const byKey = new Map(stages.map((stage) => [stage.key, stage]));
  return model.slices.map((slice) => {
    const stage = byKey.get(slice.key);
    return {
      ...slice,
      display: duration(slice.value),
      rows: slice.members
        ? slice.members.map((m) => [m.label, duration(m.value)])
        : stage
          ? [
              ["tempo médio", duration(stage.average)],
              ["mediana", duration(stage.median)],
              ["passagens", count(stage.passages)],
              [`parados (${stalledHours}h+)`, count(stage.stalledDeals)],
            ]
          : [],
    };
  });
}
const pieNote = (model: PieModel) =>
  `Cada fatia é a parte de uma etapa na soma dos tempos médios (${duration(model.total)}), na ordem do funil, a partir das 12h. Etapas sem passagem no período não têm fatia.`;

export function PipelineTabs({
  insights,
  value,
  onChange,
}: {
  insights: StageInsights;
  value: number;
  onChange: (id: number) => void;
}) {
  if (insights.pipelines.length < 2) return null;
  return (
    <div className="segmented" role="group" aria-label="Pipeline do gráfico">
      {insights.pipelines.map((p) => (
        <button
          key={p.id}
          type="button"
          aria-pressed={p.id === value}
          onClick={() => onChange(p.id)}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}

// ---------- Painel compacto (aba Etapas, coluna da direita) ----------
export function StageTimePanel({
  data,
  users,
  stalledHours,
  insights: provided,
}: {
  data: DashboardData;
  users: UserOption[];
  stalledHours: number;
  // Análise já calculada pela tela (evita calcular duas vezes).
  insights?: StageInsights;
}) {
  const insights = useMemo(
    () => provided ?? buildStageInsights(data, users),
    [provided, data, users],
  );
  const [pipelineId, setPipelineId] = useState<number>();
  const [open, setOpen] = useState<{ stage?: string } | null>(null);
  const pipeline =
    insights.pipelines.find((p) => p.id === pipelineId) ??
    insights.pipelines[0];
  const timed = pipeline?.stages.filter((s) => !s.final) ?? [];
  const finals = pipeline?.stages.filter((s) => s.final) ?? [];
  const max = Math.max(1, ...timed.map((s) => s.average));
  const tip = useTip();
  const bottleneck = pipeline?.bottleneck;
  const [chartMode, setChartMode] = useChartMode();
  const model = buildStagePie(timed);
  const pieOk = model.slices.length >= 2;
  const mode = chartMode === "pie" && pieOk ? "pie" : "bars";
  return (
    <Panel title="Tempo médio no funil" className="stage-time-panel">
      {!pipeline || !timed.length ? (
        <Empty
          title="Sem tempos para mostrar"
          description="Não há passagens por etapas abertas nos filtros selecionados."
        />
      ) : (
        <>
          <PipelineTabs
            insights={insights}
            value={pipeline.id}
            onChange={setPipelineId}
          />
          <p className="stage-time-headline">
            {bottleneck ? (
              <>
                <strong>{bottleneck.stage.name}</strong> segura os negócios por
                mais tempo: {duration(bottleneck.average)} em média
                {bottleneck.vsFunnel && bottleneck.vsFunnel >= 1.05
                  ? `, ${ratio(bottleneck.vsFunnel)} a média do funil.`
                  : "."}
              </>
            ) : (
              "Nenhuma passagem com entrada no período; as etapas abaixo têm só negócios atuais."
            )}
          </p>
          <div className="chart-toolbar">
            <span className="muted">
              {mode === "pie"
                ? "Participação de cada etapa no tempo somado"
                : "Tempo médio de cada etapa"}
            </span>
            <ModeToggle
              mode={mode}
              onChange={setChartMode}
              pieDisabled={!pieOk}
            />
          </div>
          {mode === "pie" ? (
            <>
              <PieChart
                label={`Participação de cada etapa no tempo médio, ${pipeline.name}`}
                slices={pieViews(model, timed, stalledHours)}
                empty={model.empty.map((e) => ({
                  key: e.key,
                  label: e.stage.name,
                }))}
                onSelect={(key) => setOpen({ stage: key })}
              />
              <p className="pie-note">{pieNote(model)}</p>
            </>
          ) : (
            <>
              <div className="chart-frame">
                <div
                  className="stage-columns"
                  role="list"
                  aria-label={`Tempo médio por etapa, ${pipeline.name}, na ordem do funil`}
                >
                  {timed.map((s) => (
                    <div className="stage-column" role="listitem" key={s.key}>
                      <button
                        type="button"
                        className="stage-column-hit"
                        aria-label={`${s.stage.name}: ${s.passages ? `média de ${duration(s.average)} em ${plural(s.passages, "passagem", "passagens")}` : "sem passagens no período"}. Ver detalhes.`}
                        onClick={() => setOpen({ stage: s.key })}
                        {...tip.bind(
                          <TipRows
                            title={s.stage.name}
                            rows={[
                              [
                                "tempo médio",
                                s.passages ? duration(s.average) : "—",
                              ],
                              [
                                "mediana",
                                s.passages ? duration(s.median) : "—",
                              ],
                              ["passagens", count(s.passages)],
                              ["negócios", count(s.deals)],
                              [
                                `parados (${stalledHours}h+)`,
                                count(s.stalledDeals),
                              ],
                            ]}
                          />,
                        )}
                      >
                        <span className="stage-column-value">
                          {s.passages ? shortDuration(s.average) : "—"}
                        </span>
                        <span className="stage-column-plot">
                          <span
                            className="stage-column-bar"
                            style={{
                              height: `${Math.max(s.passages ? 2 : 0, (s.average / max) * 100)}%`,
                            }}
                          />
                        </span>
                      </button>
                      <span className="stage-column-label" title={s.stage.name}>
                        {s.stage.name}
                      </span>
                    </div>
                  ))}
                </div>
                <ChartTip tip={tip.tip} />
              </div>
            </>
          )}
          <div className="stage-time-footer">
            <span>
              Média do funil <strong>{duration(pipeline.average)}</strong> ·{" "}
              {plural(pipeline.passages, "passagem", "passagens")}
              {finals.length > 0 && (
                <span className="muted">
                  {" "}
                  · {finals.map((f) => f.stage.name).join(" e ")} fora do
                  gráfico (duração zero)
                </span>
              )}
            </span>
            <button
              type="button"
              className="button"
              onClick={() => setOpen({})}
            >
              <ChartColumnBig size={16} />
              Ver mais detalhes
            </button>
          </div>
        </>
      )}
      {open && pipeline && (
        <StageTimeDialog
          insights={insights}
          pipeline={pipeline}
          onPipeline={setPipelineId}
          initialStage={open.stage}
          stalledHours={stalledHours}
          queriedAt={data.queriedAt}
          partial={!!data.partial}
          onClose={() => setOpen(null)}
        />
      )}
    </Panel>
  );
}

// ---------- Janela de detalhes ----------
function StageTimeDialog({
  insights,
  pipeline,
  onPipeline,
  initialStage,
  stalledHours,
  queriedAt,
  partial,
  onClose,
}: {
  insights: StageInsights;
  pipeline: PipelineInsight;
  onPipeline: (id: number) => void;
  initialStage?: string;
  stalledHours: number;
  queriedAt: string;
  partial: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, []);
  const timed = pipeline.stages.filter((s) => !s.final);
  const finals = pipeline.stages.filter((s) => s.final && s.passages > 0);
  const [chosen, setChosen] = useState(initialStage);
  const selected =
    timed.find((s) => s.key === chosen) ??
    pipeline.bottleneck ??
    timed.find((s) => s.passages) ??
    timed[0];
  const cur = insights.currency;
  const [chartMode, setChartMode] = useChartMode();
  const model = buildStagePie(timed);
  const pieOk = model.slices.length >= 2;
  const mode = chartMode === "pie" && pieOk ? "pie" : "bars";
  return (
    <dialog
      ref={ref}
      className="insight-dialog"
      aria-labelledby="stage-time-title"
      onClose={onClose}
      onClick={(e) => {
        // Clique fora da caixa (no fundo escurecido) fecha.
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
    >
      <div className="insight-sheet">
        <header className="insight-header">
          <div>
            <h2 id="stage-time-title">Tempo médio por etapa</h2>
            <p>
              {pipeline.name} · consulta de {dateTime(queriedAt)} · segue os
              filtros do painel
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Fechar detalhes"
            onClick={() => ref.current?.close()}
          >
            <X size={18} />
          </button>
        </header>
        <div className="insight-body">
          <PipelineTabs
            insights={insights}
            value={pipeline.id}
            onChange={(id) => {
              setChosen(undefined);
              onPipeline(id);
            }}
          />
          {partial && (
            <p className="insight-note">
              A consulta foi parcial (veja o aviso no painel): os números abaixo
              consideram só os negócios detalhados.
            </p>
          )}
          <div className="insight-stats">
            <Stat
              label="Tempo médio do funil"
              value={duration(pipeline.average)}
              detail="por passagem, sem etapas finais"
            />
            <Stat
              label="Gargalo"
              value={pipeline.bottleneck?.stage.name ?? "—"}
              detail={
                pipeline.bottleneck
                  ? `${duration(pipeline.bottleneck.average)} em média${pipeline.bottleneck.vsFunnel ? ` · ${ratio(pipeline.bottleneck.vsFunnel)} o funil` : ""}`
                  : "sem passagens no período"
              }
            />
            <Stat
              label="Passagens analisadas"
              value={count(pipeline.passages)}
              detail={plural(pipeline.deals, "negócio", "negócios")}
            />
            <Stat
              label="Faturamento em análise"
              value={money(pipeline.revenue, cur)}
              detail="valor dos negócios que se moveram"
            />
            <Stat
              label={`Parados (${stalledHours}h ou mais)`}
              value={count(pipeline.stalledDeals)}
              detail={`${money(pipeline.stalledRevenue, cur)} parados`}
              alert={pipeline.stalledDeals > 0}
            />
          </div>

          <section className="insight-section">
            <div className="insight-section-heading">
              <h3>
                {mode === "pie"
                  ? "Participação de cada etapa no tempo do funil"
                  : "Tempo em cada etapa, na ordem do funil"}
              </h3>
              <div className="insight-section-tools">
                {mode === "bars" && <RangeLegend />}
                <ModeToggle
                  mode={mode}
                  onChange={setChartMode}
                  pieDisabled={!pieOk}
                />
              </div>
            </div>
            {mode === "pie" ? (
              <div className="pie-detail">
                <PieChart
                  label={`Participação de cada etapa no tempo médio, ${pipeline.name}`}
                  slices={pieViews(model, timed, stalledHours)}
                  selected={selected?.key}
                  onSelect={setChosen}
                />
                <PieTable
                  stages={timed}
                  model={model}
                  pipeline={pipeline}
                  currency={cur}
                  selected={selected?.key}
                  onSelect={setChosen}
                />
              </div>
            ) : (
              <RangeChart
                stages={timed}
                selected={selected?.key}
                onSelect={setChosen}
              />
            )}
            <p className="insight-hint">
              Clique {mode === "pie" ? "numa fatia ou linha" : "numa etapa"}{" "}
              para ver responsáveis, faturamento e os negócios que mais
              demoraram.
              {mode === "pie" && ` ${pieNote(model)}`}
            </p>
          </section>

          {selected && (
            <StageDrill
              stage={selected}
              currency={cur}
              stalledHours={stalledHours}
            />
          )}

          {finals.length > 0 && (
            <section className="insight-section">
              <div className="insight-section-heading">
                <h3>Etapas de conclusão</h3>
                <span className="muted">ganho e perda, sem tempo na etapa</span>
              </div>
              <div className="final-stage-list">
                {finals.map((stage) => (
                  <FinalStageCard
                    key={stage.key}
                    stage={stage}
                    currency={cur}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="insight-section">
            <div className="insight-section-heading">
              <h3>Responsáveis no funil</h3>
              <span className="muted">todas as etapas abertas</span>
            </div>
            <AssigneeTable
              rows={pipeline.assignees}
              currency={cur}
              reference={pipeline.average}
              referenceLabel="vs média do funil"
              funnel
            />
          </section>
          <p className="insight-note">
            Faturamento é o campo Valor do negócio, somado uma vez por negócio.
            {insights.otherCurrencyDeals > 0 &&
              ` ${plural(insights.otherCurrencyDeals, "negócio em outra moeda ficou", "negócios em outras moedas ficaram")} fora das somas.`}{" "}
            Passagens ainda abertas contam o tempo até a consulta.
          </p>
        </div>
      </div>
    </dialog>
  );
}

// Etapa de conclusão (ganho/perda): como o negócio fecha nela, o tempo na etapa
// é zero. O que importa é quanto foi concluído, de onde vieram e em quanto
// tempo (ciclo desde a primeira etapa do negócio).
function FinalStageCard({
  stage,
  currency,
}: {
  stage: StageInsight;
  currency: string;
}) {
  const people = [...stage.assignees].sort(
    (a, b) => b.deals - a.deals || b.revenue - a.revenue,
  );
  return (
    <article className="final-stage-card">
      <header>
        <StageBadge stage={stage.stage} />
        <span className="muted">
          {plural(stage.deals, "negócio", "negócios")}
          {stage.passages !== stage.deals &&
            ` · ${plural(stage.passages, "passagem", "passagens")}`}
        </span>
      </header>
      <div className="insight-stats">
        <Stat
          label="Faturamento"
          value={money(stage.revenue, currency)}
          detail="valor dos negócios, somado uma vez por negócio"
        />
        <Stat
          label="Ticket médio"
          value={stage.ticket ? money(stage.ticket, currency) : "—"}
          detail="valor médio por negócio"
        />
        <Stat
          label="Ciclo médio até concluir"
          value={stage.cycle ? duration(stage.cycle.average) : "—"}
          detail={
            stage.cycle
              ? `mediana ${duration(stage.cycle.median)} · maior ${duration(stage.cycle.maximum)}`
              : "sem ciclo calculado"
          }
        />
      </div>
      <div className="final-stage-columns">
        <div>
          <h4>De onde vieram</h4>
          {stage.sources.length ? (
            <FlowList items={stage.sources} />
          ) : (
            <p className="muted">Sem etapa anterior no histórico.</p>
          )}
        </div>
        <div>
          <h4>Por responsável</h4>
          <div className="table-scroll">
            <table className="assignee-table">
              <thead>
                <tr>
                  <th>Responsável</th>
                  <th>Negócios</th>
                  <th>Faturamento</th>
                </tr>
              </thead>
              <tbody>
                {people.slice(0, 8).map((person) => (
                  <tr key={person.id ?? "none"}>
                    <td>
                      <strong>{person.name}</strong>
                    </td>
                    <td>{count(person.deals)}</td>
                    <td>{money(person.revenue, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {people.length > 8 && (
            <p className="muted">
              e mais {plural(people.length - 8, "pessoa", "pessoas")}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

// Tabela ao lado da pizza: cada fatia com os números por trás dela.
function PieTable({
  stages,
  model,
  pipeline,
  currency,
  selected,
  onSelect,
}: {
  stages: StageInsight[];
  model: PieModel;
  pipeline: PipelineInsight;
  currency: string;
  selected?: string;
  onSelect: (key: string) => void;
}) {
  const share = new Map(model.slices.map((slice) => [slice.key, slice.share]));
  const tail = model.slices.find((slice) => slice.members);
  const shareOf = (stage: StageInsight) => {
    const own = share.get(stage.key);
    if (own !== undefined) return formatShare(own);
    // Etapa que entrou em "Outras etapas": a parte dela, sobre o total, em %.
    return stage.passages > 0 && stage.average > 0 && tail
      ? formatShare((stage.average / model.total) * 100)
      : "—";
  };
  return (
    <div className="table-scroll">
      <table className="pie-table">
        <thead>
          <tr>
            <th>Etapa</th>
            <th>Tempo médio</th>
            <th>% do tempo</th>
            <th>Mediana</th>
            <th>Maior tempo</th>
            <th>Passagens</th>
            <th>Parados</th>
            <th>Faturamento</th>
            <th>Mais lento</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((stage) => {
            const slowest = stage.assignees[0];
            const has = stage.passages > 0;
            return (
              <tr
                key={stage.key}
                className={stage.key === selected ? "is-selected" : undefined}
                onClick={() => onSelect(stage.key)}
              >
                <td>
                  <button
                    type="button"
                    className="pie-row-button"
                    aria-pressed={stage.key === selected}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(stage.key);
                    }}
                  >
                    <i
                      className={`pie-swatch ${has ? "" : "is-empty"}`}
                      style={
                        has
                          ? { background: model.colors.get(stage.key) }
                          : undefined
                      }
                    />
                    {stage.stage.name}
                  </button>
                </td>
                <td>
                  <strong>{has ? duration(stage.average) : "—"}</strong>
                </td>
                <td>{has ? shareOf(stage) : "—"}</td>
                <td>{has ? duration(stage.median) : "—"}</td>
                <td>{has ? duration(stage.maximum) : "—"}</td>
                <td>{has ? count(stage.passages) : "—"}</td>
                <td>
                  {stage.stalledDeals ? (
                    <span className="status-inline duration-critical">
                      <Pause size={13} aria-hidden />
                      {count(stage.stalledDeals)}
                    </span>
                  ) : (
                    <span className="muted">0</span>
                  )}
                </td>
                <td>{has ? money(stage.revenue, currency) : "—"}</td>
                <td>
                  {has && slowest ? (
                    <>
                      {slowest.name}{" "}
                      <span className="muted">
                        ({shortDuration(slowest.average)})
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th>Soma das etapas</th>
            <th>{duration(model.total)}</th>
            <th>{model.slices.length ? "100,0%" : "—"}</th>
            <td />
            <td />
            <th>{count(pipeline.passages)}</th>
            <th>{count(pipeline.stalledDeals)}</th>
            <td />
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  alert,
}: {
  label: string;
  value: string;
  detail: string;
  alert?: boolean;
}) {
  return (
    <article className="insight-stat">
      <span>{label}</span>
      <strong className={alert ? "duration-critical" : undefined}>
        {alert && <Pause size={16} aria-hidden />}
        {value}
      </strong>
      <small>{detail}</small>
    </article>
  );
}

function RangeLegend() {
  return (
    <div className="range-legend" aria-hidden>
      <span>
        <i className="key-bar" />
        Tempo médio
      </span>
      <span>
        <i className="key-median" />
        Mediana
      </span>
      <span>
        <i className="key-max" />
        Maior tempo
      </span>
    </div>
  );
}

// Uma linha por etapa: barra = média, traço = mediana, ponto = maior tempo.
function RangeChart({
  stages,
  selected,
  onSelect,
}: {
  stages: StageInsight[];
  selected?: string;
  onSelect: (key: string) => void;
}) {
  const tip = useTip();
  const { top, ticks } = durationTicks(
    Math.max(0, ...stages.map((s) => s.maximum)),
  );
  const at = (ms: number) => `${Math.min(100, (ms / top) * 100)}%`;
  return (
    <div className="range-chart chart-frame">
      {stages.map((s) => (
        <button
          type="button"
          key={s.key}
          className={`range-row ${s.key === selected ? "is-selected" : ""}`}
          aria-pressed={s.key === selected}
          aria-label={`${s.stage.name}: ${s.passages ? `média ${duration(s.average)}, mediana ${duration(s.median)}, maior ${duration(s.maximum)}` : "sem passagens no período"}`}
          onClick={() => onSelect(s.key)}
          {...tip.bind(
            <TipRows
              title={s.stage.name}
              rows={
                s.passages
                  ? [
                      ["tempo médio", duration(s.average)],
                      ["mediana", duration(s.median)],
                      ["90% saem em até", duration(s.p90)],
                      ["menor tempo", duration(s.minimum)],
                      ["maior tempo", duration(s.maximum)],
                      [
                        "passagens",
                        `${count(s.passages)} (${count(s.open)} abertas)`,
                      ],
                      ["parados agora", count(s.stalledDeals)],
                    ]
                  : [
                      ["passagens", "nenhuma no período"],
                      ["negócios atuais", count(s.currentDeals)],
                      ["parados agora", count(s.stalledDeals)],
                    ]
              }
            />,
          )}
        >
          <span className="range-label">
            <StageBadge stage={s.stage} />
            <small>
              {plural(s.passages, "passagem", "passagens")} ·{" "}
              {plural(s.deals, "negócio", "negócios")}
            </small>
          </span>
          <span className="range-track">
            {ticks.map((t) => (
              <i className="range-grid" key={t} style={{ left: at(t) }} />
            ))}
            {s.passages > 0 && (
              <>
                <i
                  className="range-whisker"
                  style={{
                    left: at(s.minimum),
                    width: `calc(${at(s.maximum)} - ${at(s.minimum)})`,
                  }}
                />
                <i className="range-bar" style={{ width: at(s.average) }} />
                <i className="range-median" style={{ left: at(s.median) }} />
                <i className="range-max" style={{ left: at(s.maximum) }} />
              </>
            )}
          </span>
          <span className="range-values">
            <strong>{s.passages ? duration(s.average) : "—"}</strong>
            {s.passages ? (
              <>
                <small>mediana {shortDuration(s.median)}</small>
                <small>maior {shortDuration(s.maximum)}</small>
              </>
            ) : (
              <small>sem passagens</small>
            )}
          </span>
        </button>
      ))}
      <div className="range-axis" aria-hidden>
        <span />
        <span className="range-axis-track">
          {ticks.map((t) => (
            <small key={t} style={{ left: at(t) }}>
              {shortDuration(t)}
            </small>
          ))}
        </span>
        <span />
      </div>
      <ChartTip tip={tip.tip} />
    </div>
  );
}

function StageDrill({
  stage,
  currency,
  stalledHours,
}: {
  stage: StageInsight;
  currency: string;
  stalledHours: number;
}) {
  const threshold = stalledHours * HOUR;
  return (
    <section className="insight-section insight-drill">
      <div className="insight-section-heading">
        <h3>
          Etapa selecionada: <StageBadge stage={stage.stage} />
        </h3>
        {stage.vsFunnel !== undefined && (
          <span className="muted">
            {stage.vsFunnel >= 1
              ? `${ratio(stage.vsFunnel)} a média do funil`
              : `${Math.round((1 - stage.vsFunnel) * 100)}% abaixo da média do funil`}
          </span>
        )}
      </div>
      <dl className="drill-figures">
        {(
          [
            ["Tempo médio", stage.passages ? duration(stage.average) : "—"],
            ["Mediana", stage.passages ? duration(stage.median) : "—"],
            ["90% saem em até", stage.passages ? duration(stage.p90) : "—"],
            ["Menor tempo", stage.passages ? duration(stage.minimum) : "—"],
            ["Maior tempo", stage.passages ? duration(stage.maximum) : "—"],
            ["Negócios atuais", count(stage.currentDeals)],
            ["Faturamento que passou", money(stage.revenue, currency)],
            [
              `Valor parado (${stalledHours}h+)`,
              money(stage.stalledRevenue, currency),
            ],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {!stage.passages ? (
        <p className="insight-note">
          Nenhuma passagem com entrada no período. Os negócios atuais e parados
          desta etapa aparecem abaixo.
        </p>
      ) : (
        <div className="drill-grid">
          <div className="drill-card">
            <h4>Distribuição dos tempos</h4>
            <Histogram stage={stage} currency={currency} />
          </div>
          <div className="drill-card">
            <h4>De onde vieram</h4>
            <FlowList items={stage.sources} />
            <h4>Para onde foram</h4>
            {stage.exits.length ? (
              <FlowList items={stage.exits} />
            ) : (
              <p className="muted">Nenhuma saída registrada no período.</p>
            )}
          </div>
        </div>
      )}

      {stage.assignees.length > 0 && (
        <div className="drill-block">
          <h4>Por responsável</h4>
          <AssigneeTable
            rows={stage.assignees}
            currency={currency}
            reference={stage.average}
            referenceLabel="vs média da etapa"
          />
        </div>
      )}

      {stage.slowest.length > 0 && (
        <div className="drill-block">
          <h4>Negócios que mais demoraram nesta etapa</h4>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Negócio</th>
                  <th>Responsável</th>
                  <th>Faturamento</th>
                  <th>Tempo na etapa</th>
                  <th>Situação</th>
                  <th>Entrada</th>
                  <th>Movido por</th>
                </tr>
              </thead>
              <tbody>
                {stage.slowest.map((p) => (
                  <tr key={`${p.deal.id}:${p.enteredAt}`}>
                    <td>
                      <DealLink
                        id={p.deal.id}
                        title={p.deal.title}
                        url={p.deal.url}
                      />
                    </td>
                    <td>{p.deal.assignee}</td>
                    <td>{money(p.deal.opportunity ?? 0, p.deal.currencyId)}</td>
                    <td>
                      <strong>{duration(p.duration)}</strong>
                    </td>
                    <td>
                      {p.current ? (
                        p.duration >= threshold ? (
                          <span className="status-inline duration-critical">
                            <Pause size={13} aria-hidden />
                            Parado na etapa
                          </span>
                        ) : (
                          "Ainda na etapa"
                        )
                      ) : p.next ? (
                        <span className="status-inline">
                          <ArrowRight size={13} aria-hidden />
                          {p.next.name}
                        </span>
                      ) : (
                        "Saiu da etapa"
                      )}
                    </td>
                    <td className="nowrap">{dateTime(p.enteredAt)}</td>
                    <td className="muted">{p.actor ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {stage.stalled.length > 0 && (
        <div className="drill-block">
          <h4>
            Parados nesta etapa agora ({count(stage.stalled.length)} ·{" "}
            {money(stage.stalledRevenue, currency)})
          </h4>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Negócio</th>
                  <th>Responsável</th>
                  <th>Faturamento</th>
                  <th>Parado há</th>
                  <th>Desde</th>
                </tr>
              </thead>
              <tbody>
                {stage.stalled.slice(0, 10).map((row) => (
                  <tr key={row.deal.id}>
                    <td>
                      <DealLink
                        id={row.deal.id}
                        title={row.deal.title}
                        url={row.url}
                      />
                    </td>
                    <td>
                      {stage.assignees.find(
                        (a) => a.id === row.deal.assignedById,
                      )?.name ??
                        row.deal.assignedByName ??
                        (row.deal.assignedById
                          ? `Usuário #${row.deal.assignedById}`
                          : "Sem responsável")}
                    </td>
                    <td>
                      {money(row.deal.opportunity ?? 0, row.deal.currencyId)}
                    </td>
                    <td>
                      <span className="status-inline duration-critical">
                        <Pause size={13} aria-hidden />
                        {duration(row.duration)}
                      </span>
                    </td>
                    <td className="nowrap">{dateTime(row.enteredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {stage.stalled.length > 10 && (
            <p className="insight-note">
              Mostrando os 10 parados há mais tempo. A lista completa fica em
              Parados.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Histogram({
  stage,
  currency,
}: {
  stage: StageInsight;
  currency: string;
}) {
  const tip = useTip();
  const max = Math.max(1, ...stage.buckets.map((b) => b.count));
  return (
    <div className="chart-frame">
      <div
        className="stage-columns histogram"
        role="list"
        aria-label={`Distribuição dos tempos em ${stage.stage.name}`}
      >
        {stage.buckets.map((b) => (
          <div className="stage-column" role="listitem" key={b.label}>
            <span
              className="stage-column-hit"
              tabIndex={0}
              aria-label={`${b.label}: ${plural(b.count, "passagem", "passagens")}`}
              {...tip.bind(
                <TipRows
                  title={b.label}
                  rows={[
                    ["passagens", count(b.count)],
                    ["ainda abertas", count(b.open)],
                    [
                      "do total",
                      `${Math.round((b.count / Math.max(1, stage.passages)) * 100)}%`,
                    ],
                    ["faturamento", money(b.revenue, currency)],
                  ]}
                />,
              )}
            >
              <span className="stage-column-value">
                {b.count ? count(b.count) : ""}
              </span>
              <span className="stage-column-plot">
                <span
                  className="stage-column-bar"
                  style={{ height: `${(b.count / max) * 100}%` }}
                />
              </span>
            </span>
            <span className="stage-column-label">{b.label}</span>
          </div>
        ))}
      </div>
      <ChartTip tip={tip.tip} />
    </div>
  );
}

function FlowList({ items }: { items: FlowItem[] }) {
  const total = items.reduce((sum, i) => sum + i.count, 0);
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <ul className="flow-list">
      {items.slice(0, 6).map((item) => (
        <li key={item.key}>
          <span className="flow-name">
            <i style={{ background: item.color }} />
            {item.label}
          </span>
          <span className="flow-bar">
            <span style={{ width: `${(item.count / max) * 100}%` }} />
          </span>
          <span className="flow-count">
            {count(item.count)}{" "}
            <small>
              {Math.round((item.count / Math.max(1, total)) * 100)}%
            </small>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Compare({ value, reference }: { value: number; reference: number }) {
  if (!reference || !value) return <span className="muted">—</span>;
  const diff = Math.round((value / reference - 1) * 100);
  if (Math.abs(diff) < 5) return <span className="muted">na média</span>;
  return (
    <span className="status-inline">
      {diff > 0 ? (
        <ArrowUpRight size={13} aria-hidden />
      ) : (
        <ArrowDownRight size={13} aria-hidden />
      )}
      {diff > 0 ? `${diff}% mais lento` : `${-diff}% mais rápido`}
    </span>
  );
}

function AssigneeTable({
  rows,
  currency,
  reference,
  referenceLabel,
  funnel = false,
}: {
  rows: AssigneeStat[];
  currency: string;
  reference: number;
  referenceLabel: string;
  funnel?: boolean;
}) {
  if (!rows.length)
    return <p className="muted">Sem responsáveis nas passagens do período.</p>;
  const max = Math.max(1, ...rows.map((r) => r.average));
  return (
    <div className="table-scroll">
      <table className="assignee-table">
        <thead>
          <tr>
            <th>Responsável</th>
            <th>Negócios</th>
            <th>Passagens</th>
            <th>Tempo médio</th>
            <th>{referenceLabel}</th>
            {funnel && <th>Etapa mais lenta</th>}
            <th>Faturamento</th>
            <th>Parados agora</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id ?? "none"}>
              <td>
                <strong>{r.name}</strong>
              </td>
              <td>{count(r.deals)}</td>
              <td>{count(r.passages)}</td>
              <td>
                {r.passages ? (
                  <span className="inline-bar">
                    <span className="bar-track">
                      <span style={{ width: `${(r.average / max) * 100}%` }} />
                    </span>
                    <strong>{duration(r.average)}</strong>
                  </span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                <Compare value={r.average} reference={reference} />
              </td>
              {funnel && (
                <td>
                  {r.slowestStage ? (
                    <>
                      {r.slowestStage.name}{" "}
                      <span className="muted">
                        ({shortDuration(r.slowestStage.average)})
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              )}
              <td>{money(r.revenue, currency)}</td>
              <td>
                {r.stalled ? (
                  <span className="status-inline duration-critical">
                    <Pause size={13} aria-hidden />
                    {count(r.stalled)} · {money(r.stalledRevenue, currency)}
                  </span>
                ) : (
                  <span className="muted">0</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
