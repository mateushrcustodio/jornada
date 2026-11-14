export function duration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}min`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
export function dateTime(value: string, long = false) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: long ? "long" : "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}
export function periodRange(
  period: string,
  now = new Date(),
  from?: string,
  to?: string,
) {
  const end = new Date(now);
  let start = new Date(now);
  if (period === "custom") {
    // Os filtros representam dias no fuso do portal/protótipo, UTC−03:00.
    start = new Date(`${from}T00:00:00-03:00`);
    return {
      from: start.toISOString(),
      to: new Date(`${to}T23:59:59.999-03:00`).toISOString(),
    };
  }
  if (period === "today") {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    start = new Date(`${day}T00:00:00-03:00`);
  } else
    start = new Date(
      now.getTime() -
        ({ "24h": 1, "7d": 7, "30d": 30 }[period] ?? 7) * 86400000,
    );
  return { from: start.toISOString(), to: end.toISOString() };
}
// Valor do negócio (faturamento) na moeda do próprio negócio; sem moeda
// reconhecida, mostra só o número.
export function money(value: number | undefined, currency?: string) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency && /^[A-Za-z]{3}$/.test(currency) ? currency : "BRL",
    }).format(value);
  } catch {
    return value.toLocaleString("pt-BR");
  }
}
// Lê o valor digitado no filtro de faturamento: "10000", "10.000", "10.000,50",
// "1500.5" e "R$ 2.500". Vazio vale `undefined` (sem limite); texto que não é
// número, ou negativo, vale `null` (inválido).
export function parseMoney(text: string): number | undefined | null {
  const cleaned = text.replace(/R\$|\s/gi, "");
  if (!cleaned) return undefined;
  let normalized = cleaned;
  if (cleaned.includes(","))
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned))
    normalized = cleaned.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) && value <= 1e13 ? value : null;
}
