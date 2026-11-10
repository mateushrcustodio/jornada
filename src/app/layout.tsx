import type { Metadata } from "next";
import { AppProvider } from "@/components/provider";
import { Shell } from "@/components/shell";
import "./globals.css";
export const metadata: Metadata = {
  title: "Jornada CRM · Inteligência em cada etapa",
  description:
    "Acompanhe a jornada dos negócios, identifique gargalos e transforme o histórico do seu CRM em decisões.",
};
export const dynamic = "force-dynamic";
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>
        <AppProvider demo={process.env.DEMO_MODE === "true"}>
          <Shell>{children}</Shell>
        </AppProvider>
      </body>
    </html>
  );
}
