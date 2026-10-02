import type { ClientGameState, RNG } from '@/lib/engine';

const FAIL_PRIORITY = { Assassin: 0, Minion: 1, Morgana: 2, Mordred: 3 };

/** Table convention, shared by the live bot and benchmark opponents. Oberon is
 * deliberately absent. Exact ally roles come from the viewer's projection. */
export function designatedSaboteurs(view: ClientGameState, self: string, required: number): string[] {
  const roles = new Map(view.knownPlayers.filter((p) => p.shownAs === 'known-ally').map((p) => [p.playerId, p.role]));
  if (view.selfRole) roles.set(self, view.selfRole);
  const priority = (id: string) => {
    const role = roles.get(id);
    return role && role in FAIL_PRIORITY ? FAIL_PRIORITY[role as keyof typeof FAIL_PRIORITY] : 4;
  };
  return view.players.filter((p) => roles.has(p.id) && priority(p.id) < 4 && view.proposedTeam?.includes(p.id))
    .sort((a, b) => priority(a.id) - priority(b.id) || a.seat - b.seat)
    .slice(0, required).map((p) => p.id);
}

export const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));

export function tally(view: ClientGameState) {
  const good = view.missionResults.filter((m) => m.success).length;
  return { good, evil: view.missionResults.length - good };
}

/** Mission-race equity over the remaining horizon, not an overall win forecast:
 * assassination and future learning are separate policy terms. */
export function raceEquity(good: number, evil: number, success = 0.55): number {
  if (good >= 3) return 1;
  if (evil >= 3) return 0;
  return success * raceEquity(good + 1, evil, success) + (1 - success) * raceEquity(good, evil + 1, success);
}

export function voteTolerance(rejections: number) {
  return 0.1 + Math.min(rejections, 3) * 0.065;
}

/** Bounded rationality: randomize among close alternatives, never arbitrary moves. */
export function chooseNearBest<T extends { score: number }>(values: T[], rng: RNG, temperature: number, band: number): T {
  const best = Math.max(...values.map((value) => value.score));
  const choices = values.filter((value) => value.score >= best - band);
  const weights = choices.map((value) => Math.exp((value.score - best) / Math.max(temperature, 0.001)));
  let remaining = rng.next() * weights.reduce((sum, weight) => sum + weight, 0);
  for (let i = 0; i < choices.length; i++) {
    remaining -= weights[i]!;
    if (remaining <= 0) return choices[i]!;
  }
  return choices.at(-1)!;
}
