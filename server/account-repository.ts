import { normalizeRoleWeights, type RoleWeights } from '@/lib/engine/roleWeights';
import type { DisplayPreferences } from '@/lib/preferences';
import { Pool } from "pg";
import { rewardDay, type RerollCards } from "./reroll-cards";
/** Account queries share the application pool; room settlement remains in its transaction. */
export class AccountRepository {
  constructor(private readonly pool: Pool) { }


  async getRoleWeights(accounts: readonly string[]): Promise<Record<string, RoleWeights>> {
    if (!accounts.length) return {};
    const result = await this.pool.query<{ account: string; weights: unknown }>(
      'SELECT account, weights FROM avalon_role_weights WHERE account = ANY($1::text[])',
      [[...new Set(accounts)]],
    );
    return Object.fromEntries(result.rows.map((row) => [row.account, normalizeRoleWeights(row.weights)]));
  }


  async getCards(account: string, claimAt?: number): Promise<RerollCards> {
    const day = claimAt === undefined ? null : rewardDay(claimAt);
    const result = await this.pool.query<RerollCards>(`INSERT INTO avalon_cards (account, cards, last_daily_day)
      VALUES ($1, CASE WHEN $2::text IS NULL THEN 0 ELSE 1 END, $2)
      ON CONFLICT(account) DO UPDATE SET
        cards = CASE WHEN $2::text IS NOT NULL AND (avalon_cards.last_daily_day IS NULL OR avalon_cards.last_daily_day < $2)
          THEN LEAST(2, avalon_cards.cards + 1) ELSE avalon_cards.cards END,
        last_daily_day = CASE WHEN $2::text IS NOT NULL AND (avalon_cards.last_daily_day IS NULL OR avalon_cards.last_daily_day < $2)
          THEN $2 ELSE avalon_cards.last_daily_day END
      RETURNING cards, completed_games AS "completedGames", last_daily_day AS "lastDailyDay"`, [account, day]);
    return result.rows[0]!;
  }


  async grantDebugCard(account: string): Promise<RerollCards> {
    const result = await this.pool.query<RerollCards>(`INSERT INTO avalon_cards (account, cards)
      VALUES ($1, 1) ON CONFLICT(account) DO UPDATE SET cards = LEAST(2, avalon_cards.cards + 1)
      RETURNING cards, completed_games AS "completedGames", last_daily_day AS "lastDailyDay"`, [account]);
    return result.rows[0]!;
  }


  async getPreferences(account: string): Promise<Partial<DisplayPreferences>> {
    const result = await this.pool.query<{ preferences: Partial<DisplayPreferences> }>(
      'SELECT preferences FROM avalon_profiles WHERE account = $1', [account]);
    return result.rows[0]?.preferences ?? {};
  }


  async savePreferences(account: string, patch: Partial<DisplayPreferences>): Promise<Partial<DisplayPreferences>> {
    // Merge in PostgreSQL so concurrent devices updating different fields cannot lose changes.
    const result = await this.pool.query<{ preferences: Partial<DisplayPreferences> }>(
      `INSERT INTO avalon_profiles (account, preferences) VALUES ($1, $2::jsonb)
       ON CONFLICT(account) DO UPDATE SET preferences = avalon_profiles.preferences || excluded.preferences
       RETURNING preferences`, [account, JSON.stringify(patch)]);
    return result.rows[0]!.preferences;
  }


  async getAlias(account: string): Promise<string | null> {
    const result = await this.pool.query<{ alias: string }>(
      "SELECT alias FROM avalon_profiles WHERE account = $1",
      [account],
    );
    return result.rows[0]?.alias || null;
  }


  async setAlias(account: string, alias: string): Promise<string> {
    await this.pool.query(
      `INSERT INTO avalon_profiles (account, alias) VALUES ($1, $2)
      ON CONFLICT(account) DO UPDATE SET alias = excluded.alias`,
      [account, alias],
    );
    return alias;
  }
}
