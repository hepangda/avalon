import type { ClientGameState } from '@/lib/engine';
import { sameTimeline } from '@/lib/game/tablePresentation';
import lines from './voice-lines.json';

export type VoiceCue = keyof typeof lines;
const phases: Partial<Record<ClientGameState['phase'], VoiceCue>> = {
  TeamBuilding: 'teamBuilding', TeamAnnouncement: 'teamAnnouncement',
  TeamFinalizing: 'teamFinalizing', Voting: 'voting', MissionVote: 'missionVote',
  LadyOfLake: 'ladyOfLake', Assassination: 'assassination',
};

const speakerCues: VoiceCue[] = [
  'discussion1', 'discussion2', 'discussion3', 'discussion4', 'discussion5',
  'discussion6', 'discussion7', 'discussion8', 'discussion9', 'discussion10',
];

/** Only compare states whose public reveals have finished. Never read private identities. */
export function voiceCues(previous: ClientGameState | null, next: ClientGameState): VoiceCue[] {
  if (!previous || !sameTimeline(previous, next)) return [];
  // Reveals can span several server transitions. Terminal phases supersede any
  // unannounced quest/vote history accumulated while those animations ran.
  if (next.phase === 'GameOver') {
    return previous.phase !== 'GameOver' && next.outcome
      ? [next.outcome.winner === 'good' ? 'goodWins' : 'evilWins'] : [];
  }
  if (next.phase === 'Assassination') {
    return previous.phase !== 'Assassination' ? ['assassination'] : [];
  }
  const cues: VoiceCue[] = [];
  if (next.voteHistory.length > previous.voteHistory.length)
    cues.push(next.voteHistory.at(-1)!.approved ? 'voteApproved' : 'voteRejected');
  if (next.missionResults.length > previous.missionResults.length)
    cues.push(next.missionResults.at(-1)!.success ? 'missionSuccess' : 'missionFailure');
  const changed = previous.phase !== next.phase || previous.roundIndex !== next.roundIndex ||
    previous.rejectionCount !== next.rejectionCount ||
    (next.phase === 'Discussion' && previous.discussion?.speakerIndex !== next.discussion?.speakerIndex);
  const speakerId = next.discussion?.order[next.discussion.speakerIndex];
  const speaker = next.players.find((player) => player.id === speakerId);
  const phase = next.phase === 'Discussion'
    ? speaker && speakerCues[speaker.seat]
    : phases[next.phase];
  if (changed && phase) cues.push(phase);
  return cues;
}
