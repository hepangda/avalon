import type { ClientGameState } from "@/lib/engine";
import type { Ack, RoomSnapshot } from "@/lib/socket/types";
import { expect, vi } from "vitest";
import type { RoomSocket, SocketAttachment } from "./env";
import type { RoomDocument } from "./persistence";
import { DEFAULT_ROOM_CONFIG } from "./room-helpers";
import { MemoryPersistence } from "./test-persistence";

import { Room } from "./room";

export class Socket {
  messages: Array<{
    t: string;
    id?: string;
    event?: string;
    payload?: unknown;
    res?: Ack<unknown>;
  }> = [];
  constructor(private attachment: SocketAttachment) { }
  deserializeAttachment() {
    return this.attachment;
  }
  serializeAttachment(attachment: SocketAttachment) {
    this.attachment = attachment;
  }
  send(message: string) {
    this.messages.push(JSON.parse(message));
  }
  close = vi.fn();
  get ws(): RoomSocket {
    return this;
  }
  get game() {
    return this.messages
      .slice()
      .reverse()
      .find((m) => m.event === "state:sync")!.payload as ClientGameState;
  }
  get snapshot() {
    return this.messages
      .slice()
      .reverse()
      .find((m) => m.event === "room:snapshot")!.payload as RoomSnapshot;
  }
}


export function roomHarness(seedRoom = true) {
  const sockets = [0, 2, 3, 4, 5].map(
    (seat) =>
      new Socket({ account: `account-${seat}`, playerId: `p${seat}`, isHost: seat === 0, isAdmin: false }),
  );
  const spectator = new Socket({ account: "viewer-account", isHost: false, isAdmin: false });
  sockets.push(spectator);
  const persistence = new MemoryPersistence();
  const save = vi.spyOn(persistence, "saveRoom");
  const archives = persistence.archives;
  if (seedRoom) {
    const document: RoomDocument = {
      schemaVersion: 1,
      meta: {
        code: "1234",
        hostToken: "host-secret",
        status: "lobby",
        gameId: null,
        seed: null,
        config: {
          ...DEFAULT_ROOM_CONFIG,
          roster: Array.from({ length: 6 }, (_, i) => `Seat ${i}`),
        },
      },
      members: Array.from({ length: 6 }, (_, seat) => ({
        id: `p${seat}`,
        name: `Player ${seat}`,
        avatarUrl: `https://example.com/${seat}.png`,
        seat,
        isSpectator: false,
        claimed: seat !== 1,
        connected: seat !== 1,
      })),
      sessions: Object.fromEntries(
        [0, 2, 3, 4, 5].map((seat) => [`p${seat}`, `token-${seat}`]),
      ),
      notes: {},
      game: null,
      eventSeq: 0,
      events: [],
      archive: null,
    };
    persistence.rooms.set("1234", { version: 1, document });
  }
  let room = new Room("1234", persistence);
  for (const socket of sockets) room.addSocket(socket);
  let request = 0;
  const action = async (socket: Socket, event: string, payload = {}) => {
    const id = String(++request);
    room.addSocket(socket);
    await room.webSocketMessage(
      socket.ws,
      JSON.stringify({ t: "req", id, event, payload }),
    );
    return socket.messages.find((m) => m.t === "ack" && m.id === id)!.res!;
  };
  const host = sockets[0]!;
  const finish = async () => {
    expect((await action(host, "admin:auth")).ok).toBe(true);
    expect((await action(host, "admin:startAssassination")).ok).toBe(true);
    const assassin = sockets.find(
      (s) => s !== spectator && s.game.selfRole === "Assassin",
    )!;
    const merlin = sockets.find(
      (s) => s !== spectator && s.game.selfRole === "Merlin",
    )!;
    expect(
      (
        await action(assassin, "game:assassinate", {
          targetPlayerId: merlin.deserializeAttachment().playerId,
        })
      ).ok,
    ).toBe(true);
  };
  return {
    get room() {
      return room;
    },
    get document() {
      return persistence.rooms.get("1234")!.document;
    },
    persistence,
    save,
    host,
    sockets,
    spectator,
    action,
    archives,
    finish,
    wake: () => {
      room = new Room("1234", persistence);
      for (const socket of sockets) room.addSocket(socket);
    },
  };
}