import { expect, it, vi } from 'vitest';
import { buildStartedGame, FIVE_P } from '@/lib/engine/testkit';
import { projectStateForViewer } from '@/lib/engine';
import { ViewSynchronizer } from './viewSync';
import { sha256, viewContent, type RoomView, type ViewSnapshot } from '../stateIntegrity';

async function snapshot(revision = 1): Promise<ViewSnapshot> {
  const game = projectStateForViewer(buildStartedGame(FIVE_P), 'p0');
  const view: RoomView = { room: { code: '1234', hostPlayerId: 'p0', status: 'in_game', members: [],
    config: { maxPlayers: 5, allowSpectators: true, allowMidJoin: true, options: buildStartedGame(FIVE_P).config.options, roster: [] } },
    game, playerId: 'p0', isHost: true, isReferee: false };
  return { epoch: 'epoch', revision, hash: await sha256(viewContent(view)), view };
}
function harness() {
  let local: RoomView | null = null;
  const apply = vi.fn((value: ViewSnapshot) => { local = structuredClone(value.view); });
  const request = vi.fn().mockResolvedValue({ ok: true }); const invalidate = vi.fn();
  const sync = new ViewSynchronizer({ code: '1234', read: () => local, apply, request, invalidate });
  return { sync, apply, request, invalidate, get local() { return local!; } };
}

it('detects a missing final push from the next heartbeat and restores the full view', async () => {
  const h = harness(); const first = await snapshot(); const next = await snapshot(2);
  await h.sync.receive(first);
  await h.sync.check(next);
  expect(h.invalidate).toHaveBeenCalledOnce(); expect(h.request).toHaveBeenCalledOnce();
  await h.sync.receive({ ...next, recovery: true });
  expect(h.apply).toHaveBeenLastCalledWith({ ...next, recovery: true }, true);
});
it('detects same-version local corruption instead of trusting its cached digest', async () => {
  const h = harness(); const first = await snapshot(); await h.sync.receive(first);
  h.local.game!.phase = 'GameOver';
  await h.sync.check(first);
  expect(h.request).toHaveBeenCalledOnce();
});
it('rejects corrupt payloads and wrong-room snapshots before they enter the store', async () => {
  const h = harness(); const first = await snapshot();
  await h.sync.receive({ ...first, hash: 'corrupt' });
  expect(h.apply).not.toHaveBeenCalled();
  const foreign = await snapshot(); foreign.view.room.code = '5678';
  await h.sync.receive(foreign); expect(h.apply).not.toHaveBeenCalled();
});
it('ignores stale snapshots and heartbeats that preceded a newer push', async () => {
  const h = harness(); await h.sync.receive(await snapshot(3));
  await h.sync.receive(await snapshot(2)); await h.sync.check(await snapshot(1));
  expect(h.apply).toHaveBeenCalledOnce(); expect(h.request).not.toHaveBeenCalled();
});
it('excludes latency and sampled clock values while retaining timer start timestamps', async () => {
  const h = harness(); const first = await snapshot(); await h.sync.receive(first);
  h.local.game!.serverTime = 123456; h.local.game!.players[0]!.latency = 900;
  await h.sync.check(first); expect(h.request).not.toHaveBeenCalled();
  h.local.game!.actionTimers = [{ playerId: 'p0', action: 'vote', startedAt: 100, durationMs: 20000 }];
  await h.sync.check(first); expect(h.request).toHaveBeenCalledOnce();
});
it('keeps newer revisions even when a referee moves the game to an earlier phase', async () => {
  const h = harness(); const first = await snapshot(); await h.sync.receive(first);
  const next = await snapshot(2); next.view.game!.phase = 'Lobby'; next.view.game!.phaseRevision = 1;
  next.hash = await sha256(viewContent(next.view)); await h.sync.receive(next);
  expect(h.local.game!.phase).toBe('Lobby'); expect(h.local.game!.phaseRevision).toBe(1);
});
it('does not apply async digest results after leaving or replacing a connection', async () => {
  const first = await snapshot(); let resolve!: (hash: string) => void;
  const hash = new Promise<string>((done) => { resolve = done; }); const apply = vi.fn();
  const sync = new ViewSynchronizer({ code: '1234', read: () => null, apply, request: vi.fn(), invalidate: vi.fn(), hash: () => hash });
  const processing = sync.receive(first); await Promise.resolve(); sync.dispose(); resolve(first.hash); await processing;
  expect(apply).not.toHaveBeenCalled();
});
it('coalesces recovery requests and retries on a later heartbeat after failure', async () => {
  const h = harness(); const first = await snapshot(); let release!: () => void;
  h.request.mockImplementationOnce(() => new Promise<void>((done) => { release = done; }));
  await h.sync.check(first); await h.sync.check(first); expect(h.request).toHaveBeenCalledOnce();
  release(); await Promise.resolve(); await Promise.resolve();
  await h.sync.check(first); expect(h.request).toHaveBeenCalledTimes(2);
});
it('rejects an old process epoch on an established connection', async () => {
  const h = harness(); const first = await snapshot(); await h.sync.receive(first);
  await h.sync.receive({ ...first, epoch: 'old-process', revision: 100 });
  expect(h.apply).toHaveBeenCalledOnce(); expect(h.request).toHaveBeenCalledOnce();
});

it('does not loop if a resync response is also corrupt; retries at the next heartbeat', async () => {
  const h = harness(); const first = await snapshot();
  await h.sync.receive({ ...first, hash: 'corrupt' });
  await h.sync.receive({ ...first, hash: 'corrupt', recovery: true });
  await h.sync.receive({ ...first, hash: 'corrupt', recovery: true });
  expect(h.request).toHaveBeenCalledOnce();
  await h.sync.check(first);
  expect(h.request).toHaveBeenCalledTimes(2);
});
