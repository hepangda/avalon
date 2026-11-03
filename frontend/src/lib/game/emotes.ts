/** The table's fixed reactions. Broadcast only: never part of game state, logs or replays. */
export const EMOTES = ['approve', 'reject', 'trust', 'suspect', 'question', 'ponder'] as const;
export type Emote = (typeof EMOTES)[number];

export interface EmoteEvent {
  playerId: string;
  emote: Emote;
}

/** Shortest wait between two reactions from one seat, mirrored by the server's limit. */
export const EMOTE_GAP_MS = 700;

export function isEmote(value: unknown): value is Emote {
  return typeof value === 'string' && (EMOTES as readonly string[]).includes(value);
}

export function isEmoteEvent(value: unknown): value is EmoteEvent {
  const event = value as Partial<EmoteEvent> | null;
  return !!event && typeof event.playerId === 'string' && isEmote(event.emote);
}

type Listener = (event: EmoteEvent) => void;
const listeners = new Set<Listener>();

/** Reactions arrive outside the synchronized view, so the table subscribes to them directly. */
export function subscribeEmotes(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function publishEmote(event: EmoteEvent): void {
  for (const listener of listeners) listener(event);
}
