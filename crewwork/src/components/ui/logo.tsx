export function Logo({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      {/* White fill with red border */}
      <rect x="4" y="6" width="56" height="42" rx="10" fill="white" stroke="#DC2626" strokeWidth="3.5" />
      {/* Tail with red border */}
      <path d="M14 54 L14 44 Q14 39 19 39 L24 39 L24 50 L14 54Z" fill="white" stroke="#DC2626" strokeWidth="3.5" strokeLinejoin="round" />
      {/* Inner red chat bubble icon */}
      <rect x="18" y="18" width="28" height="20" rx="6" fill="#DC2626" />
      <path d="M25 42 L25 36 Q25 33 28 33 L30 33 L30 40 L25 42Z" fill="#DC2626" />
    </svg>
  )
}
