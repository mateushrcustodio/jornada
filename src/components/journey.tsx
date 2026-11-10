"use client";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Clock3,
  Flag,
  GitBranch,
  RefreshCw,
  Route,
  Timer,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import type { JourneyData } from "@/lib/types";
import { dateTime, duration } from "@/lib/format";
import { isClosed, resolveStage } from "@/lib/calculations";
import { useResource } from "./use-resource";
import { Empty, ErrorState, Panel, Skeleton, StageBadge } from "./ui";
export function Journey({ id }: { id: number }) {
  const { data, loading, error, code, refresh } = useResource<JourneyData>(
    `/api/deal/${id}`,
  );
  if (loading)
    return (
      <>
        <div className="page-kicker">JORNADA DO NEGÓCIO · #{id}</div>
        <Skeleton journey />
      </>
    );
  if (error) return <ErrorState message={error} code={code} retry={refresh} />;
  if (!data) return null;
  const currentStage = resolveStage(data, {
    CATEGORY_ID: data.deal.categoryId,
    STAGE_ID: data.deal.stageId,
  });
  const closed = isClosed(data.deal);
  const max = Math.max(1, ...data.visits.map((v) => v.duration));
  return (
    <>
      <Link className="back-link" href="/dashboard">
        <ArrowLeft size={15} />
        Voltar à visão geral
      </Link>
      <div className="page-heading journey-heading">
        <div>
          <div className="page-kicker">
            <span />
            JORNADA DO NEGÓCIO · #{id}
          </div>
          <h1>{data.deal.title}</h1>
          <div className="journey-status">
            <StageBadge stage={currentStage} current />
            <span>{closed ? "Jornada concluída" : "Etapa atual"}</span>
          </div>
        </div>
        <div className="heading-actions">
          <button className="button" onClick={refresh}>
            <RefreshCw size={15} />
            Atualizar jornada
          </button>
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
          <span className="last-query">
            Consulta: {dateTime(data.queriedAt)}
          </span>
        </div>
      </div>
      {data.warning && (
        <div className="info-banner" role="status">
          <Clock3 size={18} />
          {data.warning}
        </div>
      )}
      <div className="stat-grid journey-stats">
        <article className="stat-card">
          <div className="stat-top">
            <span>Etapas percorridas</span>
            <GitBranch size={18} />
          </div>
          <strong className="stat-value">
            {data.visits.length.toString().padStart(2, "0")}
          </strong>
          <span className="stat-detail">
            incluindo retornos a etapas anteriores
          </span>
        </article>
        <article className="stat-card">
          <div className="stat-top">
            <span>Tempo total da jornada</span>
            <Timer size={18} />
          </div>
          <strong className="stat-value">{duration(data.totalDuration)}</strong>
          <span className="stat-detail">
            {closed
              ? "da primeira à última entrada"
              : "desde a primeira entrada registrada"}
          </span>
        </article>
        <article className="stat-card">
          <div className="stat-top">
            <span>Última movimentação</span>
            <Clock3 size={18} />
          </div>
          <strong className="stat-value stat-date">
            {data.lastMovement ? dateTime(data.lastMovement) : "Sem registro"}
          </strong>
          <span className="stat-detail">
            {data.lastMovement
              ? currentStage.name
              : "O histórico ainda está vazio"}
          </span>
        </article>
      </div>
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
        <div className="journey-grid">
          <Panel
            title="Cada etapa dessa história"
            eyebrow="LINHA DO TEMPO"
            action={
              <span className="count-badge">
                {data.visits.length} registros
              </span>
            }
            className="timeline-panel"
          >
            <ol className="timeline">
              {data.visits.map((visit, i) => (
                <li
                  key={visit.entry.ID}
                  className={`timeline-item ${visit.current ? "current" : ""}`}
                  style={
                    {
                      "--stage-color": visit.stage.color,
                    } as React.CSSProperties
                  }
                >
                  <span className="timeline-node">
                    {visit.current ? (
                      closed ? (
                        <Flag size={15} />
                      ) : (
                        <span />
                      )
                    ) : (
                      <Check size={14} />
                    )}
                  </span>
                  <div className="timeline-card">
                    <div className="timeline-card-top">
                      <div>
                        <span className="timeline-step">
                          ETAPA {String(i + 1).padStart(2, "0")}
                        </span>
                        <h3>{visit.stage.name}</h3>
                      </div>
                      {visit.current && (
                        <span className="current-label">
                          {closed ? "Etapa final" : "Você está aqui"}
                        </span>
                      )}
                    </div>
                    <div className="timeline-meta">
                      <span>
                        <Clock3 size={14} />
                        <time dateTime={visit.entry.CREATED_TIME}>
                          {dateTime(visit.entry.CREATED_TIME, true)}
                        </time>
                      </span>
                      <span>
                        <UserRound size={14} />
                        {visit.actor
                          ? `Movido por ${visit.actor}`
                          : "Autoria não disponibilizada pelo Bitrix24"}
                      </span>
                    </div>
                    <div className="timeline-duration">
                      <span>
                        <Timer size={14} />
                        <strong>{duration(visit.duration)}</strong>
                        {visit.current && !closed
                          ? "nesta etapa até a consulta"
                          : "de permanência"}
                      </span>
                      {visit.current && !closed && (
                        <span className="live-label">
                          <span />
                          Em andamento
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            <div className="timeline-end">
              <Route size={15} />
              {closed
                ? "Toda jornada deixa uma história."
                : "A próxima etapa está por vir."}
            </div>
          </Panel>
          <div className="journey-aside">
            <Panel
              title="O tempo em perspectiva"
              eyebrow="COMPARATIVO POR PASSAGEM"
            >
              <div className="journey-bars">
                {data.visits.map((v, i) => (
                  <div key={v.entry.ID}>
                    <div className="journey-bar-label">
                      <span>
                        <span
                          className="mini-dot"
                          style={{ background: v.stage.color }}
                        />
                        {v.stage.name}
                        <span className="visit-index">{i + 1}</span>
                      </span>
                      <strong>{duration(v.duration)}</strong>
                    </div>
                    <div className="bar-track">
                      <span
                        style={{
                          width: `${(v.duration / max) * 100}%`,
                          background: v.stage.color,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="panel-footnote">
                Os retornos aparecem como novas passagens.
              </div>
            </Panel>
            <div className="journey-note">
              <span className="note-symbol">
                <Route size={24} />
              </span>
              <h3>O caminho também importa.</h3>
              <p>
                Uma visão clara do histórico ajuda a entender o ritmo e o
                próximo momento de cada negociação.
              </p>
              <span>Dados consultados sob demanda.</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
