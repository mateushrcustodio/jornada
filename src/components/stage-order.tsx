"use client";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Filter } from "lucide-react";
import { useSyncExternalStore } from "react";
import { isStageOrder, type StageOrder } from "@/lib/stage-order";

// ---------- Escolha da ordem (lembrada neste navegador) ----------
const STORAGE_KEY = "jornada:stage-list-order";
const DEFAULT_ORDER: StageOrder = "desc";
let memory: StageOrder | null = null;
const listeners = new Set<() => void>();
function readOrder(): StageOrder {
  if (memory) return memory;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isStageOrder(stored) ? stored : DEFAULT_ORDER;
  } catch {
    return DEFAULT_ORDER;
  }
}
export function useStageOrder(): [StageOrder, (order: StageOrder) => void] {
  const order = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readOrder,
    () => DEFAULT_ORDER,
  );
  const change = (next: StageOrder) => {
    memory = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Sem armazenamento (iframe restrito): vale só nesta sessão.
    }
    listeners.forEach((listener) => listener());
  };
  return [order, change];
}

const OPTIONS = [
  { value: "desc", label: "Decrescente", icon: ArrowDownWideNarrow },
  { value: "asc", label: "Crescente", icon: ArrowUpNarrowWide },
  { value: "funnel", label: "Funil", icon: Filter },
] as const;

// Mesmo visual do seletor Colunas / Pizza (classe mode-toggle).
export function StageOrderToggle({
  order,
  onChange,
}: {
  order: StageOrder | undefined;
  onChange: (order: StageOrder) => void;
}) {
  return (
    <div
      className="mode-toggle"
      role="group"
      aria-label="Ordem das etapas"
      title={
        order === "funnel"
          ? "Na ordem do funil, da primeira à última etapa"
          : undefined
      }
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={order === value}
          onClick={() => onChange(value)}
        >
          <Icon size={14} aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}
