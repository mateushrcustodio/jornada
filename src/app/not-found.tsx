import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty-state">
      <span className="eyebrow">404 · PÁGINA NÃO ENCONTRADA</span>
      <h1>Esse caminho ainda não existe.</h1>
      <p>Volte ao painel para acompanhar seus negócios.</p>
      <Link className="button primary" href="/dashboard">
        Voltar ao painel
      </Link>
    </div>
  );
}
