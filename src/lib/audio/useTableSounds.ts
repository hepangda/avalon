import { useEffect, useRef } from 'react';
import type { ClientGameState } from '@/lib/engine';
import { ROLE_TEAM_UI } from '@/lib/game/roleMeta';
import { playSound, type SoundName } from './engine';

/**
 * Table moments that have no reveal of their own: a mission seal pressed onto the track, the crown
 * passing, the Lady rising, and the ending. Each fires on a change seen on screen, never on arrival.
 */
export function useTableSounds({ game, settled, sealedRounds, leaderId, isOver }: {
  game: ClientGameState | null;
  /** No reveal is playing, so what is on the table is what the player sees. */
  settled: boolean;
  /** Mission results shown on the track. */
  sealedRounds: number;
  leaderId: string | undefined;
  isOver: boolean;
}) {
  const seen = useRef<{ timeline: string; seals: number; leader?: string; phase?: string; over: boolean } | null>(null);
  const timeline = `${game?.gameId}:${game?.phaseRevision ?? 0}`;
  const phase = game?.phase;
  const won = !game?.outcome ? null
    : game.selfRole && !game.isSpectator ? game.outcome.winner === ROLE_TEAM_UI[game.selfRole]
    : game.outcome.winner === 'good';

  useEffect(() => {
    if (!game || !settled) return;
    const now = { timeline, seals: sealedRounds, leader: leaderId, phase, over: isOver };
    const before = seen.current;
    seen.current = now;
    // A new game, a rollback or the first look at the table sets the baseline silently.
    if (!before || before.timeline !== timeline) return;
    let cue: SoundName | null = null;
    if (isOver && !before.over) cue = won ? 'victory' : 'defeat';
    else if (sealedRounds > before.seals) cue = 'seal';
    else if (phase === 'LadyOfLake' && before.phase !== 'LadyOfLake') cue = 'lady';
    else if (leaderId && before.leader && leaderId !== before.leader) cue = 'leader';
    if (cue) playSound(cue);
    // A seal and the crown passing land together after a mission; the crown follows the seal.
    if (cue === 'seal' && leaderId && before.leader && leaderId !== before.leader) playSound('leader', { delay: 0.7 });
  }, [game, settled, timeline, sealedRounds, leaderId, phase, isOver, won]);
}
