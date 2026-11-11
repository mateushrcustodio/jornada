"use client";
import { useEffect, useRef, useState } from "react";

// Respostas recentes ficam em memória na aba do navegador. Trocar de aba do
// painel (Visão geral, Movimentações, Parados, Etapas) remonta o componente;
// com o cache, a mesma consulta aparece na hora em vez de ir ao Bitrix24 de
// novo. "Atualizar" sempre ignora o cache.
const memory = new Map<string, { data: unknown; at: number }>();
const MAX_ENTRIES = 30;
function remember(key: string, data: unknown) {
  memory.delete(key);
  memory.set(key, { data, at: Date.now() });
  while (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value!);
}
function recall<T>(key: string, cacheMs: number): T | undefined {
  const entry = memory.get(key);
  return entry && cacheMs > 0 && Date.now() - entry.at < cacheMs
    ? (entry.data as T)
    : undefined;
}
export function clearResourceCache() {
  memory.clear();
}

export function useResource<T>(
  url: string,
  body?: string,
  enabled = true,
  cacheMs = 0,
) {
  const key = `${url}\n${body ?? ""}`;
  const [state, setState] = useState<{
    data?: T;
    loading: boolean;
    error?: string;
    code?: string;
  }>(() => {
    const cached = enabled ? recall<T>(key, cacheMs) : undefined;
    return cached !== undefined
      ? { data: cached, loading: false }
      : { loading: true };
  });
  const [revision, setRevision] = useState(0);
  const handledRevision = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const forced = revision !== handledRevision.current;
    handledRevision.current = revision;
    const controller = new AbortController();
    async function load() {
      const cached = forced ? undefined : recall<T>(key, cacheMs);
      if (cached !== undefined) {
        setState({ data: cached, loading: false });
        return;
      }
      setState((previous) => ({ data: previous.data, loading: true }));
      try {
        const response = await fetch(url, {
          method: body ? "POST" : "GET",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body,
          signal: controller.signal,
          cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok) {
          console.error("[Jornada] Falha na API", {
            url,
            status: response.status,
            statusText: response.statusText,
            payload: result,
          });
          throw Object.assign(
            new Error(result.error || "Não foi possível consultar os dados."),
            { code: result.code },
          );
        }
        if (cacheMs > 0) remember(key, result);
        if (!controller.signal.aborted)
          setState({ data: result, loading: false });
      } catch (error) {
        if (!controller.signal.aborted)
          console.error("[Jornada] Erro ao consultar recurso", {
            url,
            message: error instanceof Error ? error.message : error,
          });
        if (!controller.signal.aborted)
          setState({
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : "Não foi possível consultar os dados.",
            code: (error as { code?: string }).code,
          });
      }
    }
    void load();
    return () => controller.abort();
  }, [url, body, key, revision, enabled, cacheMs]);
  return { ...state, refresh: () => setRevision((n) => n + 1) };
}
