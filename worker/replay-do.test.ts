import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './env';
import type { ReplayData } from '@/lib/game/replayTypes';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(protected ctx: DurableObjectState, protected env: Env) {}
  },
}));

import { ReplayDurableObject } from './replay-do';
import app from './index';

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  vi.useRealTimers();
});

function diskArchive() {
  const directory = mkdtempSync(join(tmpdir(), 'avalon-replay-'));
  const path = join(directory, 'replay.sqlite');
  let db = new DatabaseSync(path);
  cleanup.push(() => { db.close(); rmSync(directory, { recursive: true }); });
  db.exec('CREATE TABLE legacy_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const ctx = { storage: {
    sql: { exec(query: string, ...bindings: Array<string | number>) {
      const rows = db.prepare(query).all(...bindings);
      return { toArray: () => rows };
    } },
    get: async (key: string) => {
      const row = db.prepare('SELECT value FROM legacy_kv WHERE key = ?').get(key);
      return row ? JSON.parse(row.value as string) : undefined;
    },
  } } as unknown as DurableObjectState;
  const env = {} as Env;
  let archive = new ReplayDurableObject(ctx, env);
  return {
    get archive() { return archive; },
    reopen: () => {
      db.close();
      db = new DatabaseSync(path);
      archive = new ReplayDurableObject(ctx, env);
    },
    seedLegacy: (replay: ReplayData) => {
      db.prepare('INSERT INTO legacy_kv VALUES (?, ?)').run('replay', JSON.stringify(replay));
    },
  };
}

const replay: ReplayData = {
  gameId: 'permanent-game',
  outcome: { winner: 'good', reason: 'three_missions', missionTally: { good: 3, evil: 0 }, revealedRoles: [] },
  players: [{ id: 'p0', name: '圆桌骑士', seat: 0 }],
  roleAssignments: [{ playerId: 'p0', role: 'Merlin' }],
  rounds: [{
    roundIndex: 0, leaderPlayerId: 'p0', teamSize: 1, finalTeam: ['p0'],
    approved: true, missionSuccess: true, failCount: 0,
    votes: [{ proposalIndex: 0, playerId: 'p0', value: 'approve' }],
    missionCards: [{ playerId: 'p0', card: 'success' }],
  }],
  ladyChecks: [], assassination: null,
};

describe('permanent replay storage', () => {
  it('reads the complete record from an actual disk database after closing, reopening and years passing', async () => {
    const h = diskArchive();
    h.archive.store(replay, 20);
    h.reopen();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2036-01-01'));
    expect(await h.archive.load()).toEqual(replay);
    // The public link only needs its game ID, with no room or login dependency.
    const response = await app.request(`https://avalon.test/api/games/${replay.gameId}/replay`, {}, {
      REPLAY: { idFromName: (id: string) => id, get: () => h.archive },
    } as unknown as Env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(replay);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('keeps legacy durable KV replays readable and persists a later correction in SQLite', async () => {
    const h = diskArchive();
    h.seedLegacy(replay);
    h.reopen();
    expect(await h.archive.load()).toEqual(replay);
    const corrected = { ...replay, assassination: { assassinPlayerId: 'p1', targetPlayerId: 'p0', hitMerlin: true } };
    h.archive.store(corrected, 25);
    h.reopen();
    expect(await h.archive.load()).toEqual(corrected);
  });

  it('accepts newer corrections and never lets stale or duplicate retries overwrite them', async () => {
    const h = diskArchive();
    h.archive.store(replay, 20);
    const corrected = { ...replay, players: [{ ...replay.players[0]!, name: 'Corrected' }] };
    h.archive.store(corrected, 30);
    h.archive.store(replay, 20);
    h.archive.store(replay, 30);
    h.reopen();
    expect(await h.archive.load()).toEqual(corrected);
  });

  it('refuses unfinished records and leaves a completed record intact', async () => {
    const h = diskArchive();
    expect(await h.archive.load()).toBeNull();
    h.archive.store(replay, 20);
    expect(() => h.archive.store({ ...replay, outcome: null }, 21)).toThrow('unfinished');
    h.reopen();
    expect(await h.archive.load()).toEqual(replay);
  });
});
