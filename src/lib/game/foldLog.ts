import type { ClientLogEntry } from '@/lib/engine';

export type LogItem =
  | { kind: 'entry'; entry: ClientLogEntry }
  | { kind: 'speeches'; key: number; entries: ClientLogEntry[] };

const SPEECH_KEYS = new Set(['speechBegins', 'admin.speechSkipped']);

/** One discussion's run of "X speaks now" lines becomes a single entry that opens to show them. */
export function foldLog(entries: ClientLogEntry[]): LogItem[] {
  const items: LogItem[] = [];
  for (const entry of entries) {
    const previous = items.at(-1);
    if (!SPEECH_KEYS.has(entry.key)) items.push({ kind: 'entry', entry });
    else if (previous?.kind === 'speeches') previous.entries.push(entry);
    else items.push({ kind: 'speeches', key: entry.seq, entries: [entry] });
  }
  return items;
}
