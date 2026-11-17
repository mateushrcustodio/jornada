// Marca da Jornada (o caminho com dois pontos), usada no menu do painel e no
// atalho da aba do card.
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="64" height="64" rx="16" fill="currentColor" />
      <path
        d="M42 17V35a12 12 0 0 1-12 12H21"
        fill="none"
        stroke="#fff"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="42" cy="16" r="6" fill="#fff" />
      <circle cx="21" cy="47" r="6" fill="#fff" />
    </svg>
  );
}
