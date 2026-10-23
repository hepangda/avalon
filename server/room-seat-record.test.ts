import { afterEach, describe, expect, it, vi } from 'vitest';
import { roomHarness } from './test-room';

afterEach(() => vi.restoreAllMocks());

describe('seat accounts for tablemate records', () => {
  it('resolves a claimed human seat only for an account at the table', async () => {
    const h = roomHarness();
    h.document.accounts = { p0: 'account-0', p2: 'account-2', p3: 'account-3' };
    h.document.members[3]!.isBot = true;
    expect(await h.room.seatAccount('viewer-account', 'p2')).toBe('account-2');
    expect(await h.room.seatAccount('account-0', 'p2')).toBe('account-2');
    expect(await h.room.seatAccount('stranger', 'p2')).toBeNull();
    // Empty seats, bots and unlinked or unknown seats have no record.
    expect(await h.room.seatAccount('account-0', 'p1')).toBeNull();
    expect(await h.room.seatAccount('account-0', 'p3')).toBeNull();
    expect(await h.room.seatAccount('account-0', 'p4')).toBeNull();
    expect(await h.room.seatAccount('account-0', 'nobody')).toBeNull();
  });
});
