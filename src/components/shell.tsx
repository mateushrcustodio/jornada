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
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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

// Tempo (ms) que cada borda da "gota" leva para chegar ao destino. A borda da
// frente chega antes e a de trás vem depois: no meio do caminho a pílula se
// estica e depois se recolhe, como o vidro líquido.
const LEADING_EDGE_MS = 340;
const TRAILING_EDGE_MS = 560;
const STRETCH_MS = 460;

function NavPills({ path }: { path: string }) {
  const navRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const last = useRef<{ left: number; top: number } | null>(null);
  const settle = useRef<number | undefined>(undefined);

  // Posiciona o indicador sobre o link ativo. Mexe direto no DOM (variáveis CSS)
  // para não re-renderizar o menu a cada medição nem precisar de setState.
  const place = useCallback((animate: boolean) => {
    const nav = navRef.current;
    const indicator = indicatorRef.current;
    if (!nav || !indicator) return;
    const link = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (!link) {
      // Fora das abas (ex.: Configurações) o indicador some.
      delete nav.dataset.indicator;
      last.current = null;
      return;
    }
    const left = link.offsetLeft;
    const top = link.offsetTop;
    const right = nav.clientWidth - left - link.offsetWidth;
    const before = last.current;
    const moved =
      before !== null && (before.left !== left || before.top !== top);
    const slide = animate && moved;
    // Indo para a direita a borda direita lidera; indo para a esquerda, a esquerda.
    const rightward = before === null || left > before.left;
    const set = (name: string, value: string) =>
      indicator.style.setProperty(name, value);
    set(
      "--ind-left-ms",
      `${slide ? (rightward ? TRAILING_EDGE_MS : LEADING_EDGE_MS) : 0}ms`,
    );
    set(
      "--ind-right-ms",
      `${slide ? (rightward ? LEADING_EDGE_MS : TRAILING_EDGE_MS) : 0}ms`,
    );
    // O Chrome só inicia a transição de left/right se a duração já estiver
    // aplicada antes de a posição mudar; por isso o estilo é calculado aqui.
    void indicator.offsetWidth;
    set("--ind-left", `${left}px`);
    set("--ind-right", `${right}px`);
    set("--ind-top", `${top}px`);
    set("--ind-height", `${link.offsetHeight}px`);
    last.current = { left, top };
    nav.dataset.indicator = "ready";
    if (slide) {
      indicator.dataset.moving = "true";
      window.clearTimeout(settle.current);
      settle.current = window.setTimeout(() => {
        delete indicator.dataset.moving;
      }, STRETCH_MS);
    }
  }, []);

  // Trocou de aba: desliza até a nova (a primeira medição não anima).
  useLayoutEffect(() => {
    place(true);
  }, [path, place]);

  // Janela, fonte ou layout mudaram: reposiciona sem animar.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const observer = new ResizeObserver(() => place(false));
    observer.observe(nav);
    nav.querySelectorAll("a").forEach((link) => observer.observe(link));
    return () => {
      observer.disconnect();
      window.clearTimeout(settle.current);
    };
  }, [place]);

  return (
    <nav ref={navRef} className="nav-pills" aria-label="Navegação principal">
      <span ref={indicatorRef} className="nav-indicator" aria-hidden="true" />
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
