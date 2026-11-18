"use client";
import { ArrowLeft, Layers2, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { BrandMark } from "./brand";
import { useApp } from "./provider";
import { useReturnCard } from "./return-card";

const navigation = [
  { href: "/dashboard", label: "Visão geral" },
  { href: "/dashboard/movements", label: "Movimentações" },
  { href: "/dashboard/stalled", label: "Parados" },
  { href: "/dashboard/stages", label: "Etapas" },
];
const transparencyKey = "jornada-crm.reduce-transparency";

function NavPills({ path }: { path: string }) {
  const container = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  const activeIndex = navigation.findIndex(({ href }) => href === path);

  useLayoutEffect(() => {
    const nav = container.current;
    if (!nav) return;
    function measure() {
      const link = nav?.querySelectorAll<HTMLElement>(".nav-link")[activeIndex];
      setBox(link ? { left: link.offsetLeft, width: link.offsetWidth } : null);
    }
    measure();
    setReady(true);
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [activeIndex]);

  // A animação só começa depois da primeira posição, para a pílula não "voar" ao carregar.
  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  return (
    <nav
      ref={container}
      className={`nav-pills ${ready ? "has-indicator" : ""}`}
      aria-label="Navegação principal"
    >
      <span
        className={`nav-indicator ${animate ? "animate" : ""}`}
        aria-hidden="true"
        style={{
          width: box?.width ?? 0,
          transform: `translateX(${box?.left ?? 0}px)`,
          opacity: box ? 1 : 0,
        }}
      />
      {navigation.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={`nav-link ${path === href ? "active" : ""}`}
          aria-current={path === href ? "page" : undefined}
        >
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
      <div className="card-shell">
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
      className={overview ? "app-shell overview-shell" : "app-shell"}
      data-reduced-transparency={(overview && reduceTransparency) || undefined}
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
          {overview && (
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
          )}
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
