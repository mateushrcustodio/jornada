"use client";
import { Check, Copy, Send } from "lucide-react";
import { useMemo, useState } from "react";
import type { JourneyData } from "@/lib/types";
import {
  autopsyText,
  buildAutopsy,
  outcomeLabel,
  paceSentence,
  type Benchmark,
} from "@/lib/autopsy";
import { dateTime, duration } from "@/lib/format";
import { useResource } from "./use-resource";
import { Panel, StageBadge } from "./ui";

// Em iframes sem permissão para a API de área de transferência, cai para o método antigo.
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand("copy");
    area.remove();
    return done;
  }
}

type Notice = { tone: "ok" | "error"; text: string } | undefined;

export function Autopsy({ id, data }: { id: number; data: JourneyData }) {
  const benchmark = useResource<Benchmark | null>(`/api/deal/${id}/benchmark`);
  const autopsy = useMemo(
    () => buildAutopsy(data, benchmark.data),
    [data, benchmark.data],
  );
  const [notice, setNotice] = useState<Notice>();
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  if (!autopsy) return null;
  const text = autopsyText(data, autopsy);
  const comparing = benchmark.loading && !benchmark.data;
  const pace = paceSentence(autopsy);

  async function copy() {
    const ok = await copyText(text);
    setNotice(
      ok
        ? { tone: "ok", text: "Texto copiado no formato do Bitrix24." }
        : { tone: "error", text: "Não foi possível copiar o texto." },
    );
  }
  async function publish() {
    setPublishing(true);
    setNotice(undefined);
    try {
      const response = await fetch(`/api/deal/${id}/autopsy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Não foi possível publicar.");
      setPublished(true);
      setNotice({
        tone: "ok",
        text: result.demo
          ? "Publicação simulada: no modo demonstração nada é enviado ao Bitrix24."
          : "Autópsia publicada na timeline do negócio.",
      });
    } catch (error) {
      setNotice({
        tone: "error",
        text:
          error instanceof Error ? error.message : "Não foi possível publicar.",
      });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <Panel
      title="Autópsia do negócio"
      className="autopsy-panel"
      action={
        <div className="autopsy-actions">
          <button className="button" onClick={copy}>
            <Copy size={15} />
            Copiar texto
          </button>
          <button
            className="button primary"
            onClick={publish}
            disabled={publishing || published}
          >
            {published ? <Check size={15} /> : <Send size={15} />}
            {published ? "Publicada" : "Publicar na timeline"}
          </button>
        </div>
      }
    >
      <dl className="autopsy">
        <div>
          <dt>Resultado</dt>
          <dd>
            {autopsy.finalStage.name.trim().toLowerCase() !==
              outcomeLabel(autopsy).toLowerCase() && (
              <StageBadge stage={autopsy.finalStage} />
            )}
            <span className={`outcome ${autopsy.outcome}`}>
              {outcomeLabel(autopsy)}
            </span>
            <span className="autopsy-sub">
              em {duration(autopsy.total)} · {autopsy.stepsBefore}{" "}
              {autopsy.stepsBefore === 1 ? "etapa" : "etapas"} antes do
              fechamento
            </span>
          </dd>
        </div>
        <div>
          <dt>Etapas puladas</dt>
          <dd>
            {autopsy.skipped.length ? (
              <span className="autopsy-chips">
                {autopsy.skipped.map((s) => (
                  <StageBadge key={s.id} stage={s} />
                ))}
              </span>
            ) : (
              <span className="autopsy-none">Nenhuma</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Voltas de etapa</dt>
          <dd>
            {autopsy.returns.length ? (
              <ul className="autopsy-list">
                {autopsy.returns.map((r) => (
                  <li key={r.at}>
                    {r.from.name} → {r.to.name}
                    <span className="autopsy-sub">{dateTime(r.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="autopsy-none">Nenhuma</span>
            )}
          </dd>
        </div>
        {autopsy.longest && (
          <div>
            <dt>Onde mais demorou</dt>
            <dd>
              <StageBadge stage={autopsy.longest.stage} />
              <strong>{duration(autopsy.longest.duration)}</strong>
              <span className="autopsy-sub">
                {Math.round(autopsy.longest.share * 100)}% do ciclo
                {autopsy.longest.typical !== undefined &&
                  ` · típico ${duration(autopsy.longest.typical)}`}
              </span>
            </dd>
          </div>
        )}
        <div>
          <dt>Comparação</dt>
          <dd>
            {comparing ? (
              <span className="autopsy-none">
                Comparando com negócios já fechados…
              </span>
            ) : pace ? (
              <span className={`autopsy-pace ${autopsy.pace?.label}`}>
                {pace}
              </span>
            ) : (
              <span className="autopsy-none">
                Poucos negócios{" "}
                {autopsy.outcome === "won" ? "ganhos" : "perdidos"} neste funil
                para comparar.
              </span>
            )}
          </dd>
        </div>
      </dl>
      <p className="autopsy-note" role="status" data-tone={notice?.tone}>
        {notice?.text ??
          "A autoria das mudanças depende do que o Bitrix24 registra; a ficha não aponta responsáveis."}
      </p>
    </Panel>
  );
}
