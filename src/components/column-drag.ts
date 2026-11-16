"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { flushSync } from "react-dom";

// Tempo do deslize final da coluna até a casa de destino (ver globals.css).
const SETTLE_MS = 200;

interface ColumnGesture<K extends string> {
  key: K;
  index: number;
  pointerId: number;
  startX: number;
  lefts: number[];
  widths: number[];
  target: number;
  active: boolean;
  cells: HTMLElement[];
  dx: number;
  frame: number;
}

interface DragState<K extends string> {
  key: K;
  from: number;
  target: number;
  width: number;
}

// Arraste de colunas de uma tabela (Movimentações e Parados). A coluna
// acompanha o ponteiro (transform direto nas células dela, uma vez por quadro)
// e as vizinhas deslizam para abrir espaço. Só a troca de posição atualiza o
// React. `columns` vem de `useColumnOrder`; os cabeçalhos precisam ter
// `data-column` e as células da coluna, o mesmo `data-column`.
export function useColumnDrag<K extends string>(columns: {
  order: readonly K[];
  move: (from: K, to: K) => void;
}) {
  const tableRef = useRef<HTMLTableElement>(null);
  const gesture = useRef<ColumnGesture<K> | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [drag, setDrag] = useState<DragState<K> | null>(null);
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  function startDrag(event: PointerEvent<HTMLElement>, key: K) {
    const table = tableRef.current;
    const target = event.target as HTMLElement;
    if (!table || drag || event.button !== 0 || target.closest(".sort-button"))
      return;
    // Mouse arrasta pelo título inteiro; toque e caneta só pela alça, para a
    // tabela continuar rolando com o dedo.
    if (event.pointerType !== "mouse" && !target.closest(".col-grip")) return;
    const heads = [
      ...table.querySelectorAll<HTMLElement>("thead th[data-column]"),
    ].map((head) => head.getBoundingClientRect());
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      key,
      index: columns.order.indexOf(key),
      pointerId: event.pointerId,
      startX: event.clientX,
      lefts: heads.map((rect) => rect.left),
      widths: heads.map((rect) => rect.width),
      target: columns.order.indexOf(key),
      active: false,
      cells: [],
      dx: 0,
      frame: 0,
    };
  }
  function moveDrag(event: PointerEvent<HTMLElement>) {
    const g = gesture.current;
    const table = tableRef.current;
    if (!g || !table || event.pointerId !== g.pointerId) return;
    const raw = event.clientX - g.startX;
    if (!g.active) {
      // Pequena folga para um clique no título não virar arraste.
      if (Math.abs(raw) < 4) return;
      g.active = true;
      // As células da coluna são movidas direto: sem passar pelo React e sem
      // variável CSS no ancestral (que refaria o estilo da tabela inteira).
      g.cells = [
        ...table.querySelectorAll<HTMLElement>(`[data-column="${g.key}"]`),
      ];
      for (const cell of g.cells) cell.style.transition = "none";
      setDrag({
        key: g.key,
        from: g.index,
        target: g.index,
        width: g.widths[g.index],
      });
    }
    const last = g.lefts.length - 1;
    const min = g.lefts[0] - g.lefts[g.index];
    const max =
      g.lefts[last] + g.widths[last] - (g.lefts[g.index] + g.widths[g.index]);
    g.dx = Math.min(max, Math.max(min, raw));
    // No máximo uma atualização visual por quadro, mesmo com mouse de 1000 Hz.
    if (!g.frame)
      g.frame = requestAnimationFrame(() => {
        g.frame = 0;
        for (const cell of g.cells)
          cell.style.transform = `translate3d(${g.dx}px, 0, 0)`;
      });
    // A coluna ocupa o lugar sobre o qual está o seu centro.
    const center = g.lefts[g.index] + g.widths[g.index] / 2 + g.dx;
    let target = last;
    for (let i = 0; i < last; i += 1)
      if (center < g.lefts[i] + g.widths[i]) {
        target = i;
        break;
      }
    if (target !== g.target) {
      g.target = target;
      setDrag((current) => current && { ...current, target });
    }
  }
  function releaseCells(g: ColumnGesture<K>) {
    for (const cell of g.cells) {
      cell.style.transition = "";
      cell.style.transform = "";
    }
  }
  function endDrag(event: PointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointerId) return;
    gesture.current = null;
    if (!g.active) return;
    cancelAnimationFrame(g.frame);
    // A coluna desliza até a casa de destino e só então a ordem é gravada: as
    // posições já coincidem, então não há salto na troca.
    let offset = 0;
    for (let i = g.index + 1; i <= g.target; i += 1) offset += g.widths[i];
    for (let i = g.target; i < g.index; i += 1) offset -= g.widths[i];
    const animate = !window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
    for (const cell of g.cells) {
      cell.style.transition = animate
        ? `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`
        : "none";
      cell.style.transform = `translate3d(${offset}px, 0, 0)`;
    }
    settleTimer.current = setTimeout(
      () => {
        flushSync(() => {
          if (g.target !== g.index)
            columns.move(g.key, columns.order[g.target]);
          setDrag(null);
        });
        releaseCells(g);
      },
      animate ? SETTLE_MS : 0,
    );
  }
  function cancelDrag() {
    const g = gesture.current;
    gesture.current = null;
    if (g) {
      cancelAnimationFrame(g.frame);
      releaseCells(g);
    }
    setDrag(null);
  }
  // Classe e deslocamento de cada célula (cabeçalho e linhas) da coluna.
  function dragProps(
    key: K,
    index: number,
  ): { className: string; style?: CSSProperties } {
    if (!drag) return { className: "" };
    if (key === drag.key) return { className: "is-dragging col-dragged" };
    const shift =
      index > drag.from && index <= drag.target
        ? -drag.width
        : index < drag.from && index >= drag.target
          ? drag.width
          : 0;
    return {
      className: "col-shift",
      style: { transform: `translate3d(${shift}px, 0, 0)` },
    };
  }
  function keyboardMove(event: KeyboardEvent<HTMLButtonElement>, key: K) {
    const step =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    const target = columns.order[columns.order.indexOf(key) + step];
    if (target) columns.move(key, target);
  }

  return {
    tableRef,
    drag,
    startDrag,
    moveDrag,
    endDrag,
    cancelDrag,
    dragProps,
    keyboardMove,
  };
}
