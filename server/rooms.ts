import type { Persistence } from "./persistence";
import { Room } from "./room";

export class RoomRegistry {
  private rooms = new Map<string, Room>();
  constructor(private persistence: Persistence) {}

  get(code: string): Room {
    let room = this.rooms.get(code);
    if (!room) {
      room = new Room(code, this.persistence);
      this.rooms.set(code, room);
    }
    room.lastUsed = Date.now();
    return room;
  }

  evictIdle(maxIdleMs = 5 * 60_000): void {
    const cutoff = Date.now() - maxIdleMs;
    for (const [code, room] of this.rooms) {
      if (room.idle && room.lastUsed < cutoff) this.rooms.delete(code);
    }
  }

  async drain(): Promise<void> {
    await Promise.all([...this.rooms.values()].map((room) => room.drain()));
  }
}
