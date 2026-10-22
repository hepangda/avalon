import { useEffect, useRef } from 'react';
import type { ClientGameState } from '@/lib/engine';
import { ROLE_TEAM_UI } from '@/lib/game/roleMeta';
import { playSound, type SoundName } from './engine';
import { useSoundCue } from './useSoundCue';

/**
 * Table moments that have no reveal of their own: a mission seal pressed onto the track, the crown
 * passing and the Lady rising. Each fires on a change seen on screen, never on arrival.
 */
export function useTableSounds({ game, settled, sealedRounds, leaderId }: {
  game: ClientGameState | null;
  /** No reveal is playing, so what is on the table is what the player sees. */
  settled: boolean;
  /** Mission results shown on the track. */
  sealedRounds: number;
  leaderId: string | undefined;
}) {
  const seen = useRef<{ timeline: string; seals: number; leader?: string; phase?: string } | null>(null);
  const timeline = `${game?.gameId}:${game?.phaseRevision ?? 0}`;
  const phase = game?.phase;

  useEffect(() => {
    if (!game || !settled) return;
    const now = { timeline, seals: sealedRounds, leader: leaderId, phase };
    const before = seen.current;
    seen.current = now;
    // A new game, a rollback or the first look at the table sets the baseline silently.
    if (!before || before.timeline !== timeline) return;
    let cue: SoundName | null = null;
    if (sealedRounds > before.seals) cue = 'seal';
    else if (phase === 'LadyOfLake' && before.phase !== 'LadyOfLake') cue = 'lady';
    else if (leaderId && before.leader && leaderId !== before.leader) cue = 'leader';
    if (cue) playSound(cue);
    // A seal and the crown passing land together after a mission; the crown follows the seal.
    if (cue === 'seal' && leaderId && before.leader && leaderId !== before.leader) playSound('leader', { delay: 0.7 });
  }, [game, settled, timeline, sealedRounds, leaderId, phase]);
}

/**
 * The ending's own beats: the verdict as the winner's card fills the screen (or, after an
 * assassination, as the seats begin to turn), then a flip for each identity.
 */
export function useEndingSounds(
  game: ClientGameState | null,
  endingId: string | null,
  stage: 'title' | 'flip' | 'settle' | null,
  revealed: number,
) {
  const won = !game?.outcome ? null
    : game.selfRole && !game.isSpectator ? game.outcome.winner === ROLE_TEAM_UI[game.selfRole]
    : game.outcome.winner === 'good';
  useSoundCue(!!endingId && won !== null && (stage === 'title' || stage === 'flip') && (won ? 'victory' : 'defeat'), { key: endingId ?? '' });
  useSoundCue(!!endingId && revealed > 0 && 'flip', { key: `${endingId}-${revealed}` });
}
