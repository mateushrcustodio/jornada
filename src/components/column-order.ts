"use client";
import { useCallback, useEffect, useState } from "react";

// Ordem das colunas de uma tabela, guardada neste navegador. Só vale uma ordem
// salva que contenha exatamente as colunas atuais; qualquer outra volta ao padrão.
export function useColumnOrder<K extends string>(
  storageKey: string,
  defaults: readonly K[],
) {
  const [order, setOrder] = useState<K[]>(() => [...defaults]);
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved: unknown = JSON.parse(
          localStorage.getItem(storageKey) ?? "null",
        );
        if (
          Array.isArray(saved) &&
          saved.length === defaults.length &&
          new Set(saved).size === defaults.length &&
          saved.every((key) => (defaults as readonly string[]).includes(key))
        )
          setOrder(saved as K[]);
      } catch {
        /* Armazenamento indisponível: ordem padrão. */
      }
    });
  }, [storageKey, defaults]);
  const move = useCallback(
    (from: K, to: K) => {
      setOrder((current) => {
        const source = current.indexOf(from);
        const target = current.indexOf(to);
        if (source < 0 || target < 0 || source === target) return current;
        const next = [...current];
        next.splice(source, 1);
        next.splice(target, 0, from);
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* A ordem vale só nesta sessão. */
        }
        return next;
      });
    },
    [storageKey],
  );
  const reset = useCallback(() => {
    setOrder([...defaults]);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* Nada a limpar. */
    }
  }, [defaults, storageKey]);
  return { order, move, reset };
}
