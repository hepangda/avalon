/**
 * Default seat-name fallback. When a host leaves a roster seat blank, it is
 * filled with a plain "Player N" (1-based seat number). This is the
 * locale-neutral last resort used server-side; the client fills blanks with the
 * localized "玩家 N" / "Player N" before submitting, so normal play shows the
 * user's language.
 */
export function fallbackSeatName(seatIndex0: number): string {
  return `Player ${seatIndex0 + 1}`;
}
