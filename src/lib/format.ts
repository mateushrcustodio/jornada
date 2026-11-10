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
