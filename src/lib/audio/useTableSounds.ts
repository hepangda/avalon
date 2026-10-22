import { useEffect, useRef } from 'react';
import type { ClientGameState } from '@/lib/engine';
import { ROLE_TEAM_UI } from '@/lib/game/roleMeta';
import { endingHasTitleCard, endingMarks, type TablePresentation } from '@/lib/game/tablePresentation';
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
 * The ending's own beats. Other endings sound their verdict as the winner's card fills the
 * screen; after an assassination it waits for the last seat, since the dagger already spoke.
 * Each identity turns with a flip, except the dagger's seat: driven in on a hit, glancing
 * off on a miss.
 */
export function useEndingSounds(
  game: ClientGameState | null,
  ending: Extract<TablePresentation, { kind: 'gameOver' }> | null,
  stage: 'title' | 'flip' | 'settle' | null,
  revealed: number,
) {
  const won = !game?.outcome ? null
    : game.selfRole && !game.isSpectator ? game.outcome.winner === ROLE_TEAM_UI[game.selfRole]
    : game.outcome.winner === 'good';
  const titled = !!ending && endingHasTitleCard(ending.outcome);
  const verdictNow = titled ? stage === 'title' || stage === 'flip' : stage === 'settle';
  useSoundCue(!!ending && won !== null && verdictNow && (won ? 'victory' : 'defeat'), { key: ending?.id ?? '' });
  const turned = ending && revealed > 0 ? ending.order[revealed - 1] : undefined;
  const mark = ending && turned ? endingMarks(ending.outcome)[turned] : undefined;
  useSoundCue(!!turned && (mark === 'slain' ? 'stab' : mark === 'spared' ? 'assassinMiss' : 'flip'), {
    key: `${ending?.id}-${revealed}`,
  });
}
