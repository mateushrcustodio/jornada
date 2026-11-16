"use client";
import { ChartColumnBig, ChartPie } from "lucide-react";
import { useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { PieSlice } from "@/lib/pie";
import { ChartTip, TipRows, useTip } from "./chart-tip";

// ---------- Escolha do tipo de gráfico (lembrada neste navegador) ----------
export type ChartMode = "bars" | "pie";
const STORAGE_KEY = "jornada:stage-chart-mode";
let memory: ChartMode | null = null;
const listeners = new Set<() => void>();
function readMode(): ChartMode {
  if (memory) return memory;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "pie" ? "pie" : "bars";
  } catch {
    return "bars";
  }
}
// O painel e a janela de detalhes usam a mesma escolha.
export function useChartMode(): [ChartMode, (mode: ChartMode) => void] {
  const mode = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readMode,
    () => "bars" as const,
  );
  const change = (next: ChartMode) => {
    memory = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Sem armazenamento (iframe restrito): vale só nesta sessão.
    }
    listeners.forEach((listener) => listener());
  };
  return [mode, change];
}

export function ModeToggle({
  mode,
  onChange,
  pieDisabled,
}: {
  mode: ChartMode;
  onChange: (mode: ChartMode) => void;
  pieDisabled?: boolean;
}) {
  return (
    <div className="mode-toggle" role="group" aria-label="Tipo de gráfico">
      <button
        type="button"
        aria-pressed={mode === "bars"}
        onClick={() => onChange("bars")}
      >
        <ChartColumnBig size={14} aria-hidden />
        Colunas
      </button>
      <button
        type="button"
        aria-pressed={mode === "pie"}
        disabled={pieDisabled}
        title={
          pieDisabled
            ? "A pizza precisa de pelo menos 2 etapas com tempo medido."
            : undefined
        }
        onClick={() => onChange("pie")}
      >
        <ChartPie size={14} aria-hidden />
        Pizza
      </button>
    </div>
  );
}

export const formatShare = (share: number) =>
  `${share.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

// ---------- Pizza ----------
export type PieView = PieSlice & {
  // Valor já formatado (ex.: "3d 13h") e linhas extras da dica.
  display: string;
  rows: [string, ReactNode][];
};

const W = 300;
const H = 268;
const CX = W / 2;
const CY = 134;
const R = 96;
const point = (angle: number, radius: number) => [
  CX + radius * Math.cos(angle),
  CY + radius * Math.sin(angle),
];
const fixed = (n: number) => n.toFixed(2);

export function PieChart({
  slices,
  empty = [],
  selected,
  onSelect,
  legend = true,
  label,
}: {
  slices: PieView[];
  // Etapas sem tempo medido: aparecem na legenda, sem fatia.
  empty?: { key: string; label: string }[];
  selected?: string;
  onSelect?: (key: string) => void;
  legend?: boolean;
  label: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tip = useTip();
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  // Começa às 12h e segue no sentido horário, na ordem do funil.
  const arcs = slices.map((slice, i) => {
    const before = slices
      .slice(0, i)
      .reduce((sum, other) => sum + other.value, 0);
    const from = -Math.PI / 2 + (before / total) * Math.PI * 2;
    const to = from + (slice.value / total) * Math.PI * 2;
    return { slice, from, to, mid: (from + to) / 2 };
  });
  const activate = (arc: (typeof arcs)[number]) => {
    setHover(arc.slice.key);
    const svg = svgRef.current;
    const frame = svg?.closest(".chart-frame")?.getBoundingClientRect();
    if (!svg || !frame) return;
    const box = svg.getBoundingClientRect();
    const k = box.width / W;
    const [x, y] = point(arc.mid, R);
    tip.place(
      frame,
      box.left - frame.left + x * k,
      box.top - frame.top + y * k,
      <TipRows
        title={arc.slice.label}
        rows={[["do total", formatShare(arc.slice.share)], ...arc.slice.rows]}
      />,
    );
  };
  const deactivate = () => {
    setHover(null);
    tip.clear();
  };
  const pick = (slice: PieView) => (slice.members ? undefined : onSelect);
  // A fatia em foco é desenhada por último, para o contorno não ficar escondido.
  const drawn = [...arcs].sort(
    (a, b) =>
      Number(a.slice.key === selected || a.slice.key === hover) -
      Number(b.slice.key === selected || b.slice.key === hover),
  );
  return (
    <div className={`pie-layout ${legend ? "" : "no-legend"}`}>
      <div className="chart-frame pie-frame">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className={`pie-chart ${hover ? "has-hover" : ""}`}
          role="group"
          aria-label={label}
        >
          {drawn.map((arc) => {
            const { slice } = arc;
            const [x0, y0] = point(arc.from, R);
            const [x1, y1] = point(arc.to, R);
            const full = arcs.length === 1;
            const d = full
              ? `M${CX - R},${CY} a${R},${R} 0 1 0 ${2 * R},0 a${R},${R} 0 1 0 ${-2 * R},0Z`
              : `M${CX},${CY} L${fixed(x0)},${fixed(y0)} A${R},${R} 0 ${arc.to - arc.from > Math.PI ? 1 : 0} 1 ${fixed(x1)},${fixed(y1)} Z`;
            const onClick = pick(slice);
            return (
              <path
                key={slice.key}
                d={d}
                className={`pie-slice ${slice.key === selected ? "is-selected" : ""} ${slice.key === hover ? "is-hover" : ""}`}
                style={{ fill: slice.color }}
                tabIndex={0}
                role={onClick ? "button" : "img"}
                aria-label={`${slice.label}: ${slice.display}, ${formatShare(slice.share)} do tempo somado`}
                onPointerEnter={() => activate(arc)}
                onPointerLeave={deactivate}
                onFocus={() => activate(arc)}
                onBlur={deactivate}
                onClick={onClick ? () => onClick(slice.key) : undefined}
                onKeyDown={
                  onClick
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onClick(slice.key);
                        }
                      }
                    : undefined
                }
              />
            );
          })}
          {/* Percentuais fora da fatia, em tinta de texto (o contraste não depende da cor). */}
          {arcs.map((arc) => {
            if (arc.slice.share < 4 || arcs.length === 1) return null;
            const [x, y] = point(arc.mid, R + 10);
            const cos = Math.cos(arc.mid);
            return (
              <text
                key={arc.slice.key}
                x={x}
                y={y + 4}
                textAnchor={
                  cos > 0.25 ? "start" : cos < -0.25 ? "end" : "middle"
                }
                className="pie-label"
                aria-hidden
              >
                {formatShare(arc.slice.share)}
              </text>
            );
          })}
        </svg>
        <ChartTip tip={tip.tip} />
      </div>
      {legend && (
        <ul className="pie-legend" aria-label="Legenda da pizza">
          {slices.map((slice) => {
            const onClick = pick(slice);
            const inside = (
              <>
                <i className="pie-swatch" style={{ background: slice.color }} />
                <span className="pie-legend-name">{slice.label}</span>
                <strong>{slice.display}</strong>
                <span className="pie-legend-share">
                  {formatShare(slice.share)}
                </span>
              </>
            );
            const cls = `pie-legend-row ${slice.key === selected ? "is-selected" : ""} ${slice.key === hover ? "is-hover" : ""}`;
            return (
              <li key={slice.key}>
                {onClick ? (
                  <button
                    type="button"
                    className={cls}
                    onClick={() => onClick(slice.key)}
                    onPointerEnter={() => setHover(slice.key)}
                    onPointerLeave={() => setHover(null)}
                  >
                    {inside}
                  </button>
                ) : (
                  <span
                    className={cls}
                    onPointerEnter={() => setHover(slice.key)}
                    onPointerLeave={() => setHover(null)}
                  >
                    {inside}
                  </span>
                )}
              </li>
            );
          })}
          {empty.map((stage) => (
            <li key={stage.key}>
              <span className="pie-legend-row is-empty">
                <i className="pie-swatch is-empty" />
                <span className="pie-legend-name">{stage.label}</span>
                <span className="pie-legend-none">sem passagens</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
