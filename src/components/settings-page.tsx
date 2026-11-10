"use client";
import {
  Check,
  CheckCheck,
  Clock3,
  Info,
  RotateCcw,
  Save,
  Settings2,
} from "lucide-react";
import { useState } from "react";
import type { Catalog, Settings } from "@/lib/types";
import { DEFAULT_SETTINGS, settingsSchema } from "@/lib/settings";
import { stageKey } from "@/lib/calculations";
import { useApp } from "./provider";
import { useResource } from "./use-resource";
import { ErrorState, Panel, Skeleton } from "./ui";
export function SettingsPage() {
  const { ready, settings } = useApp();
  const resource = useResource<Catalog>("/api/catalog");
  if (!ready || resource.loading) return <Skeleton />;
  if (resource.error)
    return (
      <ErrorState
        message={resource.error}
        code={resource.code}
        retry={resource.refresh}
      />
    );
  return resource.data ? (
    <SettingsForm initial={settings} catalog={resource.data} />
  ) : null;
}
function SettingsForm({
  initial,
  catalog,
}: {
  initial: Settings;
  catalog: Catalog;
}) {
  const { save } = useApp();
  const [draft, setDraft] = useState<Settings>(initial);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!settingsSchema.safeParse(draft).success) {
      setSuccess(false);
      setMessage("Defina um limite válido entre 1 e 8.760 horas.");
      return;
    }
    const result = save(draft);
    setSuccess(result);
    setMessage(
      result
        ? "Preferências salvas neste navegador. As próximas consultas já usam essas configurações."
        : "O navegador não permitiu salvar as preferências. Habilite o armazenamento local e tente novamente.",
    );
  }
  function togglePipeline(id: number) {
    setDraft((s) => ({
      ...s,
      monitoredPipelines: s.monitoredPipelines.includes(id)
        ? s.monitoredPipelines.filter((x) => x !== id)
        : [...s.monitoredPipelines, id],
    }));
  }
  function toggleStage(key: string) {
    setDraft((s) => ({
      ...s,
      ignoredStages: s.ignoredStages.includes(key)
        ? s.ignoredStages.filter((x) => x !== key)
        : [...s.ignoredStages, key],
    }));
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Configurações</h1>
          <p>Ajuste os critérios de acompanhamento dos seus negócios.</p>
        </div>
        <span className="settings-emblem">
          <Settings2 size={28} />
        </span>
      </div>
      <div className="info-banner">
        <Info size={18} />
        <span>
          As preferências ficam apenas neste navegador. Elas personalizam a
          análise e não alteram dados no Bitrix24.
        </span>
      </div>
      <form onSubmit={submit} className="settings-form">
        <div className="settings-grid">
          <Panel title="Ritmo de acompanhamento">
            <div className="form-fields">
              <label className="form-field">
                <span>Quando um negócio está parado?</span>
                <p>Considere o tempo contínuo na etapa atual.</p>
                <div className="input-suffix">
                  <Clock3 size={17} />
                  <input
                    type="number"
                    min="1"
                    max="8760"
                    step="1"
                    required
                    aria-label="Limite de horas para card parado"
                    value={draft.stalledHours || ""}
                    onChange={(e) =>
                      setDraft((s) => ({
                        ...s,
                        stalledHours: Number(e.target.value),
                      }))
                    }
                  />
                  <span>horas</span>
                </div>
                <small>72 horas equivalem a 3 dias corridos.</small>
              </label>
              <label className="form-field">
                <span>Período padrão do painel</span>
                <p>Intervalo usado ao abrir uma nova tela do painel.</p>
                <select
                  value={draft.defaultPeriod}
                  onChange={(e) =>
                    setDraft((s) => ({
                      ...s,
                      defaultPeriod: e.target
                        .value as Settings["defaultPeriod"],
                    }))
                  }
                >
                  <option value="today">Hoje</option>
                  <option value="24h">Últimas 24 horas</option>
                  <option value="7d">Últimos 7 dias</option>
                  <option value="30d">Últimos 30 dias</option>
                </select>
              </label>
            </div>
          </Panel>
          <Panel title="Indicadores em destaque">
            <div className="toggle-list">
              {Object.entries({
                movements: [
                  "Movimentações",
                  "Mudanças de etapa registradas no período.",
                ],
                active: [
                  "Negócios em andamento",
                  "Quantidade de negócios atualmente abertos.",
                ],
                stalled: [
                  "Precisam de atenção",
                  "Negócios que atingiram o limite de tempo.",
                ],
                average: [
                  "Tempo médio por etapa",
                  "Permanência média por passagem.",
                ],
              }).map(([key, labels]) => (
                <label className="toggle-row" key={key}>
                  <span>
                    <strong>{labels[0]}</strong>
                    <small>{labels[1]}</small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={
                      draft.indicators[key as keyof Settings["indicators"]]
                    }
                    onChange={(e) =>
                      setDraft((s) => ({
                        ...s,
                        indicators: {
                          ...s.indicators,
                          [key]: e.target.checked,
                        },
                      }))
                    }
                    aria-label={labels[0]}
                  />
                  <span className="toggle-visual" />
                </label>
              ))}
            </div>
          </Panel>
          <Panel
            title="Pipelines monitorados"
            action={
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  setDraft((s) => ({ ...s, monitoredPipelines: [] }))
                }
              >
                Todos
                <CheckCheck size={15} />
              </button>
            }
          >
            <p className="form-intro">
              Sem seleção, todos os pipelines acessíveis serão considerados.
            </p>
            <div className="checkbox-list">
              {catalog.pipelines.length ? (
                catalog.pipelines.map((p) => (
                  <label key={p.id}>
                    <input
                      type="checkbox"
                      checked={draft.monitoredPipelines.includes(p.id)}
                      onChange={() => togglePipeline(p.id)}
                    />
                    <span className="checkbox-custom">
                      <Check size={13} />
                    </span>
                    <strong>{p.name}</strong>
                    <span className="muted">#{p.id}</span>
                  </label>
                ))
              ) : (
                <p className="form-intro">
                  Nenhum pipeline disponível para este usuário.
                </p>
              )}
            </div>
          </Panel>
          <Panel title="Etapas ignoradas">
            <p className="form-intro">
              As etapas selecionadas não aparecem nos indicadores do painel. O
              histórico do card continua completo.
            </p>
            <div className="checkbox-list stages-checkboxes">
              {catalog.stages.map((s) => {
                const key = stageKey(s.categoryId, s.id);
                return (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={draft.ignoredStages.includes(key)}
                      onChange={() => toggleStage(key)}
                    />
                    <span className="checkbox-custom">
                      <Check size={13} />
                    </span>
                    <span
                      className="mini-dot"
                      style={{ background: s.color }}
                    />
                    <span>
                      <strong>{s.name}</strong>
                      <small>
                        {
                          catalog.pipelines.find((p) => p.id === s.categoryId)
                            ?.name
                        }
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
          </Panel>
        </div>
        <div className="settings-save">
          <button
            type="button"
            className="button"
            onClick={() => {
              setDraft(DEFAULT_SETTINGS);
              setMessage(
                "Padrões restaurados no formulário. Clique em salvar para aplicar.",
              );
              setSuccess(false);
            }}
          >
            <RotateCcw size={15} />
            Restaurar padrões
          </button>
          <button type="submit" className="button primary">
            <Save size={16} />
            Salvar preferências
          </button>
        </div>
        {message && (
          <div
            className={`save-message ${success ? "success" : ""}`}
            role="status"
          >
            {success && <Check size={16} />}
            {message}
          </div>
        )}
      </form>
    </>
  );
}
