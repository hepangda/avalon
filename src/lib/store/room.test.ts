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
        voiceEnabled: true,
        options: buildStartedGame(FIVE_P).config.options,
        roster: [],
      },
    });
    expect(useRoomStore.getState()).toMatchObject({
      roomCode: '1234',
      myPlayerId: 'p0',
      isHost: true,
      game: null,
      reveal: null,
      ladyResult: null,
    });
  });

  it('discards a stale Lady result when an authoritative rewind removes it', () => {
    useRoomStore.getState().setLadyResult({ targetId: 'p4', loyalty: 'evil' });
    useRoomStore.getState().setGame(projectStateForViewer(buildStartedGame(FIVE_P), 'p0'));
    expect(useRoomStore.getState().ladyResult).toBeNull();
  });
});
