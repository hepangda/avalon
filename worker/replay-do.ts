import { DurableObject } from 'cloudflare:workers';
import type { ReplayData } from '@/lib/game/replayTypes';
import type { Env } from './env';

/**
 * Immutable per-game replay archive, keyed by gameId (via idFromName(gameId)).
 * When a game ends, the RoomDurableObject builds the full ReplayData from its
 * event log and ships it here, so `GET /api/games/:id/replay` routes straight
 * to this object by gameId — no Postgres, no external index, and replay
 * lifetime is decoupled from the (recyclable) room.
 */
export class ReplayDurableObject extends DurableObject<Env> {
  /** Store the immutable replay blob (called once, at game over). */
  async store(replay: ReplayData): Promise<void> {
    await this.ctx.storage.put('replay', replay);
  }

  /** Fetch the stored replay, or null if this game was never archived. */
  async load(): Promise<ReplayData | null> {
    return (await this.ctx.storage.get<ReplayData>('replay')) ?? null;
  }
}
