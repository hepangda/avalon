import { DurableObject } from 'cloudflare:workers';
import { sanitizeName } from '@/lib/game/displayName';
import type { Env } from './env';

/** One persistent profile per OIDC issuer/subject, independent of login sessions and rooms. */
export class AccountProfileDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS account_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      alias TEXT NOT NULL
    )`);
  }

  getAlias(): string | null {
    return (
      this.ctx.storage.sql
        .exec<{ alias: string }>('SELECT alias FROM account_profile WHERE id = 1')
        .toArray()[0]?.alias ?? null
    );
  }

  setAlias(value: string): string {
    const alias = sanitizeName(value);
    if (!alias) throw new Error('Alias cannot be empty');
    this.ctx.storage.sql.exec(
      `INSERT INTO account_profile (id, alias) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET alias = excluded.alias`,
      alias,
    );
    return alias;
  }
}
