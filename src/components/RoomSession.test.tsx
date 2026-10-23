// @vitest-environment happy-dom
import { act, lazy } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RoomSession } from './RoomSession';
import { useRoomStore } from '@/lib/store/room';
import { useSceneGate } from '@/lib/store/sceneGate';
import { sha256, viewContent, type RoomView } from '@/lib/socket/stateIntegrity';
import { buildStartedGame, FIVE_P } from '@/lib/engine/testkit';
import { projectStateForViewer } from '@/lib/engine';
import type { RoomHandlers } from '@/lib/socket/client/socket';

const socket = vi.hoisted(() => ({
  handlers: {} as RoomHandlers,
  connection: { code: '1234', connected: true, emit: vi.fn().mockResolvedValue({ ok: true }), setHandlers: vi.fn(), close: vi.fn() },
  connect: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/lib/auth/useAuthIdentity', () => ({ useAuthIdentity: () => ({ user: { id: 'account' }, loading: false, refresh: socket.refresh }) }));
vi.mock('@/lib/game/preloadImages', () => ({ gameImageUrls: () => [], preloadImages: vi.fn() }));
vi.mock('@/lib/socket/client/socket', () => ({
  connectRoom: (code: string, handlers: RoomHandlers) => {
    socket.connect(code); socket.handlers = handlers; socket.connection.code = code; return socket.connection;
  },
  getConnection: () => socket.connection,
  emitWithAck: (event: string, payload: unknown) => socket.connection.emit(event, payload),
}));

let root: Root;
let navigate: ReturnType<typeof useNavigate>;
function Page() {
  navigate = useNavigate();
  return <div>Room page</div>;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  useRoomStore.getState().reset();
  socket.connection.connected = true;
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  useSceneGate.getState().finish();
  vi.unstubAllGlobals();
});

async function push(revision: number) {
  const state = buildStartedGame(FIVE_P);
  const view: RoomView = {
    room: { code: '1234', hostPlayerId: 'p0', status: 'in_game', members: [], config: {
      maxPlayers: 5, allowSpectators: true, allowMidJoin: true, options: state.config.options, roster: [],
    } },
    game: projectStateForViewer(state, 'p0'), playerId: 'p0', isHost: true, isReferee: false,
  };
  const hash = await sha256(viewContent(view));
  await act(async () => {
    socket.handlers.onPush?.('view:sync', { epoch: 'epoch', revision, hash, view });
    // The push is verified against its hash asynchronously; under load that takes more than one tick.
    await vi.waitFor(() => expect(useRoomStore.getState().syncing).toBe(false));
  });
}

it('keeps the same join and synchronizer through gate navigation in both directions', async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/room/1234']}>
    <Routes><Route element={<RoomSession />}>
      <Route path="/room/:code" element={<Page />} />
      <Route path="/game/:code" element={<Page />} />
    </Route></Routes>
  </MemoryRouter>));
  await push(1);
  const revision = useRoomStore.getState().recoveryRevision;
  expect(useRoomStore.getState().syncing).toBe(false);
  useSceneGate.getState().close('1234', null, () => navigate('/game/1234'));
  await act(async () => useSceneGate.getState().shut());
  expect(useRoomStore.getState().syncing).toBe(false);
  await push(2);
  await act(async () => navigate('/room/1234'));
  await push(3);
  expect(socket.connect).toHaveBeenCalledTimes(1);
  expect(socket.connection.emit.mock.calls.filter(([event]) => event === 'room:join')).toHaveLength(1);
  expect(socket.connection.setHandlers).not.toHaveBeenCalled();
  expect(useRoomStore.getState().recoveryRevision).toBe(revision);
  // Genuine disconnection must still rejoin and verify a fresh snapshot.
  await act(async () => {
    socket.handlers.onState?.('disconnected');
    socket.handlers.onState?.('connecting');
    socket.handlers.onState?.('connected');
  });
  expect(useRoomStore.getState().syncing).toBe(true);
  await push(4);
  expect(useRoomStore.getState().syncing).toBe(false);
  expect(socket.connection.emit.mock.calls.filter(([event]) => event === 'room:join')).toHaveLength(2);
  expect(useRoomStore.getState().recoveryRevision).toBe(revision + 1);
});

it('continues receiving updates while the game page is still loading behind the gate', async () => {
  let finishLoading!: (value: { default: typeof Page }) => void;
  const GamePage = lazy(() => new Promise<{ default: typeof Page }>((resolve) => { finishLoading = resolve; }));
  await act(async () => root.render(<MemoryRouter initialEntries={['/room/1234']}>
    <Routes><Route element={<RoomSession />}>
      <Route path="/room/:code" element={<Page />} />
      <Route path="/game/:code" element={<GamePage />} />
    </Route></Routes>
  </MemoryRouter>));
  await push(1);
  const revision = useRoomStore.getState().recoveryRevision;
  await act(async () => navigate('/game/1234'));
  await push(2);
  expect(useRoomStore.getState().syncing).toBe(false);
  await act(async () => finishLoading({ default: Page }));
  expect(socket.connect).toHaveBeenCalledTimes(1);
  expect(useRoomStore.getState().recoveryRevision).toBe(revision);
});
