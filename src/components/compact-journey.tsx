"use client";
import { ArrowUpRight, Clock3, RefreshCw } from "lucide-react";
import type { JourneyData, Stage } from "@/lib/types";
import { dateTime, duration } from "@/lib/format";
import { isClosed, resolveStage } from "@/lib/calculations";
import { useResource } from "./use-resource";
import { Autopsy } from "./autopsy";
import { Empty, ErrorState, Panel, Skeleton, StageBadge } from "./ui";

// Etapas que ainda não foram percorridas, na ordem do pipeline do negócio.
function futureStages(data: JourneyData, current: Stage) {
  return data.stages
    .filter(
      (stage) =>
        stage.categoryId === current.categoryId && stage.sort > current.sort,
    )
    .sort((a, b) => a.sort - b.sort);
}

export function CompactJourney({ id }: { id: number }) {
  const { data, loading, error, code, refresh } = useResource<JourneyData>(
    `/api/deal/${id}`,
  );
  if (loading) return <Skeleton journey />;
  if (error) return <ErrorState message={error} code={code} retry={refresh} />;
  if (!data) return null;
  const currentStage = resolveStage(data, {
    CATEGORY_ID: data.deal.categoryId,
    STAGE_ID: data.deal.stageId,
  });
  const closed = isClosed(data.deal);
  const max = Math.max(1, ...data.visits.map((v) => v.duration));
  const future = closed ? [] : futureStages(data, currentStage);
  return (
    <div className="journey">
      <div className="journey-heading">
        <div>
          <h1>{data.deal.title}</h1>
          <div className="journey-status">
            <StageBadge stage={currentStage} current />
            <span>{closed ? "Jornada concluída" : "Etapa atual"}</span>
          </div>
        </div>
        <div className="heading-actions">
          {data.url && (
            <a
              href={data.url}
              target="_blank"
              rel="noreferrer"
              className="text-link"
            >
              Abrir no Bitrix24
              <ArrowUpRight size={14} />
            </a>
          )}
          <button
            className="icon-button"
            onClick={refresh}
            aria-label="Atualizar jornada"
            title={`Atualizar jornada · consulta ${dateTime(data.queriedAt)}`}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      {data.warning && (
        <div className="info-banner" role="status">
          <Clock3 size={18} />
          {data.warning}
        </div>
      )}
      {data.visits.length > 0 && (
        <div
          className="track"
          role="img"
          aria-label="Proporção do tempo em cada etapa"
        >
          {data.visits.map((visit) => (
            <span
              key={visit.entry.ID}
              title={`${visit.stage.name} · ${duration(visit.duration)}`}
              style={
                {
                  "--stage-color": visit.stage.color,
                  "--w": Math.max(visit.duration, max * 0.03),
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      )}
      <div className="stat-grid journey-stats">
        <article className="stat-card">
          <div className="stat-top">Etapas percorridas</div>
          <strong className="stat-value">{data.visits.length}</strong>
        </article>
        <article className="stat-card">
          <div className="stat-top">Tempo de jornada</div>
          <strong className="stat-value">{duration(data.totalDuration)}</strong>
        </article>
        <article className="stat-card">
          <div className="stat-top">Última movimentação</div>
          <strong className="stat-value stat-date">
            {data.lastMovement ? dateTime(data.lastMovement) : "Sem registro"}
          </strong>
        </article>
      </div>
      {closed && data.visits.length > 0 && <Autopsy id={id} data={data} />}
      {!data.visits.length ? (
        <Panel title="Histórico de etapas">
          <Empty
            title="A jornada ainda não começou por aqui"
            description="Nenhum histórico de etapas foi retornado para este negócio. Consulte novamente após uma movimentação."
            action={
              <button className="button" onClick={refresh}>
                Atualizar jornada
              </button>
            }
          />
        </Panel>
      ) : (
        <Panel title="Etapas do negócio" className="timeline-panel">
          <ol className="timeline">
            {data.visits.map((visit) => (
              <li
                key={visit.entry.ID}
                className={`timeline-item ${visit.current ? "current" : ""}`}
              >
                <span
                  className="timeline-node"
                  aria-hidden="true"
                  style={
                    {
                      "--stage-color": visit.stage.color,
                    } as React.CSSProperties
                  }
                />
                <div className="timeline-card">
                  <div>
                    <h3>{visit.stage.name}</h3>
                    <div className="timeline-meta">
                      <span>
                        <time dateTime={visit.entry.CREATED_TIME}>
                          {dateTime(visit.entry.CREATED_TIME)}
                        </time>
                      </span>
                      <span>
                        {visit.actor
                          ? `Movido por ${visit.actor}`
                          : "Autoria não disponibilizada pelo Bitrix24"}
                      </span>
                    </div>
                  </div>
                  <div className="timeline-side">
                    {visit.current && (
                      <span className="current-label">
                        {closed ? "Etapa final" : "Você está aqui"}
                      </span>
                    )}
                    <span
                      className="time-pill"
                      title={
                        visit.current && !closed
                          ? "Tempo nesta etapa até a consulta"
                          : "Tempo de permanência"
                      }
                    >
                      {duration(visit.duration)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
            {future.map((stage) => (
              <li className="timeline-pending" key={`future-${stage.id}`}>
                <span className="timeline-node" aria-hidden="true" />
                <div className="timeline-card">
                  <h3>{stage.name}</h3>
                  <span className="pending-label">Pendente</span>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </div>
  );
}
