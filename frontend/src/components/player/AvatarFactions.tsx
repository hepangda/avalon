import { createContext, useContext } from 'react';
import type { AvatarFaction } from '@/lib/game/roleNotes';

const AvatarFactionContext = createContext<Partial<Record<string, AvatarFaction>>>({});

/** Every portrait of a player inside the match carries the side the viewer knows or has marked for them. */
export const AvatarFactionProvider = AvatarFactionContext.Provider;

export function useAvatarFaction(playerId: string) {
  return useContext(AvatarFactionContext)[playerId];
}
