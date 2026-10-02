import { buildStartedGame,FIVE_P } from '@/lib/engine/testkit';
import { canonicalJson,sha256 } from '@/lib/socket/stateIntegrity';
import { describe,expect,it } from 'vitest';
import type { RoomDocument } from './persistence';
import { DEFAULT_ROOM_CONFIG } from './room-helpers';
import { applyChanges,diffState,documentHash,replayJournal,type JournalEntry } from './room-journal';

function document(): RoomDocument {
  return { schemaVersion: 1, meta: { code: '1234', hostToken: 'secret', status: 'in_game', config: DEFAULT_ROOM_CONFIG, gameId: 'game', seed: 'seed' },
    members: [], game: buildStartedGame(FIVE_P), eventSeq: 0, events: [], sessions: {}, notes: {}, archive: null };
}
function entry(before: RoomDocument, after: RoomDocument, version = 2): JournalEntry {
  return { format: 1, version, baseHash: documentHash(before), hash: documentHash(after), changes: diffState(before, after) };
}

describe('verified room journal', () => {
  it('uses the same canonical SHA-256 in Node, browsers and JSONB field order', async () => {
    const a = { z: undefined, nested: { b: ['你好', null, 3], a: true } };
    const b = { nested: { a: true, b: ['你好', null, 3] } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(await sha256(a)).toBe(documentHash(b));
  });

  it('recovers game state, seat ownership, notes, referee logs, arrays and deletions', () => {
    const before = document();
    const after = structuredClone(before);
    after.sessions.p0 = 'new-token';
    after.accounts = { p0: 'account' };
    after.notes.p0 = { playerId: 'p0', gameId: 'game', roleRevision: 0, revision: 1, notes: { p1: 'Merlin' }, enabled: false };
    after.game!.logs.push({ seq: 999, at: 123, roundIndex: 0, channel: 'public', key: 'admin.panelOpened' });
    after.game!.players[0]!.name = 'Renamed';
    after.game!.roleAcks = ['p0'];
    const record = entry(before, after);
    const recovered = replayJournal(before, 1, documentHash(before), [record], 2, record.hash);
    expect(recovered).toEqual(after);
    expect(before.sessions).toEqual({});
    const reset = structuredClone(after);
    reset.game = null; reset.events = []; reset.notes = {}; delete reset.accounts;
    expect(applyChanges(after, diffState(after, reset))).toEqual(reset);
  });

  it('persists a small appended tail instead of rewriting growing history', () => {
    const before = document();
    before.game!.logs = Array.from({ length: 1000 }, (_, seq) => ({ seq, at: seq, roundIndex: 0, channel: 'public', key: 'history' }));
    const after = structuredClone(before);
    after.game!.logs.push({ seq: 1001, at: 1001, roundIndex: 0, channel: 'public', key: 'next' });
    const record = entry(before, after);
    expect(JSON.stringify(record).length).toBeLessThan(JSON.stringify(after).length / 50);
    expect(replayJournal(before, 1, documentHash(before), [record], 2, record.hash)).toEqual(after);
  });

  it.each(['snapshot', 'gap', 'base', 'entry', 'head', 'format'])('rejects %s corruption', (kind) => {
    const before = document(); const after = structuredClone(before); after.meta.status = 'finished';
    const record = entry(before, after);
    let snapshotHash = documentHash(before); let headHash = record.hash;
    if (kind === 'snapshot') snapshotHash = 'corrupt';
    if (kind === 'gap') record.version++;
    if (kind === 'base') record.baseHash = 'corrupt';
    if (kind === 'entry') record.changes = [];
    if (kind === 'head') headHash = 'corrupt';
    if (kind === 'format') record.format = 2 as 1;
    expect(() => replayJournal(before, 1, snapshotHash, [record], 2, headHash)).toThrow();
  });

  it('accepts a legacy unhashed snapshot and verifies subsequent journal entries', () => {
    const before = document(); const after = structuredClone(before); after.meta.status = 'finished';
    const record = entry(before, after);
    expect(replayJournal(before, 1, null, [record], 2, record.hash)).toEqual(after);
    expect(() => replayJournal(before, 1, null, [], 2, record.hash)).toThrow('head');
  });

  it('rejects prototype pollution and nonexistent paths', () => {
    expect(() => applyChanges(document(), [{ op: 'set', path: ['__proto__', 'polluted'], value: true }])).toThrow();
    expect(() => applyChanges(document(), [{ op: 'set', path: ['missing', 'field'], value: true }])).toThrow();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});
