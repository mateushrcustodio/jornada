"use client";
import { Check, Clock3, Flag, RefreshCw, Route, UserRound } from "lucide-react";
import type { JourneyData, Stage, Visit } from "@/lib/types";
import { dateTime, duration } from "@/lib/format";
import { isClosed, resolveStage } from "@/lib/calculations";
import { useResource } from "./use-resource";
import { Empty, ErrorState, Skeleton } from "./ui";

function futureStages(data: JourneyData, current: Stage) {
  return data.stages
    .filter((stage) => stage.categoryId === current.categoryId && stage.sort > current.sort)
    .sort((a, b) => a.sort - b.sort);
}

function stepStatus(visit: Visit, closed: boolean) {
  if (visit.current) return closed ? "final" : "current";
  return "done";
}

export function CompactJourney({ id }: { id: number }) {
  const resource = useResource<JourneyData>(`/api/deal/${id}`);
  if (resource.loading) return <Skeleton journey />;
  if (resource.error) return <ErrorState message={resource.error} code={resource.code} retry={resource.refresh} />;
  const data = resource.data;
  if (!data) return null;
  const current = resolveStage(data, { CATEGORY_ID: data.deal.categoryId, STAGE_ID: data.deal.stageId });
  const closed = isClosed(data.deal);
  const future = futureStages(data, current);
  const max = Math.max(1, ...data.visits.map((visit) => visit.duration));
  const steps = [
    ...data.visits.map((visit) => ({ kind: "visit" as const, visit })),
    ...future.map((stage) => ({ kind: "future" as const, stage })),
  ];
  return (
    <section className="card-journey" aria-label={`Jornada do negócio ${data.deal.title}`}>
      <header className="card-journey-header">
        <div className="card-journey-brand">
          <span className="card-journey-logo"><Route size={22} /></span>
          <div><strong>Jornada</strong><span>Histórico de etapas do negócio</span></div>
        </div>
        <div className="card-deal-title journey-heading"><h1>{data.deal.title}</h1><span>Negócio #{data.deal.id}</span></div>
        <div className="card-journey-actions">
          <span className="card-query">Consulta: {dateTime(data.queriedAt)}</span>
          <button className="card-refresh" onClick={resource.refresh} aria-label="Atualizar jornada">
            <RefreshCw size={17} />
          </button>
        </div>
      </header>
      <div className="card-journey-rule" />
      {data.warning && <div className="card-warning"><Clock3 size={16} />{data.warning}</div>}
      {!data.visits.length ? (
        <Empty title="Este negócio ainda não tem histórico" description="Nenhum histórico de etapas foi retornado para este negócio. O Bitrix24 não retornou movimentações para este card." action={<button className="button" onClick={resource.refresh}>Atualizar jornada</button>} />
      ) : (
        <div className="card-journey-layout">
          <div className="card-timeline-column">
            <div className="card-section-heading"><span>HISTÓRICO DE ETAPAS</span><strong>{data.visits.length} movimentações</strong></div>
            <ol className="card-timeline">
              {steps.map((step) => {
                if (step.kind === "future") return (
                  <li className="card-timeline-item pending" key={`future-${step.stage.id}`}>
                    <span className="card-timeline-node" aria-hidden="true" />
                    <div className="card-timeline-content">
                      <div><strong>{step.stage.name}</strong><span className="card-status-pill pending-pill">Pendente</span></div>
                      <span className="card-timeline-date">—</span>
                    </div>
                  </li>
                );
                const visit = step.visit;
                const status = stepStatus(visit, closed);
                return (
                  <li className={`card-timeline-item timeline-item ${status}`} key={visit.entry.ID} style={{ "--stage-color": visit.stage.color } as React.CSSProperties}>
                    <span className="card-timeline-node" aria-hidden="true">{status === "done" ? <Check size={14} /> : status === "final" ? <Flag size={14} /> : <span />}</span>
                    <div className="card-timeline-content">
                      <div><strong>{visit.stage.name}</strong><span className={`card-status-pill ${status === "current" ? "current-pill" : "done-pill"}`}>{status === "current" ? <><span className="sr-only">Você está aqui. </span>Atual</> : status === "final" ? "Concluída" : "Concluída"}</span></div>
                      <span className="card-timeline-date"><time dateTime={visit.entry.CREATED_TIME}>{dateTime(visit.entry.CREATED_TIME, true)}</time></span>
                      <span className="card-timeline-actor"><UserRound size={13} />{visit.actor ? `Movido por ${visit.actor}` : "Responsável não informado"}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
          <aside className="card-info-panel">
            <div className="card-section-heading"><span>INFORMAÇÕES DO CARD</span></div>
            <dl className="card-info-list">
              <div><dt>Negócio</dt><dd>#{data.deal.id}</dd></div>
              <div><dt>Etapa atual</dt><dd>{current.name}</dd></div>
              <div><dt>Pipeline</dt><dd>{data.pipelines.find((pipeline) => pipeline.id === data.deal.categoryId)?.name || "Não informado"}</dd></div>
              <div><dt>Tempo total</dt><dd>{duration(data.totalDuration)}</dd></div>
              <div><dt>Última movimentação</dt><dd>{data.lastMovement ? dateTime(data.lastMovement, true) : "Sem registro"}</dd></div>
            </dl>
            <div className="card-duration-block">
              <div className="card-section-heading"><span>TEMPO POR ETAPA</span></div>
              <div className="card-duration-list">
                {data.visits.map((visit) => <div key={`bar-${visit.entry.ID}`}><div><span>{visit.stage.name}</span><strong>{duration(visit.duration)}</strong></div><span className="card-duration-track"><i style={{ width: `${Math.max(3, (visit.duration / max) * 100)}%`, background: visit.stage.color }} /></span></div>)}
              </div>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
