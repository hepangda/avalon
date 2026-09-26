import { describe, expect, it, vi } from 'vitest';
import {
  RoleNotesSync,
  readPendingNoteOperations,
  type NotesValue,
} from './roleNotesSync';
import type { RoleNotesDocument, RoleNotesSyncRequest } from './roleNotes';
import type { Ack } from '@/lib/socket/types';

const scope = { gameId: 'game', roleRevision: 1, playerId: 'p0' };
function server(value: Partial<RoleNotesDocument> = {}) {
  let doc: RoleNotesDocument = {
    ...scope,
    revision: 0,
    notes: {},
    enabled: true,
    ...value,
  };
  const transport = vi.fn(
    async (request: RoleNotesSyncRequest): Promise<Ack<RoleNotesDocument>> => {
      if (request.update) {
        if (request.update.baseRevision !== doc.revision)
          return {
            ok: false,
            error: { code: 'NOTES_CONFLICT', message: 'Conflict' },
            data: structuredClone(doc),
          };
        doc = {
          ...doc,
          notes: request.update.notes,
          enabled: request.update.enabled,
          revision: doc.revision + 1,
        };
      }
      return { ok: true, data: structuredClone(doc) };
    },
  );
  return {
    transport,
    get doc() {
      return doc;
    },
  };
}
const empty = (): NotesValue => ({ notes: {}, enabled: true });

describe('private notes synchronization', () => {
  it('migrates existing browser notes once and restores them on a fresh device', async () => {
    const remote = server();
    const first = new RoleNotesSync(
      { notes: { p1: 'Merlin' }, enabled: false },
      [],
      vi.fn(),
    );
    await first.sync(scope, remote.transport);
    expect(remote.doc).toMatchObject({
      revision: 1,
      notes: { p1: 'Merlin' },
      enabled: false,
    });
    const second = new RoleNotesSync(empty(), [], vi.fn());
    await second.sync(scope, remote.transport);
    expect(second.getSnapshot()).toEqual({
      notes: { p1: 'Merlin' },
      enabled: false,
      saveFailed: false,
    });
    expect(second.hasPending).toBe(false);
  });

  it('does not replace a newer server copy with a stale cache, including a server-side clear', async () => {
    const remote = server({ revision: 4, notes: {}, enabled: false });
    const client = new RoleNotesSync(
      { notes: { p1: 'Morgana' }, enabled: true },
      [],
      vi.fn(),
    );
    await client.sync(scope, remote.transport);
    expect(client.getSnapshot()).toMatchObject({ notes: {}, enabled: false });
    expect(remote.transport).toHaveBeenCalledTimes(1);
    expect(remote.doc.revision).toBe(4);
  });

  it('persists offline intent and merges it with server changes after refreshing', async () => {
    const remote = server({ revision: 2, notes: { p2: 'Percival' } });
    let saved = empty();
    let journal = '[]';
    const offline = new RoleNotesSync(empty(), [], (value, ops) => {
      saved = value;
      journal = JSON.stringify(ops);
    });
    offline.setNote('p1', 'Merlin');
    offline.setEnabled(false);
    await offline.sync(scope, async () => ({ ok: false }));
    expect(offline.hasPending).toBe(true);
    const refreshed = new RoleNotesSync(
      saved,
      readPendingNoteOperations(journal),
      vi.fn(),
    );
    await refreshed.sync(scope, remote.transport);
    expect(remote.doc).toMatchObject({
      revision: 3,
      notes: { p1: 'Merlin', p2: 'Percival' },
      enabled: false,
    });
    expect(refreshed.hasPending).toBe(false);
  });

  it('keeps edits made during an upload pending until the next successful upload', async () => {
    const remote = server({ revision: 1 });
    const client = new RoleNotesSync(empty(), [], vi.fn());
    await client.sync(scope, remote.transport);
    client.setNote('p1', 'Merlin');
    let resolve!: (ack: Ack<RoleNotesDocument>) => void;
    let sent!: RoleNotesSyncRequest;
    const upload = client.sync(scope, (request) => {
      sent = request;
      return new Promise((r) => {
        resolve = r;
      });
    });
    client.setNote('p1', 'Morgana');
    client.setNote('p2', 'Percival');
    resolve(await remote.transport(sent));
    await upload;
    expect(remote.doc.notes).toEqual({ p1: 'Merlin' });
    expect(client.getSnapshot().notes).toEqual({
      p1: 'Morgana',
      p2: 'Percival',
    });
    expect(client.hasPending).toBe(true);
    await client.sync(scope, remote.transport);
    expect(remote.doc.notes).toEqual({ p1: 'Morgana', p2: 'Percival' });
    expect(client.hasPending).toBe(false);
  });

  it('rebases conflicting device edits instead of overwriting unrelated notes', async () => {
    const remote = server({ revision: 1 });
    const a = new RoleNotesSync(empty(), [], vi.fn());
    const b = new RoleNotesSync(empty(), [], vi.fn());
    await a.sync(scope, remote.transport);
    await b.sync(scope, remote.transport);
    a.setNote('p1', 'Merlin');
    b.setNote('p2', 'Percival');
    await a.sync(scope, remote.transport);
    await b.sync(scope, remote.transport);
    expect(b.hasPending).toBe(true);
    expect(b.getSnapshot().notes).toEqual({ p1: 'Merlin', p2: 'Percival' });
    await b.sync(scope, remote.transport);
    expect(remote.doc.notes).toEqual({ p1: 'Merlin', p2: 'Percival' });
  });

  it('syncs clear-all and visibility without restoring deleted guesses', async () => {
    const remote = server({ revision: 1, notes: { p1: 'Merlin' } });
    const client = new RoleNotesSync(empty(), [], vi.fn());
    await client.sync(scope, remote.transport);
    client.setEnabled(false);
    await client.sync(scope, remote.transport);
    expect(remote.doc.notes).toEqual({ p1: 'Merlin' });
    client.clearNotes();
    await client.sync(scope, remote.transport);
    expect(remote.doc).toMatchObject({ notes: {}, enabled: false });
    client.setEnabled(true);
    await client.sync(scope, remote.transport);
    expect(remote.doc.notes).toEqual({});
  });

  it('ignores a response for another scope and retries failed writes', async () => {
    const remote = server({ revision: 1 });
    const client = new RoleNotesSync(empty(), [], vi.fn());
    client.setNote('p1', 'evil');
    await client.sync(scope, async () => ({
      ok: true,
      data: { ...remote.doc, playerId: 'other' },
    }));
    expect(client.hasPending).toBe(true);
    await client.sync(scope, async () => {
      throw Error('offline');
    });
    await client.sync(scope, remote.transport);
    expect(remote.doc.notes).toEqual({ p1: 'evil' });
  });

  it('keeps working and can sync when browser storage is blocked', async () => {
    const remote = server();
    const client = new RoleNotesSync(empty(), [], () => {
      throw Error('blocked');
    });
    expect(client.setNote('p1', 'percival-claim')).toBe(false);
    expect(client.getSnapshot().saveFailed).toBe(true);
    await client.sync(scope, remote.transport);
    expect(remote.doc.notes).toEqual({ p1: 'percival-claim' });
  });

  it('recovers when the server stored an update but its acknowledgement was lost', async () => {
    const remote = server({ revision: 1, notes: { p1: 'Merlin' } });
    const client = new RoleNotesSync(empty(), [], vi.fn());
    await client.sync(scope, remote.transport);
    client.clearNotes();
    await client.sync(scope, async (request) => {
      await remote.transport(request);
      return { ok: false, error: { code: 'TIMEOUT', message: 'Ack lost' } };
    });
    expect(client.hasPending).toBe(true);
    await client.sync(scope, remote.transport);
    await client.sync(scope, remote.transport);
    expect(client.hasPending).toBe(false);
    expect(client.getSnapshot().notes).toEqual({});
    expect(remote.doc.notes).toEqual({});
  });
});
