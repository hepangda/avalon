import { describe, expect, it } from 'vitest';
import { roomHarness } from './test-room';

describe('room details and public discovery', () => {
  it('defaults legacy rooms to private and only permits the host to publish', async () => {
    const h = roomHarness();
    expect((await h.persistence.listPublicRooms(1)).rooms).toEqual([]);
    expect((await h.action(h.spectator, 'room:details', { name: 'Test', visibility: 'public' })).error?.code).toBe('NOT_HOST');
    expect((await h.action(h.host, 'room:details', { name: '  周五圆桌  ', visibility: 'public' })).ok).toBe(true);
    expect(h.spectator.snapshot).toMatchObject({ name: '周五圆桌', visibility: 'public' });
    expect((await h.persistence.listPublicRooms(1)).rooms).toEqual([
      { code: '1234', name: '周五圆桌', playerCount: 5, maxPlayers: 10 },
    ]);
    h.wake();
    expect((await h.room.preview())?.code).toBe('1234');
    expect(h.document.meta.name).toBe('周五圆桌');
    expect((await h.action(h.host, 'room:details', { name: '周五圆桌', visibility: 'private' })).ok).toBe(true);
    expect((await h.persistence.listPublicRooms(1)).rooms).toEqual([]);
    expect(await h.room.preview()).not.toBeNull();
  });

  it('validates changes atomically and removes started or full rooms', async () => {
    const h = roomHarness();
    for (const payload of [{ name: 'x'.repeat(41), visibility: 'public' }, { name: 'a\nb', visibility: 'public' }, { name: 'OK', visibility: 'other' }, null]) {
      expect((await h.action(h.host, 'room:details', payload as object)).error?.code).toBe('INVALID');
    }
    expect(h.document.meta.visibility).toBeUndefined();
    await h.action(h.host, 'room:details', { name: 'Test', visibility: 'public' });
    await h.action(h.host, 'room:config', { config: { ...h.document.meta.config, maxPlayers: 5 } });
    expect((await h.persistence.listPublicRooms(1)).rooms).toEqual([]);
    await h.action(h.host, 'room:config', { config: { ...h.document.meta.config, maxPlayers: 10 } });
    expect((await h.persistence.listPublicRooms(1)).rooms).toHaveLength(1);
    expect((await h.action(h.host, 'room:start')).ok).toBe(true);
    expect((await h.persistence.listPublicRooms(1)).rooms).toEqual([]);
  });

  it('paginates five at a time and clamps a page after rooms disappear', async () => {
    const h = roomHarness();
    for (let i = 0; i < 12; i++) {
      const document = structuredClone(h.document);
      document.meta.code = String(2000 + i);
      document.meta.visibility = 'public';
      h.persistence.rooms.set(document.meta.code, { version: 1, document });
    }
    const first = await h.persistence.listPublicRooms(1);
    const second = await h.persistence.listPublicRooms(2);
    const last = await h.persistence.listPublicRooms(99);
    expect(first.rooms).toHaveLength(5);
    expect(second.rooms).toHaveLength(5);
    expect(new Set([...first.rooms, ...second.rooms].map((room) => room.code)).size).toBe(10);
    expect(last).toMatchObject({ page: 3, totalPages: 3 });
    expect(last.rooms).toHaveLength(2);
    for (let i = 5; i < 12; i++) h.persistence.rooms.delete(String(2000 + i));
    expect(await h.persistence.listPublicRooms(3)).toMatchObject({ page: 1, totalPages: 1 });
  });
});
