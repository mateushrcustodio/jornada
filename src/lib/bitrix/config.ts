import "server-only";
import { BitrixError } from "./errors";
export function allowedDomains() {
  return (process.env.BITRIX_ALLOWED_DOMAINS || "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}
export function validateDomain(domain: string) {
  const normalized = domain.toLowerCase();
  if (
    !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(normalized) ||
    !allowedDomains().includes(normalized)
  )
    throw new BitrixError(
      "INVALID_DOMAIN",
      "Portal não autorizado na configuração da aplicação.",
      403,
    );
  return normalized;
}
export function appUrl() {
  const url = new URL(process.env.APP_URL || "http://localhost:3000");
  if (
    process.env.NODE_ENV === "production" &&
    url.protocol !== "https:" &&
    url.hostname !== "localhost"
  )
    throw new BitrixError("CONFIGURATION", "Configure APP_URL com HTTPS.", 503);
  return url.origin;
}
export function credentials() {
  const clientId = process.env.BITRIX_CLIENT_ID;
  const clientSecret = process.env.BITRIX_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    throw new BitrixError(
      "CONFIGURATION",
      "Configure as credenciais OAuth da aplicação Bitrix24 no servidor.",
      503,
    );
  return { clientId, clientSecret };
}
export function isDemo() {
  return process.env.DEMO_MODE === "true";
}
