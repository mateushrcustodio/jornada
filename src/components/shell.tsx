"use client";
import {
  Activity,
  ArrowUpRight,
  ChartNoAxesCombined,
  ChevronDown,
  CircleHelp,
  Clock3,
  LayoutDashboard,
  Menu,
  Route,
  Settings2,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useApp } from "./provider";
import { DemoNotice } from "./ui";
const navigation = [
  { href: "/dashboard", label: "Visão geral", icon: LayoutDashboard },
  { href: "/dashboard/movements", label: "Movimentações", icon: Activity },
  { href: "/dashboard/stalled", label: "Negócios parados", icon: Clock3 },
  {
    href: "/dashboard/stages",
    label: "Análise de etapas",
    icon: ChartNoAxesCombined,
  },
];
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { demo } = useApp();
  const [open, setOpen] = useState(false);
  const journey = path.startsWith("/deal/");
  const current =
    path === "/settings"
      ? "Configurações"
      : journey
        ? "Jornada do negócio"
        : path === "/install"
          ? "Instalação"
          : navigation.find((n) => n.href === path)?.label || "Visão geral";
  return (
    <div className={`app-shell ${journey ? "journey-shell" : ""}`}>
      <a href="#main-content" className="skip-link">
        Pular para o conteúdo
      </a>
      {open && (
        <button
          className="nav-overlay"
          aria-label="Fechar menu"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <Link
          href="/dashboard"
          className="brand"
          onClick={() => setOpen(false)}
        >
          <span className="brand-symbol">
            <Route size={24} strokeWidth={2} />
          </span>
          <span>
            jornada<span className="brand-crm">CRM</span>
          </span>
        </Link>
        <button
          className="mobile-close icon-button"
          onClick={() => setOpen(false)}
          aria-label="Fechar menu"
        >
          <X size={20} />
        </button>
        <div className="workspace">
          <span className="workspace-avatar">J</span>
          <div>
            <strong>Workspace comercial</strong>
            <span>Inteligência de negócios</span>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">ACOMPANHAMENTO</div>
        <nav aria-label="Navegação principal">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`nav-link ${path === href ? "active" : ""}`}
              aria-current={path === href ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              <Icon size={18} />
              {label}
              {path === href && <span className="active-dot" />}
            </Link>
          ))}
        </nav>
        <div className="nav-label settings-label">PREFERÊNCIAS</div>
        <Link
          href="/settings"
          className={`nav-link ${path === "/settings" ? "active" : ""}`}
          onClick={() => setOpen(false)}
        >
          <Settings2 size={18} />
          Configurações
        </Link>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-symbol">
              <Route size={20} />
            </span>
            <strong>Cada etapa conta.</strong>
            <p>Transforme o histórico em clareza para o seu time.</p>
            <Link href="/install">
              Configurar integração
              <ArrowUpRight size={14} />
            </Link>
          </div>
          <Link className="help-link" href="/install">
            <CircleHelp size={17} />
            Integração e instalação
          </Link>
          <div className="bitrix-signature">
            <span className="status-dot" />
            {demo ? "Ambiente de demonstração" : "Ambiente Bitrix24"}
            <span>v1.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-toggle icon-button"
              aria-label="Abrir menu"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <Menu size={21} />
            </button>
            <span>{journey ? "Negócios" : "CRM Analytics"}</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{current}</strong>
          </div>
          <div className="topbar-right">
            <span className="topbar-label">Jornada CRM</span>
            <span className={`connection-badge ${demo ? "demo" : ""}`}>
              <span />
              {demo ? "Demonstração" : "Bitrix24"}
            </span>
          </div>
        </header>
        {demo && <DemoNotice />}
        <main id="main-content" className="main-content" tabIndex={-1}>
          {children}
        </main>
        <footer className="app-footer">
          <span>
            Jornada CRM <span>·</span> Clareza em cada etapa.
          </span>
          <span>
            Consultas sob demanda <span className="status-dot" />
          </span>
        </footer>
      </div>
    </div>
  );
}
