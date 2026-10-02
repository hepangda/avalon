import { canonicalJson } from '@/lib/socket/stateIntegrity';
import { createHash } from 'node:crypto';
import { setImmediate as yieldToIO } from 'node:timers/promises';
import type { RoomDocument } from './persistence';

export class JournalIntegrityError extends Error {
  constructor(message: string) { super(message); this.name = 'JournalIntegrityError'; }
}

export const JOURNAL_FORMAT = 1;
export const CHECKPOINT_EVERY = 32;
export const CHECKPOINT_INTERVAL_MS = 60_000;

type Path = Array<string | number>;
export type StateChange =
  | { op: 'set'; path: Path; value: unknown }
  | { op: 'delete'; path: Path }
  | { op: 'splice'; path: Path; index: number; remove: number; items: unknown[] };
export interface RoomChange {
  format: 1;
  baseHash: string;
  hash: string;
  changes: StateChange[];
}
export interface JournalEntry extends RoomChange { version: number }

export function documentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** Append-only arrays (events, logs, phase history) persist only their new tail. */
export function diffState(before: unknown, after: unknown, path: Path = [], changes: StateChange[] = []): StateChange[] {
  if (Object.is(before, after)) return changes;
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.min(before.length, after.length);
    for (let i = 0; i < length; i++) diffState(before[i], after[i], [...path, i], changes);
    if (before.length !== after.length)
      changes.push({ op: 'splice', path, index: length, remove: before.length - length, items: structuredClone(after.slice(length)) });
  } else if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    const a = before as Record<string, unknown>;
    const b = after as Record<string, unknown>;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (b[key] === undefined) {
        if (a[key] !== undefined) changes.push({ op: 'delete', path: [...path, key] });
      } else diffState(a[key], b[key], [...path, key], changes);
    }
  } else if (after !== undefined) changes.push({ op: 'set', path, value: structuredClone(after) });
  return changes;
}

/** Apply only server-generated persisted changes; reject unsafe/corrupt paths. */
export function applyChanges(document: RoomDocument, changes: StateChange[]): RoomDocument {
  if (!Array.isArray(changes)) throw new JournalIntegrityError('Invalid journal changes');
  let root = structuredClone(document);
  for (const change of changes) {
    if (!change || !Array.isArray(change.path) || change.path.some((key) =>
      typeof key !== 'string' && (!Number.isSafeInteger(key) || key < 0) ||
      key === '__proto__' || key === 'constructor' || key === 'prototype')) throw new JournalIntegrityError('Invalid journal path');
    if (!change.path.length) {
      if (change.op !== 'set') throw new JournalIntegrityError('Invalid journal root operation');
      root = structuredClone(change.value) as RoomDocument;
      continue;
    }
    let parent: unknown = root;
    const parentPath = change.op === 'splice' ? change.path : change.path.slice(0, -1);
    for (const key of parentPath) {
      if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key)) throw new JournalIntegrityError('Missing journal path');
      parent = (parent as Record<string | number, unknown>)[key];
    }
    if (!parent || typeof parent !== 'object') throw new JournalIntegrityError('Invalid journal parent');
    if (change.op === 'splice') {
      if (!Array.isArray(parent) || !Number.isSafeInteger(change.index) || !Number.isSafeInteger(change.remove) ||
        change.index < 0 || change.remove < 0 || change.index + change.remove > parent.length || !Array.isArray(change.items)) throw new JournalIntegrityError('Invalid journal splice');
      parent.splice(change.index, change.remove, ...structuredClone(change.items));
    } else {
      const key = change.path.at(-1)!;
      if (change.op === 'delete') delete (parent as Record<string | number, unknown>)[key];
      else if (change.op === 'set') (parent as Record<string | number, unknown>)[key] = structuredClone(change.value);
      else throw new JournalIntegrityError('Unknown journal operation');
    }
  }
  return root;
}

function* restoreJournal(document: RoomDocument, snapshotVersion: number, snapshotHash: string | null, entries: JournalEntry[], version: number, hash: string | null): Generator<void, RoomDocument> {
  let current = document;
  let digest = documentHash(current);
  if (snapshotHash && digest !== snapshotHash) throw new JournalIntegrityError('Room snapshot hash mismatch');
  let revision = snapshotVersion;
  for (const entry of entries) {
    if (entry.format !== JOURNAL_FORMAT || entry.version !== revision + 1 || entry.baseHash !== digest)
      throw new JournalIntegrityError('Room journal gap or base hash mismatch');
    current = applyChanges(current, entry.changes);
    digest = documentHash(current);
    if (entry.hash !== digest) throw new JournalIntegrityError('Room journal hash mismatch');
    revision = entry.version;
    yield;
  }
  if (revision !== version || (hash && digest !== hash)) throw new JournalIntegrityError('Room journal head mismatch');
  return current;
}

export function replayJournal(...args: Parameters<typeof restoreJournal>): RoomDocument {
  const restore = restoreJournal(...args);
  let step = restore.next();
  while (!step.done) step = restore.next();
  return step.value;
}

/** Verification is off the room command queue and yields between entries for other rooms/pings. */
export async function replayJournalAsync(...args: Parameters<typeof restoreJournal>): Promise<RoomDocument> {
  const restore = restoreJournal(...args);
  let step = restore.next();
  while (!step.done) {
    await yieldToIO();
    step = restore.next();
  }
  return step.value;
}
