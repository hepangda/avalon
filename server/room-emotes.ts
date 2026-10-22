import type { ClientGameState } from '@/lib/engine';
import { EMOTE_GAP_MS, isEmote, type EmoteEvent } from '@/lib/game/emotes';
import type { Ack } from '@/lib/socket/types';
import { fail, ok } from './room-result';

/** A seat may send a short burst, then one reaction per gap; spam is dropped, not queued. */
export const EMOTE_BURST = 4;
export const EMOTE_WINDOW_MS = 6_000;

export class EmoteLimiter {
  private sent = new Map<string, number[]>();

  constructor(
    private readonly burst = EMOTE_BURST,
    private readonly windowMs = EMOTE_WINDOW_MS,
    private readonly gapMs = EMOTE_GAP_MS,
  ) {}

  /** Records the reaction when it is allowed. */
  allow(playerId: string, now: number): boolean {
    const recent = (this.sent.get(playerId) ?? []).filter((at) => now - at < this.windowMs);
    const last = recent.at(-1);
    if (recent.length >= this.burst || (last !== undefined && now - last < this.gapMs)) {
      this.sent.set(playerId, recent);
      return false;
    }
    recent.push(now);
    this.sent.set(playerId, recent);
    return true;
  }

  forget(playerId: string): void {
    this.sent.delete(playerId);
  }
}

/**
 * Validate a reaction against the sender's committed view: only a seated
 * player at a dealt table may react, and only with one of the fixed emotes.
 */
export function readEmote(
  view: { game: ClientGameState | null; playerId: string | null } | undefined,
  payload: unknown,
  limiter: EmoteLimiter,
  now: number,
): Ack<EmoteEvent> {
  if (!view) return fail('NOT_IN_ROOM', 'Join the room first');
  const { game, playerId } = view;
  if (!game || !playerId || game.isSpectator || !game.players.some((p) => p.id === playerId))
    return fail('NOT_SEATED', 'Only seated players can react');
  const emote = (payload as { emote?: unknown } | null)?.emote;
  if (!isEmote(emote)) return fail('INVALID', 'Unknown emote');
  if (!limiter.allow(playerId, now)) return fail('RATE_LIMITED', 'Too many reactions');
  return ok({ playerId, emote });
}
