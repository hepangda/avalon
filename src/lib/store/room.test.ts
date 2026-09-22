import { afterEach, describe, expect, it } from 'vitest';
import { useRoomStore } from './room';
import { buildStartedGame, FIVE_P } from '@/lib/engine/testkit';
import { projectStateForViewer } from '@/lib/engine';

afterEach(() => useRoomStore.getState().reset());

describe('room store lifecycle', () => {
  it('clears the completed game and private data while retaining room identity on restart', () => {
    const store = useRoomStore.getState();
    store.setRoomCode('1234');
    store.setMyPlayerId('p0');
    store.setIsHost(true);
    store.setIsReferee(true);
    store.setGame(projectStateForViewer(buildStartedGame(FIVE_P), 'p0'));
    store.setReveal({ selfRole: 'Merlin', knownPlayers: [] });
    store.setLadyResult({ targetId: 'p4', loyalty: 'evil' });
    store.setSnapshot({
      code: '1234',
      status: 'lobby',
      hostPlayerId: 'p0',
      members: [],
      config: {
        maxPlayers: 5,
        allowSpectators: true,
        allowMidJoin: true,
        options: buildStartedGame(FIVE_P).config.options,
        roster: [],
      },
    });
    expect(useRoomStore.getState()).toMatchObject({
      roomCode: '1234',
      myPlayerId: 'p0',
      isHost: true,
      isReferee: false,
      game: null,
      reveal: null,
      ladyResult: null,
    });
  });

  it('keeps referee mode on the same connection and clears it when disconnected', () => {
    const store = useRoomStore.getState();
    store.setConn('connected');
    store.setIsReferee(true);
    store.setConn('connected');
    expect(useRoomStore.getState().isReferee).toBe(true);
    store.setConn('disconnected');
    expect(useRoomStore.getState().isReferee).toBe(false);
    store.setConn('connected');
    expect(useRoomStore.getState().isReferee).toBe(false);
  });

  it('clears referee mode when leaving the room', () => {
    useRoomStore.getState().setIsReferee(true);
    useRoomStore.getState().reset();
    expect(useRoomStore.getState().isReferee).toBe(false);
  });

  it('discards a stale Lady result when an authoritative rewind removes it', () => {
    useRoomStore.getState().setLadyResult({ targetId: 'p4', loyalty: 'evil' });
    useRoomStore.getState().setGame(projectStateForViewer(buildStartedGame(FIVE_P), 'p0'));
    expect(useRoomStore.getState().ladyResult).toBeNull();
  });

  it('replaces cached identity and knowledge with the latest state after a redeal', () => {
    const store = useRoomStore.getState();
    store.setReveal({ selfRole: 'Assassin', knownPlayers: [{ playerId: 'p0', shownAs: 'evil', certain: true }] });
    const view = projectStateForViewer(buildStartedGame(FIVE_P), 'p0');
    store.setGame(view);
    expect(useRoomStore.getState().reveal).toEqual({ selfRole: view.selfRole, knownPlayers: view.knownPlayers });
    store.setGame(projectStateForViewer(buildStartedGame(FIVE_P), 'spectator'));
    expect(useRoomStore.getState().reveal).toBeNull();
  });
});
