import type { Persistence } from "./persistence";
import { Room } from "./room";

export class RoomRegistry {
  private rooms = new Map<string, Room>();
  constructor(private persistence: Persistence) {}

  /** Restore deadlines even for rooms nobody reconnects to after a restart. */
  async restore(): Promise<void> {
    for (const code of await this.persistence.listRoomCodes()) {
      try {
        await this.get(code).maintainPresence();
      } catch (error) {
        // A damaged room must not prevent other rooms from accepting reconnects.
        console.error('[room] restore presence', code, error);
      }
    }
  }

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
    for (const room of this.rooms.values()) room.stop();
    await Promise.all([...this.rooms.values()].map((room) => room.shutdown()));
  }
}
