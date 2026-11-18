"use client";
import {
  ArrowLeft,
  ArrowLeftRight,
  Layers2,
  LayoutGrid,
  ListTree,
  Pause,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { BrandMark } from "./brand";
import { useApp } from "./provider";
import { useReturnCard } from "./return-card";

const navigation = [
  { href: "/dashboard", label: "Visão geral", icon: LayoutGrid },
  {
    href: "/dashboard/movements",
    label: "Movimentações",
    icon: ArrowLeftRight,
  },
  { href: "/dashboard/stalled", label: "Parados", icon: Pause },
  { href: "/dashboard/stages", label: "Etapas", icon: ListTree },
];
const transparencyKey = "jornada-crm.reduce-transparency";

function NavPills({ path }: { path: string }) {
  return (
    <nav className="nav-pills" aria-label="Navegação principal">
      {navigation.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="nav-link"
          aria-current={path === href ? "page" : undefined}
        >
          <Icon size={15} aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { demo } = useApp();
  const returnCard = useReturnCard();
  const overview = path === "/dashboard";
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(transparencyKey) === "true";
      if (saved) queueMicrotask(() => setReduceTransparency(true));
    } catch {
      // O iframe pode restringir o armazenamento local.
    }
  }, []);

  function toggleTransparency() {
    const next = !reduceTransparency;
    setReduceTransparency(next);
    try {
      localStorage.setItem(transparencyKey, String(next));
    } catch {
      // A escolha ainda vale enquanto a aplicação estiver aberta.
    }
  }

  // Dentro do card do Bitrix24 só o conteúdo da aba aparece, sem navegação.
  if (path.startsWith("/deal/"))
    return (
      <div
        className="jornada-shell card-shell"
        data-reduced-transparency={reduceTransparency || undefined}
      >
        <a href="#main-content" className="skip-link">
          Pular para o conteúdo
        </a>
        <main id="main-content" className="card-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    );
  return (
    <div
      className={`jornada-shell app-shell${overview ? " overview-shell" : ""}`}
      data-reduced-transparency={reduceTransparency || undefined}
    >
      <a href="#main-content" className="skip-link">
        Pular para o conteúdo
      </a>
      <header className="topnav">
        <Link href="/dashboard" className="brand">
          <BrandMark className="brand-mark" />
          Jornada
        </Link>
        <NavPills path={path} />
        <div className="topnav-right">
          {demo && <span className="demo-chip">Modo demonstração</span>}
          <button
            type="button"
            className="icon-button transparency-toggle"
            aria-label="Sempre reduzir transparência"
            aria-pressed={reduceTransparency}
            title="Sempre reduzir transparência"
            onClick={toggleTransparency}
          >
            <Layers2 size={18} aria-hidden="true" />
          </button>
          <Link
            href="/settings"
            className="icon-button"
            aria-label="Configurações"
            aria-current={path === "/settings" ? "page" : undefined}
          >
            <Settings2 size={18} />
          </Link>
        </div>
      </header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        {/* Só quando o painel foi aberto pela logo da aba do card. */}
        {returnCard !== undefined && (
          <Link href={`/deal/${returnCard}/journey`} className="back-link">
            <ArrowLeft size={16} />
            Voltar ao card
          </Link>
        )}
        {children}
      </main>
    </div>
  );
}
