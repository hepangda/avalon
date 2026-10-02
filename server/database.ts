import { ALL_ROLES,settledRoleWeights,type RoleWeights } from '@/lib/engine/roleWeights';
import type { ReplayData } from "@/lib/game/replayTypes";
import { randomUUID } from "node:crypto";
import { Pool,type PoolClient } from "pg";
import { AccountRepository } from './account-repository';
import { DDL } from './database-schema';
import {
RoomConflict,
type Persistence,
type RoomDocument,
type RoomRecord,
} from "./persistence";
import { type RerollCards } from "./reroll-cards";
import { documentHash,replayJournalAsync,type JournalEntry,type RoomChange } from "./room-journal";

import type { DisplayPreferences } from '@/lib/preferences';



export class PostgresPersistence implements Persistence {
  readonly pool: Pool;
  private readonly profiles: AccountRepository;
  private owner: PoolClient | null = null;
  private token = randomUUID();
  private available = false;

  constructor(connectionString: string, max = 10) {
    if (!connectionString) throw new Error("DATABASE_URL is required");
    if (!Number.isInteger(max) || max < 2)
      throw new Error("PG_POOL_MAX must be at least 2");
    this.pool = new Pool({
      connectionString,
      max,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 10_000,
      idle_in_transaction_session_timeout: 15_000,
      application_name: "avalon",
    });
    this.profiles = new AccountRepository(this.pool);
    this.pool.on("error", (error) =>
      console.error("[postgres] idle connection error", error.message),
    );
  }

  async start(onOwnershipLost: () => void = () => {}): Promise<void> {
    const owner = await this.pool.connect();
    this.owner = owner;
    owner.on("error", () => {
      this.available = false;
      onOwnershipLost();
    });
    try {
      // One live application process. This connection stays checked out; rooms do not.
      const lock = await owner.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(1096171852, 1) AS locked",
      );
      if (!lock.rows[0]?.locked)
        throw new Error(
          "Another Avalon server owns this database; stop it first",
        );
      await owner.query(DDL);
      await owner.query(
        `INSERT INTO avalon_runtime (id, token) VALUES (1, $1)
        ON CONFLICT(id) DO UPDATE SET token = excluded.token`,
        [this.token],
      );
      this.available = true;
    } catch (error) {
      owner.release(true);
      this.owner = null;
      throw error;
    }
  }

  async health(): Promise<void> {
    if (!this.available) throw new Error("Database ownership unavailable");
    await this.pool.query("SELECT 1");
  }

  async loadRoom(code: string): Promise<RoomRecord | null> {
    if (!this.available) throw new Error("Database ownership unavailable");
    // One statement uses one MVCC snapshot, including concurrent checkpoint compaction.
    const result = await this.pool.query<{
      version: number; document: RoomDocument; snapshot_version: number;
      snapshot_hash: string | null; state_hash: string | null; entries: JournalEntry[];
    }>(`SELECT r.*, COALESCE((SELECT jsonb_agg(j.entry || jsonb_build_object('version', j.version) ORDER BY j.version)
      FROM avalon_room_journal j WHERE j.code = r.code AND j.version > r.snapshot_version), '[]'::jsonb) AS entries
      FROM avalon_rooms r WHERE code = $1`, [code]);
    const row = result.rows[0];
    if (!row) return null;
    return { version: row.version, document: await replayJournalAsync(row.document, row.snapshot_version,
      row.snapshot_hash, row.entries, row.version, row.state_hash) };
  }

  async checkpointRoom(code: string, version: number, document: RoomDocument): Promise<void> {
    if (!this.available) throw new Error("Database ownership unavailable");
    const hash = documentHash(document);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const owner = await client.query<{ token: string }>('SELECT token FROM avalon_runtime WHERE id = 1 FOR SHARE');
      if (owner.rows[0]?.token !== this.token) throw new Error('Database ownership lost');
      const result = await client.query<{ version: number; document: RoomDocument; snapshot_version: number; snapshot_hash: string | null }>(
        'SELECT version, document, snapshot_version, snapshot_hash FROM avalon_rooms WHERE code = $1 FOR UPDATE', [code]);
      const row = result.rows[0];
      if (!row || row.version < version) throw new RoomConflict();
      if (row.snapshot_version < version) {
        const journal = await client.query<{ version: number; entry: RoomChange }>(
          'SELECT version, entry FROM avalon_room_journal WHERE code = $1 AND version > $2 AND version <= $3 ORDER BY version',
          [code, row.snapshot_version, version]);
        // Never compact unverified history or replace good evidence on a mismatch.
        await replayJournalAsync(row.document, row.snapshot_version, row.snapshot_hash,
          journal.rows.map(({ version, entry }) => ({ ...entry, version })), version, hash);
        await client.query('UPDATE avalon_rooms SET document = $2, snapshot_version = $3, snapshot_hash = $4 WHERE code = $1',
          [code, JSON.stringify(document), version, hash]);
        await client.query('DELETE FROM avalon_room_journal WHERE code = $1 AND version <= $2', [code, version]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async saveRoom(
    code: string,
    version: number,
    document: RoomDocument,
    spendAccount?: string,
    change?: RoomChange,
  ): Promise<number> {
    if (!this.available) throw new Error("Database ownership unavailable");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Fence an old process even if its lock connection died before it noticed.
      const owner = await client.query<{ token: string }>(
        "SELECT token FROM avalon_runtime WHERE id = 1 FOR SHARE",
      );
      if (owner.rows[0]?.token !== this.token)
        throw new Error("Database ownership lost");
      const next = version + 1;
      const hash = change?.hash ?? documentHash(document);
      const result = version === 0
        ? await client.query(`INSERT INTO avalon_rooms (code, version, document, snapshot_version, snapshot_hash, state_hash)
            VALUES ($1, $2, $3, $2, $4, $4) ON CONFLICT(code) DO NOTHING RETURNING version`,
            [code, next, JSON.stringify(document), hash])
        : change
          ? await client.query(`WITH changed AS (
              UPDATE avalon_rooms SET version = $2, state_hash = $3, updated_at = now()
              WHERE code = $1 AND version = $4 AND (state_hash IS NULL OR state_hash = $5) RETURNING version
            ) INSERT INTO avalon_room_journal (code, version, entry)
              SELECT $1, changed.version, $6::jsonb FROM changed RETURNING version`,
              [code, next, hash, version, change.baseHash, JSON.stringify(change)])
          : await client.query(`UPDATE avalon_rooms SET version = $2, document = $3, snapshot_version = $2,
              snapshot_hash = $5, state_hash = $5, updated_at = now() WHERE code = $1 AND version = $4 RETURNING version`,
              [code, next, JSON.stringify(document), version, hash]);
      if (!result.rowCount) throw new RoomConflict();
      if (version > 0 && !change) {
        await client.query('DELETE FROM avalon_room_journal WHERE code = $1 AND version <= $2', [code, next]);
      }
      if (spendAccount) {
        const spent = await client.query('UPDATE avalon_cards SET cards = cards - 1 WHERE account = $1 AND cards > 0 RETURNING account', [spendAccount]);
        if (!spent.rowCount) throw new Error('No reroll cards remaining');
      }
      const archive = document.archive;
      let archiveChanged = false;
      if (archive) {
        if (!archive.replay.outcome || !archive.replay.gameId)
          throw new Error("Cannot archive unfinished game");
        const archived = await client.query(
          `INSERT INTO avalon_replays (game_id, revision, payload) VALUES ($1, $2, $3)
          ON CONFLICT(game_id) DO UPDATE SET revision = excluded.revision,
            payload = excluded.payload, updated_at = now()
          WHERE excluded.revision > avalon_replays.revision`,
          [
            archive.replay.gameId,
            archive.revision,
            JSON.stringify(archive.replay),
          ],
        );
        archiveChanged = !!archived.rowCount;
      }
      if (archive && archiveChanged) {
        for (const account of [...new Set(archive.rewardAccounts ?? [])].sort()) {
          const awarded = await client.query('INSERT INTO avalon_game_rewards (game_id, account) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING account', [archive.replay.gameId, account]);
          if (awarded.rowCount) {
            await client.query(`INSERT INTO avalon_cards (account, completed_games) VALUES ($1, 1)
              ON CONFLICT(account) DO UPDATE SET completed_games = avalon_cards.completed_games + 1,
              cards = LEAST(2, avalon_cards.cards + CASE WHEN (avalon_cards.completed_games + 1) % 5 = 0 THEN 1 ELSE 0 END)`, [account]);
          }
        }
      }
      if (document.game?.phase === 'GameOver' && archive?.roleWeightAssignments) {
        await this.settleRoleWeights(client, archive.replay.gameId, archive.roleWeightAssignments);
      }
      await client.query("COMMIT");
      return next;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  getRoleWeights(accounts: readonly string[]): Promise<Record<string, RoleWeights>> {
    return this.profiles.getRoleWeights(accounts);
  }


  /** Optional preferences must not roll back the game result if their tables fail. */
  private async settleRoleWeights(
    client: PoolClient,
    gameId: string,
    assignments: NonNullable<RoomDocument['archive']>['roleWeightAssignments'],
  ): Promise<void> {
    await client.query('SAVEPOINT role_preferences');
    try {
      // All rooms acquire account locks in the same order. Each delta is based
      // on the locked current value, so concurrent completions cannot lose updates.
      for (const [account, role] of Object.entries(assignments ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
        if (!ALL_ROLES.includes(role)) continue;
        const counted = await client.query(
          'INSERT INTO avalon_role_weight_games (game_id, account) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING account',
          [gameId, account],
        );
        if (!counted.rowCount) continue;
        await client.query('INSERT INTO avalon_role_weights (account) VALUES ($1) ON CONFLICT DO NOTHING', [account]);
        const current = await client.query<{ weights: unknown }>(
          'SELECT weights FROM avalon_role_weights WHERE account = $1 FOR UPDATE', [account],
        );
        await client.query('UPDATE avalon_role_weights SET weights = $2 WHERE account = $1', [
          account, JSON.stringify(settledRoleWeights(current.rows[0]?.weights, role)),
        ]);
      }
      await client.query('RELEASE SAVEPOINT role_preferences');
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT role_preferences');
      await client.query('RELEASE SAVEPOINT role_preferences');
      console.warn('[roles] Optional role weight settlement unavailable; game result retained');
    }
  }
  getCards(account: string, claimAt?: number): Promise<RerollCards> {
    return this.profiles.getCards(account, claimAt);
  }

  grantDebugCard(account: string): Promise<RerollCards> {
    return this.profiles.grantDebugCard(account);
  }


  async loadReplay(gameId: string): Promise<ReplayData | null> {
    const result = await this.pool.query<{ payload: ReplayData }>(
      "SELECT payload FROM avalon_replays WHERE game_id = $1",
      [gameId],
    );
    return result.rows[0]?.payload ?? null;
  }
  getPreferences(account: string): Promise<Partial<DisplayPreferences>> {
    return this.profiles.getPreferences(account);
  }

  savePreferences(account: string, patch: Partial<DisplayPreferences>): Promise<Partial<DisplayPreferences>> {
    return this.profiles.savePreferences(account, patch);
  }

  getAlias(account: string): Promise<string | null> {
    return this.profiles.getAlias(account);
  }

  setAlias(account: string, alias: string): Promise<string> {
    return this.profiles.setAlias(account, alias);
  }


  async close(): Promise<void> {
    this.available = false;
    this.owner?.release(true);
    this.owner = null;
    await this.pool.end();
  }
}
