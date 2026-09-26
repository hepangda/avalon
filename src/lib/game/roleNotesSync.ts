import type { Ack } from '@/lib/socket/types';
import {
  changeRoleNote,
  isRoleNote,
  type RoleNote,
  type RoleNotes,
  type RoleNotesDocument,
  type RoleNotesScope,
  type RoleNotesSyncRequest,
} from './roleNotes';

export interface NotesValue {
  notes: RoleNotes;
  enabled: boolean;
}
type Operation = { seq: number } & (
  | { kind: 'set'; playerId: string; note: RoleNote | null }
  | { kind: 'enabled'; value: boolean }
  | { kind: 'clear' }
  | { kind: 'seed'; value: NotesValue }
);
type Transport = (
  request: RoleNotesSyncRequest,
) => Promise<Ack<RoleNotesDocument>>;

export function readPendingNoteOperations(raw: string | null): Operation[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(value)) return [];
    if (
      !value.every(
        (op) =>
          op &&
          Number.isSafeInteger(op.seq) &&
          op.seq >= 0 &&
          (op.kind === 'clear' ||
            (op.kind === 'enabled' && typeof op.value === 'boolean') ||
            (op.kind === 'set' &&
              typeof op.playerId === 'string' &&
              (op.note === null || isRoleNote(op.note))) ||
            (op.kind === 'seed' &&
              typeof op.value?.enabled === 'boolean' &&
              op.value.notes &&
              typeof op.value.notes === 'object' &&
              !Array.isArray(op.value.notes) &&
              Object.values(op.value.notes).every(isRoleNote))),
      )
    )
      return [];
    return value as Operation[];
  } catch {
    return [];
  }
}

function apply(value: NotesValue, operations: Operation[]): NotesValue {
  let next = value;
  for (const op of operations) {
    if (op.kind === 'set')
      next = {
        ...next,
        notes: changeRoleNote(next.notes, op.playerId, op.note),
      };
    else if (op.kind === 'clear') next = { ...next, notes: {} };
    else if (op.kind === 'enabled') next = { ...next, enabled: op.value };
    else next = op.value;
  }
  return next;
}

/** Separates pending edits from downloaded data, preventing stale local caches
 * from overwriting a newer server snapshot after switching devices. */
export class RoleNotesSync {
  private base: RoleNotesDocument | null = null;
  private pending: Operation[];
  private seq: number;
  private busy = false;
  private snapshot: NotesValue & { saveFailed: boolean };
  private listeners = new Set<() => void>();

  constructor(
    private readonly initial: NotesValue,
    pending: Operation[],
    private readonly save: (value: NotesValue, operations: Operation[]) => void,
  ) {
    this.pending = pending;
    this.seq = Math.max(0, ...pending.map((op) => op.seq));
    this.snapshot = { ...apply(initial, pending), saveFailed: false };
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get hasPending() {
    return this.pending.length > 0;
  }

  setNote = (playerId: string, note: RoleNote | null) =>
    this.edit({ seq: ++this.seq, kind: 'set', playerId, note });
  setEnabled = (value: boolean) =>
    this.edit({ seq: ++this.seq, kind: 'enabled', value });
  clearNotes = () => this.edit({ seq: ++this.seq, kind: 'clear' });

  private edit(op: Operation): boolean {
    this.pending = [...this.pending, op];
    this.publish(apply(this.snapshot, [op]));
    return !this.snapshot.saveFailed;
  }

  private publish(value: NotesValue) {
    let saveFailed = false;
    try {
      this.save(value, this.pending);
    } catch {
      saveFailed = true;
    }
    const next = { notes: value.notes, enabled: value.enabled, saveFailed };
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  /** At most one request in flight. Edits made while waiting stay pending. */
  async sync(scope: RoleNotesScope, transport: Transport): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (!this.base) {
        const res = await transport(scope);
        if (!res.ok || !this.matches(scope, res.data)) return;
        this.base = res.data;
        // Migrate existing browser-only notes only if the room has no record.
        if (
          this.base.revision === 0 &&
          (Object.keys(this.initial.notes).length > 0 || !this.initial.enabled)
        ) {
          this.pending = [
            { seq: 0, kind: 'seed', value: this.initial },
            ...this.pending,
          ];
        }
        this.publish(apply(this.base, this.pending));
        if (!this.pending.length) return;
      }
      const through = this.pending.at(-1)?.seq ?? -1;
      const update = this.pending.length
        ? {
            baseRevision: this.base.revision,
            notes: this.snapshot.notes,
            enabled: this.snapshot.enabled,
          }
        : undefined;
      const res = await transport({ ...scope, ...(update ? { update } : {}) });
      if (
        (!res.ok && res.error?.code !== 'NOTES_CONFLICT') ||
        !this.matches(scope, res.data)
      )
        return;
      this.base = res.data;
      if (res.ok && update)
        this.pending = this.pending.filter((op) => op.seq > through);
      // Conflicts preserve pending local intent and merge remote edits elsewhere.
      this.publish(apply(this.base, this.pending));
    } catch {
      // Disconnects/timeouts retain the journal for the next tick or connection.
    } finally {
      this.busy = false;
    }
  }

  private matches(
    scope: RoleNotesScope,
    value: RoleNotesDocument | undefined,
  ): value is RoleNotesDocument {
    return (
      !!value &&
      value.gameId === scope.gameId &&
      value.roleRevision === scope.roleRevision &&
      value.playerId === scope.playerId
    );
  }
}
