/** Fixed vector artwork for the deciding proposal, independent of emoji fonts. */
export function ProposalLimitIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 16H6a2 2 0 0 1-2-2v-3a8 8 0 0 1 16 0v3a2 2 0 0 1-2 2h-2v5H8Z" />
      <circle cx="8.5" cy="11" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="11" r="1.5" fill="currentColor" stroke="none" />
      <path d="m12 14-1 2h2Z" fill="currentColor" stroke="none" />
      <path d="M11 18v3m2-3v3" />
    </svg>
  );
}
