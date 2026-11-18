"use client";
import { useSyncExternalStore } from "react";
import {
  DEFAULT_STAGE_STATUS,
  STAGE_STATUSES,
  STAGE_STATUS_LABELS,
  isStageStatus,
} from "@/lib/stage-status";
import type { StageStatus } from "@/lib/types";

// ---------- Escolha da situação (lembrada neste navegador) ----------
const STORAGE_KEY = "jornada:stage-status";
let memory: StageStatus | null = null;
const listeners = new Set<() => void>();
function readStatus(): StageStatus {
  if (memory) return memory;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isStageStatus(stored) ? stored : DEFAULT_STAGE_STATUS;
  } catch {
    return DEFAULT_STAGE_STATUS;
  }
}
export function useStageStatus(): [StageStatus, (next: StageStatus) => void] {
  const status = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readStatus,
    () => DEFAULT_STAGE_STATUS,
  );
  const change = (next: StageStatus) => {
    memory = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Sem armazenamento (iframe restrito): vale só nesta sessão.
    }
    listeners.forEach((listener) => listener());
  };
  return [status, change];
}

// Mesmo visual dos seletores Colunas / Pizza e da ordem das etapas.
export function StageStatusToggle({
  status,
  onChange,
}: {
  status: StageStatus;
  onChange: (status: StageStatus) => void;
}) {
  return (
    <div
      className="mode-toggle stage-status-toggle"
      role="group"
      aria-label="Situação dos negócios"
    >
      {STAGE_STATUSES.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={status === value}
          onClick={() => onChange(value)}
        >
          {STAGE_STATUS_LABELS[value]}
        </button>
      ))}
    </div>
  );
}
