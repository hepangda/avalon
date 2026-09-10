import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientGameState } from '@/lib/engine';
import type { Ack, RoomSnapshot } from '@/lib/socket/types';
import type { ReplayData } from '@/lib/game/replayTypes';
import { DEFAULT_ROOM_CONFIG } from './room-helpers';
import type { Env, SocketAttachment } from './env';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(
      protected ctx: DurableObjectState,
      protected env: Env,
    ) {}
  },
}));

import { RoomDurableObject } from './room-do';

class Socket {
  messages: Array<{
    t: string;
    id?: string;
    event?: string;
    payload?: unknown;
    res?: Ack;
  }> = [];
  constructor(private attachment: SocketAttachment) {}
  deserializeAttachment() {
    return this.attachment;
  }
  serializeAttachment(attachment: SocketAttachment) {
    this.attachment = attachment;
  }
  send(message: string) {
    this.messages.push(JSON.parse(message));
  }
  get ws() {
    return this as unknown as WebSocket;
  }
  get game() {
    return this.messages
      .slice()
      .reverse()
      .find((m) => m.event === 'state:sync')!.payload as ClientGameState;
  }
  get snapshot() {
    return this.messages
      .slice()
      .reverse()
      .find((m) => m.event === 'room:snapshot')!.payload as RoomSnapshot;
  }
}

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.restoreAllMocks();
});

function roomHarness() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  const sockets = [0, 2, 3, 4, 5].map(
    (seat) => new Socket({ playerId: `p${seat}`, isHost: seat === 0, isAdmin: false }),
  );
  const spectator = new Socket({ isHost: false, isAdmin: false });
  sockets.push(spectator);
  const sql = {
    exec(query: string, ...bindings: Array<string | number | null>) {
      if (query.includes('CREATE TABLE')) {
        db.exec(query);
        return { toArray: () => [] };
      }
      const rows = db.prepare(query).all(...bindings);
      return { toArray: () => rows };
    },
  };
  const ctx = {
    storage: {
      sql,
      transactionSync: (fn: () => void) => {
        db.exec('BEGIN');
        try {
          fn();
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    },
    getWebSockets: () => sockets.map((s) => s.ws),
    blockConcurrencyWhile: <T>(fn: () => Promise<T>) => fn(),
  } as unknown as DurableObjectState;
  const archives = new Map<string, ReplayData>();
  const store = vi.fn(async (replay: ReplayData) => {
    archives.set(replay.gameId, structuredClone(replay));
  });
  const env = {
    REPLAY: { idFromName: (id: string) => id, get: () => ({ store }) },
  } as unknown as Env;
  let room = new RoomDurableObject(ctx, env);
  const config = {
    ...DEFAULT_ROOM_CONFIG,
    roster: Array.from({ length: 6 }, (_, i) => `Seat ${i}`),
  };
  db.prepare('INSERT INTO room_meta VALUES (1, ?, ?, ?, ?, NULL, NULL, 0)').run(
    '1234',
    'host-secret',
    'lobby',
    JSON.stringify(config),
  );
  for (let seat = 0; seat < 6; seat++) {
    db.prepare('INSERT INTO player VALUES (?, ?, ?, ?, 0, ?, ?)').run(
      `p${seat}`,
      `Player ${seat}`,
      `https://example.com/${seat}.png`,
      seat,
      seat === 1 ? 0 : 1,
      seat === 1 ? 0 : 1,
    );
    if (seat !== 1)
      db.prepare('INSERT INTO player_session VALUES (?, ?)').run(`p${seat}`, `token-${seat}`);
  }
  db.prepare('INSERT INTO voice_meeting VALUES (1, ?)').run('meeting-123');
  db.prepare('INSERT INTO voice_participant VALUES (?, ?)').run('p0', 'voice-p0');
  db.prepare('INSERT INTO voice_presence VALUES (?, ?, ?)').run('p0', 'joined', 1);
  let request = 0;
  const action = async (socket: Socket, event: string, payload = {}) => {
    const id = String(++request);
    await room.webSocketMessage(socket.ws, JSON.stringify({ t: 'req', id, event, payload }));
    return socket.messages.find((m) => m.t === 'ack' && m.id === id)!.res!;
  };
  const host = sockets[0]!;
  const finish = async () => {
    expect((await action(host, 'admin:auth')).ok).toBe(true);
    expect((await action(host, 'admin:startAssassination')).ok).toBe(true);
    const assassin = sockets.find((s) => s !== spectator && s.game.selfRole === 'Assassin')!;
    const merlin = sockets.find((s) => s !== spectator && s.game.selfRole === 'Merlin')!;
    expect(
      (
        await action(assassin, 'game:assassinate', {
          targetPlayerId: merlin.deserializeAttachment().playerId,
        })
      ).ok,
    ).toBe(true);
  };
  return {
    db,
    host,
    sockets,
    spectator,
    action,
    archives,
    store,
    finish,
    wake: () => {
      room = new RoomDurableObject(ctx, env);
    },
  };
}

describe('room lifecycle and referee handlers (SQLite + WebSocket harness)', () => {
  it('deletes a middle empty seat without replacing later occupied identities or sessions', async () => {
    const h = roomHarness();
    expect((await h.action(h.spectator, 'room:removeSeat', { seatId: 'p1' })).error?.code).toBe(
      'NOT_HOST',
    );
    expect((await h.action(h.host, 'room:removeSeat', { seatId: 'p2' })).error?.code).toBe(
      'SEAT_CLAIMED',
    );
    expect((await h.action(h.host, 'room:removeSeat', { seatId: 'p1' })).ok).toBe(true);
    expect(h.host.snapshot.members.map((m) => [m.id, m.seat, m.name])).toEqual(
      [0, 2, 3, 4, 5].map((n, i) => [`p${n}`, i, `Player ${n}`]),
    );
    expect(h.host.snapshot.members[1]?.avatarUrl).toBe('https://example.com/2.png');
    expect(h.host.snapshot.config.roster).toEqual([
      'Seat 0',
      'Seat 2',
      'Seat 3',
      'Seat 4',
      'Seat 5',
    ]);
    expect(
      h.db.prepare('SELECT token FROM player_session WHERE player_id = ?').get('p2')?.token,
    ).toBe('token-2');
    h.wake();
    expect(
      (
        await h.action(h.sockets[1]!, 'room:join', {
          playerId: 'p2',
          playerToken: 'token-2',
        })
      ).ok,
    ).toBe(true);
    expect(h.sockets[1]!.snapshot.members.find((m) => m.id === 'p2')?.claimed).toBe(true);
  });

  it('enforces short names for renames, claims and roster edits on the server', async () => {
    const h = roomHarness();
    await h.action(h.host, 'room:rename', { name: '一二三四五六七八九十十一' });
    expect(h.host.snapshot.members[0]?.name).toBe('一二三四五六七八九十');
    await h.action(h.spectator, 'room:claimSeat', {
      seatId: 'p1',
      name: 'abcdefghijkl',
    });
    expect(h.host.snapshot.members[1]?.name).toBe('abcdefghij');
    await h.action(h.host, 'room:setRoster', {
      names: Array(6).fill('abcdefghijk'),
    });
    expect(h.host.snapshot.members.every((m) => m.name.length <= 10)).toBe(true);
  });

  it('requires referee authorization and rehydrates a rewound game from persisted events', async () => {
    const h = roomHarness();
    await h.action(h.host, 'room:removeSeat', { seatId: 'p1' });
    await h.action(h.host, 'room:start');
    expect((await h.action(h.host, 'admin:startAssassination')).error?.code).toBe('NOT_ADMIN');
    expect((await h.action(h.host, 'admin:previousPhase')).error?.code).toBe('NOT_ADMIN');
    const ordinaryPlayer = h.sockets.find(
      (s) => s !== h.spectator && s.game.selfRole !== 'Assassin',
    )!;
    expect(
      (
        await h.action(ordinaryPlayer, 'game:startAssassination', {
          admin: true,
        })
      ).error?.code,
    ).toBe('NOT_ASSASSIN');
    await h.action(h.host, 'admin:auth');
    await h.action(h.host, 'admin:startAssassination');
    await h.action(h.host, 'admin:previousPhase');
    expect(h.host.game.phase).toBe('TeamBuilding');
    h.wake();
    await h.action(h.spectator, 'room:join');
    expect(h.spectator.game.phase).toBe('TeamBuilding');
    expect(h.spectator.game.logs.some((log) => log.key === 'admin.phaseReturned')).toBe(true);
    expect(h.spectator.game).not.toHaveProperty('phaseHistory');
    expect(h.spectator.game.players.every((p) => !p.role)).toBe(true);
  });

  it('keeps the room, seats, tokens, voice and previous replay across two games', async () => {
    const h = roomHarness();
    await h.action(h.host, 'room:removeSeat', { seatId: 'p1' });
    expect((await h.action(h.host, 'room:restart')).error?.code).toBe('WRONG_PHASE');
    await h.action(h.host, 'room:start');
    const firstId = h.host.game.gameId!;
    await h.finish();
    expect((await h.action(h.spectator, 'room:restart')).error?.code).toBe('NOT_HOST');
    const players = h.db.prepare('SELECT * FROM player ORDER BY seat').all();
    const sessions = h.db.prepare('SELECT * FROM player_session').all();
    expect((await h.action(h.host, 'room:restart')).ok).toBe(true);
    expect(h.host.snapshot.status).toBe('lobby');
    expect(h.spectator.snapshot.status).toBe('lobby');
    expect(h.db.prepare('SELECT * FROM player ORDER BY seat').all()).toEqual(players);
    expect(h.db.prepare('SELECT * FROM player_session').all()).toEqual(sessions);
    expect(h.db.prepare('SELECT meeting_id FROM voice_meeting').get()?.meeting_id).toBe(
      'meeting-123',
    );
    expect(h.db.prepare('SELECT participant_id FROM voice_participant').get()?.participant_id).toBe(
      'voice-p0',
    );
    expect(h.archives.get(firstId)?.outcome?.winner).toBe('evil');
    h.wake();
    await h.action(h.sockets[1]!, 'room:join', {
      playerId: 'p2',
      playerToken: 'token-2',
    });
    expect(h.sockets[1]!.deserializeAttachment().playerId).toBe('p2');
    await h.action(h.host, 'room:start');
    const secondId = h.host.game.gameId!;
    expect(secondId).not.toBe(firstId);
    expect(h.host.game.roleAcks).toEqual([]);
    expect(h.host.game.missionResults).toEqual([]);
    expect(h.host.game.previousPhase).toBeUndefined();
    await h.finish();
    expect(h.archives.size).toBe(2);
  });

  it('retains finished state if the replay cannot be archived before restarting', async () => {
    const h = roomHarness();
    await h.action(h.host, 'room:removeSeat', { seatId: 'p1' });
    await h.action(h.host, 'room:start');
    await h.finish();
    const events = h.db.prepare('SELECT * FROM game_event').all();
    h.store.mockRejectedValueOnce(new Error('Archive unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await h.action(h.host, 'room:restart')).ok).toBe(false);
    expect(h.db.prepare('SELECT status FROM room_meta').get()?.status).toBe('finished');
    expect(h.db.prepare('SELECT * FROM game_event').all()).toEqual(events);
    expect((await h.action(h.host, 'room:restart')).ok).toBe(true);
  });
});
