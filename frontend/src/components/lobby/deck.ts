import { PLAYER_COMPOSITION, evilSpecialsCount, type GameOptions, type Role, type Team } from '@/lib/engine';

export type DeckOption = 'morgana' | 'mordred' | 'oberon';

export interface DeckEntry {
  role: Role;
  team: Team;
  /** Copies dealt; zero for an optional role left out. */
  count: number;
  /** The host option that adds or removes this card; Percival rides with Morgana. */
  option?: DeckOption;
}

/** Every role the table could deal, in display order, with the copies these options deal. */
export function deckEntries(playerCount: number, options: GameOptions): DeckEntry[] {
  const { good, evil } = PLAYER_COMPOSITION[playerCount]!;
  return [
    { role: 'Merlin', team: 'good', count: 1 },
    { role: 'Percival', team: 'good', count: options.percival ? 1 : 0, option: 'morgana' },
    { role: 'LoyalServant', team: 'good', count: good - 1 - (options.percival ? 1 : 0) },
    { role: 'Morgana', team: 'evil', count: options.morgana ? 1 : 0, option: 'morgana' },
    { role: 'Mordred', team: 'evil', count: options.mordred ? 1 : 0, option: 'mordred' },
    { role: 'Oberon', team: 'evil', count: options.oberon ? 1 : 0, option: 'oberon' },
    { role: 'Assassin', team: 'evil', count: 1 },
    { role: 'Minion', team: 'evil', count: Math.max(0, evil - evilSpecialsCount(options)) },
  ];
}
