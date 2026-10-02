import { afterEach, describe, expect, it } from 'vitest';
import { useRoomStore } from './room';
import { buildStartedGame, FIVE_P } from '@/lib/engine/testkit';
import { projectStateForViewer } from '@/lib/engine';
import type { RoomView } from '@/lib/socket/stateIntegrity';

function view(viewer = 'p0'): RoomView {
  const state = buildStartedGame(FIVE_P);
  const game = projectStateForViewer(state, viewer);
  return { room: { code: '1234', status: 'in_game', hostPlayerId: 'p0',
    members: game.players.map(({ id, name, seat }) => ({ id, name, seat, connected: true, claimed: true, isSpectator: false })),
    config: { maxPlayers: 5, allowSpectators: true, allowMidJoin: true, options: state.config.options, roster: [] } },
    game, playerId: viewer === 'spectator' ? null : viewer, isHost: viewer === 'p0', isReferee: false };
}
function apply(value: RoomView, recovery = false) {
  useRoomStore.getState().applyView({ epoch: 'test', revision: 1, hash: 'already-verified', view: value }, recovery);
}
afterEach(() => useRoomStore.getState().reset());

describe('room store lifecycle', () => {
  it('applies latency deltas without replacing game history or private knowledge', () => {
    const initial = view(); apply(initial);
    const store = useRoomStore.getState();
    store.setPlayerLatency({ playerId: 'p0', latency: 250 });
    const updated = useRoomStore.getState();
    expect(updated.snapshot?.members.find((p) => p.id === 'p0')?.latency).toBe(250);
    expect(updated.game?.players.find((p) => p.id === 'p0')?.latency).toBe(250);
    expect(updated.game?.logs).toBe(initial.game!.logs);
    expect(updated.game?.knownPlayers).toBe(initial.game!.knownPlayers);
    expect(updated.game?.players.find((p) => p.id === 'p1')).toBe(initial.game!.players.find((p) => p.id === 'p1'));
    store.setPlayerLatency({ playerId: 'p0', latency: 250 });
    store.setPlayerLatency({ playerId: 'unknown', latency: 100 });
    expect(useRoomStore.getState()).toBe(updated);
  });
  it('clears completed game and private data while preserving room identity on restart', () => {
    const current = view(); current.isReferee = true;
    current.game!.privateLadyResult = { targetId: 'p4', loyalty: 'evil' }; apply(current);
    apply({ ...current, room: { ...current.room, status: 'lobby' }, game: null, isReferee: false });
    expect(useRoomStore.getState()).toMatchObject({ roomCode: '1234', myPlayerId: 'p0', isHost: true, isReferee: false, game: null });
  });
  it('keeps referee mode on the same connection and clears it when disconnected', () => {
    const store = useRoomStore.getState();
    apply({ ...view(), isReferee: true });
    store.setConn('connected'); expect(useRoomStore.getState().isReferee).toBe(true);
    store.setConn('disconnected'); expect(useRoomStore.getState().isReferee).toBe(false);
    store.setConn('connected'); expect(useRoomStore.getState().isReferee).toBe(false);
  });
  it('clears room identity, private state and synchronization when leaving', () => {
    apply({ ...view(), isReferee: true }, true);
    useRoomStore.getState().reset();
    expect(useRoomStore.getState()).toMatchObject({ roomCode: null, myPlayerId: null, game: null, isReferee: false, syncing: true, recoveryRevision: 0 });
  });
  it('discards a stale Lady result when an authoritative rewind removes it', () => {
    const current = view(); current.game!.privateLadyResult = { targetId: 'p4', loyalty: 'evil' }; apply(current);
    apply(view()); expect(useRoomStore.getState().game?.privateLadyResult).toBeUndefined();
  });
  it('replaces identity and knowledge after a redeal or spectator transition', () => {
    apply(view('p4'));
    const next = view(); apply(next);
    expect(useRoomStore.getState().game?.selfRole).toBe(next.game!.selfRole);
    expect(useRoomStore.getState().game?.knownPlayers).toEqual(next.game!.knownPlayers);
    apply(view('spectator'));
    expect(useRoomStore.getState().game?.selfRole).toBeNull();
    expect(useRoomStore.getState().game?.knownPlayers).toEqual([]);
  });
  it('atomically replaces identity, game, room and private data during verified recovery', () => {
    apply({ ...view(), isReferee: true });
    const changes: unknown[] = [];
    const stop = useRoomStore.subscribe((state) => changes.push(state));
    const next = view('spectator'); apply(next, true); stop();
    expect(changes).toHaveLength(1);
    expect(useRoomStore.getState()).toMatchObject({ roomCode: '1234', snapshot: next.room, game: next.game,
      myPlayerId: null, isReferee: false, syncing: false, recoveryRevision: 1 });
  });
});
