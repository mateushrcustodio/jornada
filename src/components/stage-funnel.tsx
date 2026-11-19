"use client";
import { useState } from "react";
import {
  FUNNEL_LABELS,
  FUNNEL_OUTCOMES,
  type FunnelOutcome,
} from "@/lib/funnel";
import type { StageInsight, StageInsights } from "@/lib/stage-insights";
import type { StageStatus } from "@/lib/types";
import { ChartTip, TipRows, useTip } from "./chart-tip";
import { PipelineTabs } from "./stage-time-chart";
import { Empty, Panel, StageBadge } from "./ui";

const count = (value: number) => value.toLocaleString("pt-BR");
const percent = (value: number) => `${Math.round(value * 100)}%`;

// Texto de cada resultado ("3 avançaram (60%)") para a dica e para leitores de tela.
function outcomeRows(stage: StageInsight): [string, string][] {
  const { funnel } = stage;
  return FUNNEL_OUTCOMES.filter((outcome) => funnel[outcome] > 0).map(
    (outcome) => [
      FUNNEL_LABELS[outcome],
      `${count(funnel[outcome])} (${percent(funnel[outcome] / funnel.entries)})`,
    ],
  );
}

function rateLabel(stage: StageInsight) {
  const { funnel } = stage;
  if (!funnel.entries) return "sem entradas";
  if (funnel.advanceRate === undefined) return "ninguém saiu";
  return `${percent(funnel.advanceRate)} avançam`;
}

// ---------- Funil de conversão (aba Etapas) ----------
// Uma linha por etapa em andamento, na ordem do funil. A barra mostra quantas
// vezes os negócios entraram na etapa no período e, dentro dela, para onde cada
// entrada foi em seguida. Usa só o que o painel já trouxe.
export function StageFunnelPanel({
  insights,
  stageStatus,
}: {
  insights: StageInsights;
  stageStatus?: StageStatus;
}) {
  const [pipelineId, setPipelineId] = useState<number>();
  const tip = useTip();
  const pipeline =
    insights.pipelines.find((p) => p.id === pipelineId) ??
    insights.pipelines[0];
  const stages = pipeline?.stages.filter((s) => !s.final) ?? [];
  const measured = stages.filter((s) => s.funnel.entries > 0);
  const max = Math.max(1, ...stages.map((s) => s.funnel.entries));
  const present = FUNNEL_OUTCOMES.filter((outcome) =>
    stages.some((s) => s.funnel[outcome] > 0),
  );

  // Etapa que mais perde: maior parte das saídas indo para perda.
  const worst = measured
    .filter((s) => s.funnel.lost > 0)
    .sort(
      (a, b) =>
        b.funnel.lost / b.funnel.left - a.funnel.lost / a.funnel.left ||
        b.funnel.lost - a.funnel.lost,
    )[0];
  const anyLeft = measured.some((s) => s.funnel.left > 0);

  return (
    <Panel title="Conversão no funil" className="funnel-panel">
      {stageStatus === "closed" ? (
        <Empty
          title="O funil usa as etapas em andamento"
          description='Escolha "Em andamento" ou "Em andamento + finalizados" em Tipo de etapa para ver a conversão entre as etapas.'
        />
      ) : !pipeline || !measured.length ? (
        <Empty
          title="Sem entradas para mostrar"
          description="Não há entradas em etapas em andamento nos filtros selecionados."
        />
      ) : (
        <>
          <PipelineTabs
            insights={insights}
            value={pipeline.id}
            onChange={setPipelineId}
          />
          <p className="stage-time-headline">
            {worst ? (
              <>
                <strong>{worst.stage.name}</strong> é onde mais se perde:{" "}
                {count(worst.funnel.lost)} de {count(worst.funnel.left)} saídas
                da etapa foram para perda (
                {percent(worst.funnel.lost / worst.funnel.left)}).
              </>
            ) : anyLeft ? (
              "Nenhuma saída das etapas em andamento terminou em perda no período."
            ) : (
              "Ninguém saiu das etapas ainda: os negócios continuam onde entraram."
            )}
          </p>
          <div className="funnel-legend">
            {present.map((outcome: FunnelOutcome) => (
              <span key={outcome}>
                <i className={`funnel-key funnel-${outcome}`} />
                {FUNNEL_LABELS[outcome]}
              </span>
            ))}
          </div>
          <div className="funnel-chart chart-frame">
            <div
              className="funnel-list"
              role="list"
              aria-label={`Conversão por etapa, ${pipeline.name}, na ordem do funil`}
            >
              {stages.map((s) => {
                const { funnel } = s;
                const rows = outcomeRows(s);
                return (
                  <div
                    key={s.key}
                    className="funnel-row"
                    role="listitem"
                    tabIndex={0}
                    aria-label={`${s.stage.name}: ${
                      funnel.entries
                        ? `${count(funnel.entries)} entradas, ${rows
                            .map(([label, value]) => `${label} ${value}`)
                            .join(", ")}. ${rateLabel(s)}`
                        : "sem entradas no período"
                    }`}
                    {...tip.bind(
                      <TipRows
                        title={s.stage.name}
                        rows={
                          funnel.entries
                            ? [
                                ["entradas no período", count(funnel.entries)],
                                ...rows,
                                [
                                  "avanço (dos que saíram)",
                                  funnel.advanceRate === undefined
                                    ? "—"
                                    : percent(funnel.advanceRate),
                                ],
                              ]
                            : [["entradas no período", "nenhuma"]]
                        }
                      />,
                    )}
                  >
                    <span className="funnel-label">
                      <StageBadge stage={s.stage} />
                    </span>
                    <span className="funnel-track">
                      {funnel.entries > 0 && (
                        <span
                          className="funnel-bar"
                          style={{
                            width: `${Math.max(2, (funnel.entries / max) * 100)}%`,
                          }}
                        >
                          {FUNNEL_OUTCOMES.filter(
                            (outcome) => funnel[outcome] > 0,
                          ).map((outcome) => (
                            <i
                              key={outcome}
                              className={`funnel-seg funnel-${outcome}`}
                              style={{ flexGrow: funnel[outcome] }}
                            />
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="funnel-values">
                      <strong>{funnel.entries ? count(funnel.entries) : "—"}</strong>
                      <small>{rateLabel(s)}</small>
                    </span>
                  </div>
                );
              })}
            </div>
            <ChartTip tip={tip.tip} />
          </div>
          <p className="funnel-note">
            Cada entrada na etapa, dentro do período, conta uma vez, e o destino
            é a movimentação seguinte do negócio. &quot;Avançam&quot; é a parte
            dos que já saíram da etapa que foi para uma etapa à frente ou para
            ganho; quem ainda está na etapa não entra nessa conta.
          </p>
        </>
      )}
    </Panel>
  );
}
