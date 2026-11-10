"use client";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CircleAlert,
  Inbox,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Stage } from "@/lib/types";
export function StageBadge({
  stage,
  current,
}: {
  stage: Stage;
  current?: boolean;
}) {
  return (
    <span
      className={`stage-badge ${current ? "is-current" : ""}`}
      style={{ "--stage-color": stage.color } as React.CSSProperties}
    >
      <span />
      {stage.name}
    </span>
  );
}
export function Panel({
  title,
  eyebrow,
  children,
  action,
  className = "",
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Empty({
  title = "Nenhuma movimentação encontrada",
  description = "Nenhuma movimentação encontrada para os filtros selecionados.",
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state" role="status">
      <span className="empty-icon">
        <Inbox size={24} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function ErrorState({
  message,
  code,
  retry,
}: {
  message: string;
  code?: string;
  retry: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <CircleAlert size={26} />
      <h2>
        {code === "SESSION_REQUIRED"
          ? "Conecte seu Bitrix24"
          : "Não foi possível concluir a consulta"}
      </h2>
      <p>{message}</p>
      <div className="button-row">
        <button className="button" onClick={retry}>
          <RefreshCw size={16} />
          Tentar novamente
        </button>
        {code === "SESSION_REQUIRED" && (
          <a
            className="button primary"
            href="/api/auth/start"
            target="_blank"
            rel="noreferrer"
          >
            Conectar portal
            <ArrowUpRight size={16} />
          </a>
        )}
      </div>
    </div>
  );
}
export function Skeleton({ journey = false }: { journey?: boolean }) {
  return (
    <div className="loading-state" role="status" aria-label="Carregando dados">
      <span className="sr-only">Consultando dados…</span>
      <div className="stat-grid">
        {Array.from({ length: journey ? 3 : 4 }, (_, i) => (
          <div key={i} className="skeleton skeleton-card" />
        ))}
      </div>
      <div className="skeleton skeleton-panel" />
      <div className="skeleton skeleton-panel short" />
    </div>
  );
}
export function Pagination({
  page,
  total,
  size,
  onChange,
}: {
  page: number;
  total: number;
  size: number;
  onChange: (value: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="pagination">
      <span>
        {total
          ? `${(page - 1) * size + 1}–${Math.min(page * size, total)} de ${total}`
          : "0 resultados"}
      </span>
      <div>
        <button
          className="icon-button"
          aria-label="Página anterior"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ArrowLeft size={16} />
        </button>
        <span>
          Página {page} de {pages}
        </span>
        <button
          className="icon-button"
          aria-label="Próxima página"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
export function DealLink({
  id,
  title,
  url,
}: {
  id: number;
  title: string;
  url?: string;
}) {
  return (
    <div className="deal-link">
      <Link href={`/deal/${id}/journey`}>
        <strong>{title}</strong>
        <span>
          #{id}{" "}
          <span className="link-hint">
            Ver jornada <ArrowRight size={12} />
          </span>
        </span>
      </Link>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="icon-button"
          aria-label={`Abrir negócio ${id} no Bitrix24`}
        >
          <ArrowUpRight size={16} />
        </a>
      )}
    </div>
  );
}
export function DemoNotice() {
  return (
    <div className="demo-notice">
      <Activity size={14} />
      <span>
        <strong>Modo demonstração</strong>
        <span className="demo-detail">
          {" "}
          · Dados ilustrativos para explorar a aplicação.
        </span>
      </span>
    </div>
  );
}
