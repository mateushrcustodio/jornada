import type { NextConfig } from "next";

const domains = (process.env.BITRIX_ALLOWED_DOMAINS || "")
  .split(",")
  .map((d) => d.trim())
  .filter((d) => /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(d));
const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors 'self' ${domains.map((d) => `https://${d}`).join(" ")}`,
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
