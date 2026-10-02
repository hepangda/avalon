import type { DisplayPreferences } from '@/lib/preferences';
import type { RoomChange } from './room-journal';
import { claimDaily, completeGame, emptyCards, type RerollCards } from "./reroll-cards";
import type { ReplayData } from "@/lib/game/replayTypes";
import { normalizeRoleWeights, settledRoleWeights, type RoleWeights } from '@/lib/engine/roleWeights';
import {
  RoomConflict,
  type Persistence,
  type RoomDocument,
  type RoomRecord,
} from "./persistence";

/** Test double; database integration tests exercise real PostgreSQL separately. */
export class MemoryPersistence implements Persistence {
  rooms = new Map<string, RoomRecord>();
  archives = new Map<string, ReplayData>();
  revisions = new Map<string, number>();
  wallets = new Map<string, RerollCards>();
  rewards = new Set<string>();
  preferences = new Map<string, Partial<DisplayPreferences>>();
  async getPreferences(account: string) { return structuredClone(this.preferences.get(account) ?? {}); }
  async savePreferences(account: string, patch: Partial<DisplayPreferences>) {
    const next = { ...this.preferences.get(account), ...patch };
    this.preferences.set(account, next);
    return structuredClone(next);
  }
  aliases = new Map<string, string>();
  roleWeights = new Map<string, RoleWeights>();
  roleWeightGames = new Set<string>();
  async loadRoom(code: string) {
    return structuredClone(this.rooms.get(code) ?? null);
  }
  async saveRoom(code: string, version: number, document: RoomDocument, spendAccount?: string, _change?: RoomChange) {
    if ((this.rooms.get(code)?.version ?? 0) !== version)
      throw new RoomConflict();
    if (spendAccount) {
      const wallet = this.wallets.get(spendAccount) ?? emptyCards();
      if (!wallet.cards) throw new Error('No reroll cards remaining');
      this.wallets.set(spendAccount, { ...wallet, cards: wallet.cards - 1 });
    }
    for (const account of document.archive?.rewardAccounts ?? []) {
      const key = JSON.stringify([document.archive!.replay.gameId, account]);
      if (this.rewards.has(key)) continue;
      this.rewards.add(key);
      this.wallets.set(account, completeGame(this.wallets.get(account) ?? emptyCards()));
    }
    if (document.game?.phase === 'GameOver' && document.archive) {
      for (const [account, role] of Object.entries(document.archive.roleWeightAssignments ?? {})) {
        const key = JSON.stringify([document.archive.replay.gameId, account]);
        if (this.roleWeightGames.has(key)) continue;
        this.roleWeights.set(account, settledRoleWeights(this.roleWeights.get(account), role));
        this.roleWeightGames.add(key);
      }
    }
    this.rooms.set(code, structuredClone({ version: version + 1, document }));
    const a = document.archive;
    if (a && a.revision > (this.revisions.get(a.replay.gameId) ?? -1)) {
      this.archives.set(a.replay.gameId, structuredClone(a.replay));
      this.revisions.set(a.replay.gameId, a.revision);
    }
    return version + 1;
  }
  async getCards(account: string, claimAt?: number) {
    const wallet = this.wallets.get(account) ?? emptyCards();
    const next = claimAt === undefined ? wallet : claimDaily(wallet, claimAt);
    this.wallets.set(account, next);
    return structuredClone(next);
  }
  async getRoleWeights(accounts: readonly string[]): Promise<Record<string, RoleWeights>> {
    return Object.fromEntries(accounts.map((account) => [account, normalizeRoleWeights(this.roleWeights.get(account))]));
  }
  async loadReplay(gameId: string) {
    return structuredClone(this.archives.get(gameId) ?? null);
  }
  async grantDebugCard(account: string) {
    const wallet = this.wallets.get(account) ?? emptyCards();
    const next = { ...wallet, cards: Math.min(2, wallet.cards + 1) };
    this.wallets.set(account, next);
    return structuredClone(next);
  }
  async getAlias(account: string) {
    return this.aliases.get(account) ?? null;
  }
  async setAlias(account: string, alias: string) {
    this.aliases.set(account, alias);
    return alias;
  }
}
