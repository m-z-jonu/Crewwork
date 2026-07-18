export function Logo({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="8" width="56" height="40" rx="10" fill="#DC2626" />
      <path d="M14 52 L14 42 Q14 38 18 38 L22 38 L22 48 L14 52Z" fill="#DC2626" />
    </svg>
  )
}
