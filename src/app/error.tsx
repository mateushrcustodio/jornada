"use client";
import { ErrorState } from "@/components/ui";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <ErrorState
      message="A página encontrou um erro inesperado. Tente carregar novamente."
      retry={reset}
    />
  );
}
