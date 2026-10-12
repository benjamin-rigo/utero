/** The utero mark (the user's logo), drawn in the current text colour. */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" role="img" aria-label="utero" className={className}>
      <path fill="currentColor"
        d="M200 200H0V0H75C75 30.6093 51.9631 57.167 40.318 85.4746C37.2076 93.0354 35.4922 101.317 35.4922 110C35.4922 145.627 64.3733 174.508 100 174.508C135.627 174.508 164.508 145.627 164.508 110C164.508 101.317 162.792 93.0354 159.682 85.4746C148.037 57.167 125 30.6093 125 0H200V200Z" />
    </svg>
  )
}
