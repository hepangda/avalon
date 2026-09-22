import { DurableObject } from 'cloudflare:workers';
import type { ReplayData } from '@/lib/game/replayTypes';
import type { Env } from './env';

/**
 * Permanent per-game replay archive, keyed by gameId (via idFromName(gameId)).
 * When a game ends, the RoomDurableObject builds the full ReplayData from its
 * event log and ships it here, so `GET /api/games/:id/replay` routes straight
 * to this object by gameId — no Postgres, no external index, and replay
 * lifetime is decoupled from the (recyclable) room.
 */
export class ReplayDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS replay_archive (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      game_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      payload TEXT NOT NULL
    )`);
  }

  /** Commit before acknowledging. No TTL, eviction cleanup, or room dependency. */
  store(replay: ReplayData, revision = 0): void {
    if (!replay.gameId || !replay.outcome) throw new Error('Cannot archive an unfinished game');
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid replay revision');
    // Retrying an old archive must never overwrite a newer referee correction.
    this.ctx.storage.sql.exec(
      `INSERT INTO replay_archive (id, game_id, revision, payload) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload
       WHERE replay_archive.game_id = excluded.game_id AND excluded.revision > replay_archive.revision`,
      replay.gameId, revision, JSON.stringify(replay),
    );
  }

  /** Fetch the stored replay, or null if this game was never archived. */
  async load(): Promise<ReplayData | null> {
    const row = this.ctx.storage.sql.exec<{ payload: string }>(
      'SELECT payload FROM replay_archive WHERE id = 1',
    ).toArray()[0];
    if (row) return JSON.parse(row.payload) as ReplayData;
    // Preserve replays already saved by the previous durable KV implementation.
    return (await this.ctx.storage.get<ReplayData>('replay')) ?? null;
  }
}
