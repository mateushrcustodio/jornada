"use client";
import { useEffect, useState } from "react";
export function useResource<T>(url: string, body?: string, enabled = true) {
  const [state, setState] = useState<{
    data?: T;
    loading: boolean;
    error?: string;
    code?: string;
  }>({ loading: true });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    async function load() {
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
        if (!response.ok)
          throw Object.assign(
            new Error(result.error || "Não foi possível consultar os dados."),
            { code: result.code },
          );
        if (!controller.signal.aborted)
          setState({ data: result, loading: false });
      } catch (error) {
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
  }, [url, body, revision, enabled]);
  return { ...state, refresh: () => setRevision((n) => n + 1) };
}
