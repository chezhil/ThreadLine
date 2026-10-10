export function BrandMark({ className = "h-8 w-8" }: { className?: string }) {
  // Woven-thread mark: warp lines crossed by a weft, in the brand navy.
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="4" fill="var(--brand)" />
      <path d="M9 7v18M16 7v18M23 7v18" stroke="#a8b8ff" strokeWidth="2.2" strokeLinecap="square" />
      <path d="M5 16c3.5-3 7.5-3 11 0s7.5 3 11 0" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}
