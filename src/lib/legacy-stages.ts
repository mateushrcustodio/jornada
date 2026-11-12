// Etapas que já foram apagadas ou recriadas no Bitrix24. O histórico do card
// guarda o ID antigo, mas o Bitrix24 não devolve mais o nome dessa etapa; este
// mapa devolve o nome para que o ID cru não apareça na tela.
// Chave: `${categoryId}:${STAGE_ID}`. Basta acrescentar uma linha por etapa.
export const LEGACY_STAGE_NAMES: Record<string, string> = {
  "49:C49:UC_J36A0V": "Converter Negócio",
};
