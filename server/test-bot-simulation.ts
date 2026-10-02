import { createGame, createRng, isEvil, reduce, type ActionTimer, type GameEvent, type GameOptions, type GameState } from '@/lib/engine';
import { botAction } from './bots';
import { baselineBotAction } from './test-bot-baseline';

export type BotMatchup = 'new' | 'baseline' | 'new-good' | 'new-evil' | 'mixed';

export function simulateBotGame(count: number, seed: string, options: Partial<GameOptions> = {}, matchup: BotMatchup = 'new') {
  const created = createGame({ hostId: 'p0', players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `P${i}` })), options: {
    morgana: true, percival: true, mordred: false, oberon: false, ladyOfTheLake: false, ...options,
  }, seed });
  if (!created.ok) throw new Error(created.error.message);
  let state = created.state;
  let steps = 0;
  const decisionMs: number[] = [];
  let hiddenPasses = 0;
  const policy = (state: GameState, timer: ActionTimer, seed: string) => {
    const player = state.players.find((p) => p.id === timer.playerId)!;
    const modern = matchup === 'new' || (matchup === 'new-evil' && isEvil(player.role)) ||
      (matchup === 'new-good' && !isEvil(player.role)) || (matchup === 'mixed' && player.seat % 2 === 0);
    const started = performance.now();
    const event = (modern ? botAction : baselineBotAction)(state, timer, seed);
    if (modern && ['propose', 'vote', 'lady', 'assassinate'].includes(timer.action)) decisionMs.push(performance.now() - started);
    if (event.type === 'CAST_MISSION_CARD' && event.card === 'success' && isEvil(player.role)) hiddenPasses++;
    return event;
  };
  const apply = (event: GameEvent) => {
    const result = reduce(state, event, { now: steps++, rng: createRng(`${seed}:engine:${steps}`) });
    if (!result.ok) throw new Error(`${seed} ${event.type}: ${result.error.message}`);
    state = result.state;
  };
  apply({ type: 'START_GAME', by: 'p0', flowVersion: 5 });
  while (state.phase !== 'GameOver' && steps < 1000) {
    const timer = state.actionTimers?.[0];
    if (!timer) throw new Error(`${seed} stalled at ${state.phase}`);
    apply(policy(state, timer, `${seed}:bot:${steps}`));
  }
  if (!state.outcome) throw new Error(`${seed} did not finish`);
  return { state, steps, decisionMs, metrics: {
    proposals: state.voteHistory.length,
    missions: state.missionResults.length,
    forced: state.voteHistory.filter((v) => v.approved && v.proposalIndex >= (options.maxRejections ?? 5) - 1).length,
    straightFails: Number(state.missionResults.length === 3 && state.missionResults.every((m) => !m.success)),
    goodMissions: Number(state.missionResults.filter((m) => m.success).length >= 3),
    goodWins: Number(state.outcome.winner === 'good'),
    assassinationHits: Number(state.outcome.reason === 'assassinated_merlin'),
    rejectionLoss: Number(state.outcome.reason === 'five_rejections' || state.outcome.reason === 'rejection_limit'),
    hiddenPasses,
  } };
}
