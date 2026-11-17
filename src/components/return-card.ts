"use client";
import { useSyncExternalStore } from "react";

// Card do Bitrix24 de onde o painel completo foi aberto (pela logo da aba do
// card). Fica só na memória desta página: some ao recarregar e não existe
// quando o painel é aberto pelo menu do Bitrix24 (outro carregamento), então o
// botão "Voltar ao card" aparece apenas para quem veio por ali. Segue valendo
// ao trocar de aba do painel e ao abrir um negócio e voltar.
let cardId: number | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function rememberReturnCard(id: number) {
  if (cardId === id) return;
  cardId = id;
  listeners.forEach((listener) => listener());
}

export const useReturnCard = () =>
  useSyncExternalStore(
    subscribe,
    () => cardId,
    () => undefined,
  );
