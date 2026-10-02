import { afterEach, describe, expect, it, vi } from "vitest";
import { roomHarness } from './test-room';

afterEach(() => vi.restoreAllMocks());

describe('background checkpoint lifecycle', () => {
  it('verifies pending changes after the interval without holding the room queue', async () => {
    vi.useFakeTimers();
    try {
      const h = roomHarness();
      let release!: () => void;
      const checkpoint = vi.fn(() => new Promise<void>((done) => { release = done; }));
      const persistence = h.persistence as import('./persistence').Persistence;
      persistence.checkpointRoom = checkpoint;
      await h.action(h.host, 'room:rename', { name: 'First' });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(checkpoint).toHaveBeenCalledOnce();
      expect((await h.action(h.host, 'net:ping')).ok).toBe(true);
      expect((await h.action(h.host, 'room:rename', { name: 'Second' })).ok).toBe(true);
      release();
      await Promise.resolve(); await Promise.resolve();
      checkpoint.mockResolvedValue(undefined);
      await h.room.drain();
      expect(checkpoint).toHaveBeenLastCalledWith('1234', expect.any(Number), expect.objectContaining({ members: expect.arrayContaining([expect.objectContaining({ name: 'Second' })]) }));
    } finally { vi.clearAllTimers(); vi.useRealTimers(); }
  });

  it('quarantines a room after verification finds corrupt history', async () => {
    const { JournalIntegrityError } = await import('./room-journal');
    const h = roomHarness();
    (h.persistence as import('./persistence').Persistence).checkpointRoom = vi.fn().mockRejectedValue(new JournalIntegrityError('Room journal hash mismatch'));
    vi.spyOn(console, 'error').mockImplementation(() => { });
    await h.action(h.host, 'room:rename', { name: 'Saved' });
    await h.room.drain();
    const writes = h.save.mock.calls.length;
    expect((await h.action(h.host, 'room:rename', { name: 'Refused' })).ok).toBe(false);
    expect((await h.action(h.host, 'net:ping')).ok).toBe(false);
    expect(h.save).toHaveBeenCalledTimes(writes);
    expect(h.document.members[0]!.name).toBe('Saved');
  });
});
