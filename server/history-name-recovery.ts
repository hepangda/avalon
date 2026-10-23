import type { GameRecord } from './game-records';

const normalized = (name: string) => name.normalize('NFKC').trim().toLocaleLowerCase('en-US');

/** Operator-run historical recovery, not an automatic identity rule for future games.
 * Requires complete settlement rosters and a unique one-name/one-account solution in this batch. */
export function inferHistoricalNames(records: GameRecord[], verifiedNames: Array<{ name: string; account: string }>): Map<string, string> {
  const candidates = new Map<string, Set<string>>();
  for (const game of records) {
    if (game.replay.players.some(p => p.isBot || /^Bot [1-9]\d*$/i.test(p.name.trim()))) continue;
    const names = game.replay.players.map(p => normalized(p.name));
    const accounts = new Set(game.participants ?? []);
    if (accounts.size !== names.length || new Set(names).size !== names.length) continue;
    for (const name of names) {
      const previous = candidates.get(name);
      candidates.set(name, new Set([...accounts].filter(a => !previous || previous.has(a))));
    }
  }
  const known = new Map<string, string>();
  for (const { name, account } of verifiedNames) {
    const key = normalized(name);
    if (known.has(key) && known.get(key) !== account) throw new Error('Conflicting verified name');
    known.set(key, account);
  }
  for (const [name, account] of known) {
    if (!candidates.has(name)) continue;
    if (!candidates.get(name)!.has(account)) throw new Error('Verified name conflicts with historical attendance');
    candidates.set(name, new Set([account]));
  }
  const resolved = new Map<string, string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, options] of candidates) {
      if (resolved.has(name)) continue;
      for (const account of resolved.values()) options.delete(account);
      if (!options.size) throw new Error('Historical names are inconsistent; manual review required');
      if (options.size === 1) {
        resolved.set(name, [...options][0]!);
        changed = true;
      }
    }
  }
  return resolved;
}

export function recoverNamedSeats(game: GameRecord, names: Map<string, string>): Record<string, string> {
  const result = { ...game.seats };
  const participants = new Set(game.participants ?? []);
  for (const player of game.replay.players) {
    if (player.isBot || result[player.id]) continue;
    const account = names.get(normalized(player.name));
    if (!account || !participants.has(account) || Object.values(result).includes(account)) continue;
    result[player.id] = account;
  }
  return result;
}
