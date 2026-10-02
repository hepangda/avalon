import type { DisplayPreferences } from '@/lib/preferences';

export interface AuthUser {
  preferences?: Partial<DisplayPreferences>;
  id: string;
  /** Original identity-provider name; a game alias never changes the login identity. */
  username: string;
  alias?: string;
  picture?: string;
  rerollCards?: { cards: number; completedGames: number; lastDailyDay: string | null };
}

export function accountDisplayName(user: AuthUser): string {
  return user.alias || user.username;
}
