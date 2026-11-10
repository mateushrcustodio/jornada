"use client";
import { Check, ExternalLink, Link2, Route, ShieldCheck } from "lucide-react";
import Script from "next/script";
import { useState } from "react";
import { useApp } from "./provider";
import { Panel } from "./ui";
declare global {
  interface Window {
    BX24?: { init: (callback: () => void) => void; installFinish: () => void };
  }
}
export function InstallPage() {
  const { demo } = useApp();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [bound, setBound] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  async function install() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setBound(true);
      setMessage(
        "Os dois placements foram registrados. Finalize a instalação para exibi-los no portal.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Não foi possível instalar.");
    } finally {
      setBusy(false);
    }
  }
  function finish() {
    if (!window.BX24 || !sdkReady) {
      setMessage(
        "Abra esta página pelo instalador da aplicação no Bitrix24 para concluir a instalação.",
      );
      return;
    }
    window.BX24.installFinish();
  }
  return (
    <>
      {!demo && (
        <Script
          src="https://api.bitrix24.com/api/v1/"
          strategy="afterInteractive"
          onLoad={() => {
            if (window.self !== window.top)
              window.BX24?.init(() => setSdkReady(true));
          }}
          onError={() =>
            setMessage("O SDK do Bitrix24 não carregou. Verifique sua conexão.")
          }
        />
      )}
      <div className="page-heading">
        <div>
          <h1>Instalação</h1>
          <p>Conecte o Jornada ao Bitrix24 e acompanhe cada etapa.</p>
        </div>
        <span className="settings-emblem">
          <Link2 size={28} />
        </span>
      </div>
      <div className="install-grid">
        <Panel title="Uma integração, dois pontos de vista">
          <div className="install-content">
            <span className="install-logo">
              <Route size={35} />
            </span>
            <h3>Do panorama ao detalhe.</h3>
            <p>
              O painel geral entra no menu do CRM Analytics. A aba Jornada
              aparece no detalhe de cada negócio, com sua própria timeline.
            </p>
            <div className="placement-preview">
              <Check size={17} />
              <div>
                <strong>Visão geral do processo</strong>
                <code>CRM_ANALYTICS_MENU</code>
              </div>
            </div>
            <div className="placement-preview">
              <Check size={17} />
              <div>
                <strong>Jornada dentro do negócio</strong>
                <code>CRM_DEAL_DETAIL_TAB</code>
              </div>
            </div>
            <div className="integration-privacy">
              <ShieldCheck size={17} />
              Consultas sob demanda. Sem banco de dados e sem eventos.
            </div>
          </div>
        </Panel>
        <Panel title="Instalação da aplicação local">
          <ol className="install-steps">
            <li>
              <strong>Publique em um endereço HTTPS</strong>
              <p>
                Configure APP_URL, os domínios permitidos e as credenciais do
                aplicativo no servidor. Desative DEMO_MODE.
              </p>
            </li>
            <li>
              <strong>Crie uma aplicação local no Bitrix24</strong>
              <p>
                Solicite os escopos crm, placement e basic. Configure o handler
                e o instalador conforme o README do projeto.
              </p>
            </li>
            <li>
              <strong>Registre os pontos de entrada</strong>
              <p>
                Abra o instalador pelo portal, autenticado como administrador. O
                botão abaixo registra os dois placements.
              </p>
            </li>
            <li>
              <strong>Conclua e abra a Jornada</strong>
              <p>
                Finalize a instalação e recarregue o Bitrix24 para visualizar o
                menu e a aba.
              </p>
            </li>
          </ol>
          <div className="install-actions">
            <button
              className="button primary"
              onClick={install}
              disabled={busy || demo}
            >
              {busy
                ? "Registrando…"
                : bound
                  ? "Verificar placements"
                  : "Registrar placements"}
            </button>
            {bound && (
              <button className="button" onClick={finish} disabled={!sdkReady}>
                Concluir instalação
              </button>
            )}
            {demo && (
              <p>O registro fica disponível ao conectar uma instalação real.</p>
            )}
            {bound && !sdkReady && (
              <p>Para finalizar, abra o instalador dentro do Bitrix24.</p>
            )}
            {message && (
              <p role="status" className="install-message">
                {message}
              </p>
            )}
          </div>
        </Panel>
      </div>
      <a
        className="documentation-link"
        href="https://apidocs.bitrix24.com/api-reference/widgets/crm/analytics-menu.html"
        target="_blank"
        rel="noreferrer"
      >
        Documentação oficial dos placements
        <ExternalLink size={14} />
      </a>
    </>
  );
}
