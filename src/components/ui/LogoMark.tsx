export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
      fill="none"
    >
      <circle cx="16" cy="16" r="10.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="2.5" fill="currentColor" />
      <line x1="16" y1="1" x2="16" y2="7" stroke="currentColor" strokeWidth="1.5" />
      <line x1="16" y1="25" x2="16" y2="31" stroke="currentColor" strokeWidth="1.5" />
      <line x1="1" y1="16" x2="7" y2="16" stroke="currentColor" strokeWidth="1.5" />
      <line x1="25" y1="16" x2="31" y2="16" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
