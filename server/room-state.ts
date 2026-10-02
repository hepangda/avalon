import {
  type GameState
} from "@/lib/engine";
import type {
  RoomMember
} from "@/lib/socket/types";
import type { RoomDocument, RoomMeta } from "./persistence";
import { type SeatHistory } from './seating';
/** Durable room fields. Changes are committed only by Room.run(). */
export class RoomState {
  meta: RoomMeta | null = null;
  members = new Map<string, RoomMember>();
  game: GameState | null = null;
  eventSeq = 0;
  events: RoomDocument["events"] = [];
  sessions: RoomDocument["sessions"] = {};
  accounts: Record<string, string> = {};
  gameAccounts: Record<string, string> = {};
  lastGameSeats: SeatHistory = { byPlayer: {}, byAccount: {} };
  notes: RoomDocument["notes"] = {};
  archive: RoomDocument["archive"] = null;
}
