"use client";
import { useState } from "react";
import type { ReactNode } from "react";

// Dica flutuante (tooltip) compartilhada pelos gráficos da aba Etapas.
// A posição é sempre relativa ao `.chart-frame` mais próximo da marca.
export interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

export function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  // Mostra a dica num ponto (já relativo ao quadro), sem sair dele pelos lados.
  const place = (frame: DOMRect, x: number, y: number, content: ReactNode) =>
    setTip({
      x: Math.min(Math.max(x, 90), Math.max(90, frame.width - 90)),
      y,
      content,
    });
  const show = (target: Element, content: ReactNode) => {
    const box = target.closest(".chart-frame")?.getBoundingClientRect();
    if (!box) return;
    // Nas colunas e no funil, a dica nasce no topo da barra (e não do alvo inteiro).
    const anchor =
      target.querySelector(".stage-column-bar, .funnel-bar") ?? target;
    const rect = anchor.getBoundingClientRect();
    place(
      box,
      rect.left - box.left + rect.width / 2,
      rect.top - box.top,
      content,
    );
  };
  const bind = (content: ReactNode) => ({
    onPointerEnter: (e: React.PointerEvent<Element>) =>
      show(e.currentTarget, content),
    onPointerLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent<Element>) => show(e.currentTarget, content),
    onBlur: () => setTip(null),
  });
  return { tip, bind, place, clear: () => setTip(null) };
}

export function ChartTip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div
      className="chart-tip"
      role="tooltip"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.content}
    </div>
  );
}

export function TipRows({
  title,
  rows,
}: {
  title: string;
  rows: [string, ReactNode][];
}) {
  return (
    <>
      <span className="chart-tip-title">{title}</span>
      {rows.map(([label, value]) => (
        <span className="chart-tip-row" key={label}>
          <strong>{value}</strong>
          <span>{label}</span>
        </span>
      ))}
    </>
  );
}
