import { afterEach, describe, expect, it, vi } from "vitest";
import { Socket, roomHarness } from './test-room';

afterEach(() => vi.restoreAllMocks());

describe('committed per-viewer synchronization', () => {
  const latest = (socket: Socket) => socket.messages.filter((m) => m.event === 'view:sync').at(-1)!.payload as import('@/lib/socket/stateIntegrity').ViewSnapshot;
  async function connected() {
    const h = roomHarness();
    await h.action(h.host, 'room:join', { syncVersion: 1, playerId: 'p0', playerToken: 'token-0', hostToken: 'host-secret' });
    return h;
  }

  it('answers heartbeats and recovery from the committed cache while a write is blocked', async () => {
    const h = await connected(); const before = latest(h.host);
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    const original = h.persistence.saveRoom.bind(h.persistence);
    h.save.mockImplementationOnce(async (...args) => { await gate; return original(...args); });
    const change = h.action(h.host, 'room:rename', { name: 'Committed' });
    await vi.waitFor(() => expect(h.save).toHaveBeenCalledTimes(2));
    try {
      const ping = await Promise.race([
        h.action(h.host, 'net:ping', { rtt: 20 }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Ping waited for persistence')), 200)),
      ]);
      expect(ping.data).toEqual({ sync: { epoch: before.epoch, revision: before.revision, hash: before.hash } });
      await h.action(h.host, 'room:resync');
      expect(latest(h.host).view.room.members.find((m) => m.id === 'p0')!.name).not.toBe('Committed');
      expect(latest(h.host).recovery).toBe(true);
    } finally { release(); }
    await change;
    expect(latest(h.host).revision).toBeGreaterThan(before.revision);
    expect(latest(h.host).view.room.members.find((m) => m.id === 'p0')!.name).toBe('Committed');
    expect(h.save.mock.calls.at(-1)![4]?.changes.length).toBeGreaterThan(0);
  });

  it('publishes one atomic authorized view and advertises a missed update on a later heartbeat', async () => {
    const h = await connected();
    await h.action(h.spectator, 'room:join', { syncVersion: 1 });
    h.host.messages = []; h.spectator.messages = [];
    await h.action(h.host, 'room:start');
    const own = latest(h.host); const spectator = latest(h.spectator);
    expect(own.view.game?.selfRole).toBeTruthy();
    expect(spectator.view.game?.selfRole).toBeNull();
    expect(spectator.view.game?.players.every((p) => p.role === undefined)).toBe(true);
    expect(JSON.stringify(own)).not.toContain('host-secret');
    expect(JSON.stringify(own)).not.toContain('token-p0');
    expect(h.host.messages.filter((m) => m.t === 'push').map((m) => m.event)).toEqual(['view:sync']);
    h.host.messages = []; // Client loses the final update and nobody acts again.
    const ping = await h.action(h.host, 'net:ping');
    expect(ping.data).toEqual({ sync: { epoch: own.epoch, revision: own.revision, hash: own.hash } });
    await h.action(h.host, 'room:resync');
    expect(latest(h.host).view.game).toMatchObject({ selfRole: own.view.game!.selfRole });
  });

  it('does not expose speculative state or hashes after a failed commit', async () => {
    const h = await connected(); const before = latest(h.host);
    h.save.mockRejectedValueOnce(new Error('Failed write'));
    vi.spyOn(console, 'error').mockImplementation(() => { });
    expect((await h.action(h.host, 'room:rename', { name: 'Speculative' })).ok).toBe(false);
    expect(latest(h.host)).toEqual(before);
    expect((await h.action(h.host, 'net:ping')).ok).toBe(false);
    expect((await h.action(h.host, 'room:resync')).ok).toBe(false);
  });

  it('keeps the view revision increasing on referee rollback and uses a fresh epoch after reload', async () => {
    const h = await connected();
    await h.action(h.host, 'room:start');
    await h.action(h.host, 'admin:auth');
    await h.action(h.host, 'admin:startAssassination');
    const advanced = latest(h.host);
    await h.action(h.host, 'admin:previousPhase');
    const rewound = latest(h.host);
    expect(rewound.revision).toBeGreaterThan(advanced.revision);
    expect(rewound.view.game?.phase).toBe('TeamBuilding');
    h.wake();
    await h.action(h.host, 'room:join', { syncVersion: 1 });
    expect(latest(h.host).epoch).not.toBe(rewound.epoch);
  });

  it('never reads or writes PostgreSQL for a heartbeat on an unloaded room', async () => {
    const h = roomHarness(); const load = vi.spyOn(h.persistence, 'loadRoom');
    await h.action(h.host, 'net:ping');
    expect(load).not.toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled();
  });
});
