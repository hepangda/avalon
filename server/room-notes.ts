import type { GameState } from '@/lib/engine';
import { isRoleNote, type RoleNotes, type RoleNotesDocument } from '@/lib/game/roleNotes';
import type { Ack, RoomMember } from '@/lib/socket/types';
import type { RoomDocument } from './persistence';
import { fail, ok } from './room-result';

/** Validates one seat's private notes; invoked within the room's commit boundary. */
export function syncRoleNotes(context: {
  playerId?: string; game: GameState | null; gameId?: string | null;
  notes: RoomDocument['notes']; members: Map<string, RoomMember>; currentConnection: boolean;
}, payload: unknown): Ack<RoleNotesDocument> {
  const { playerId, game, gameId, notes: documents, members, currentConnection } = context;
  if (
    !playerId ||
    !members.get(playerId)?.claimed ||
    !currentConnection
  ) {
    return fail("NOT_SEATED", "A current seat connection is required");
  }
  if (!game || !gameId)
    return fail("NO_GAME", "No game in progress");
  if (!payload || typeof payload !== "object")
    return fail("INVALID", "Invalid notes request");
  const p = payload as Record<string, unknown>;
  const roleRevision = game.roleRevision ?? 0;
  if (
    p.gameId !== gameId ||
    p.roleRevision !== roleRevision ||
    p.playerId !== playerId
  ) {
    return fail(
      "STALE_NOTES_SCOPE",
      "The game, role assignment or seat has changed",
    );
  }
  const stored = documents[playerId];
  const current: RoleNotesDocument =
    stored?.gameId === gameId &&
      stored.roleRevision === roleRevision
      ? stored
      : {
        gameId: gameId,
        roleRevision,
        playerId,
        revision: 0,
        notes: {},
        enabled: true,
      };
  if (p.update === undefined) return ok(current);
  if (!p.update || typeof p.update !== "object")
    return fail("INVALID", "Invalid notes update");
  const update = p.update as Record<string, unknown>;
  if (
    !Number.isSafeInteger(update.baseRevision) ||
    typeof update.enabled !== "boolean" ||
    !update.notes ||
    typeof update.notes !== "object" ||
    Array.isArray(update.notes)
  ) {
    return fail("INVALID", "Invalid notes update");
  }
  const entries = Object.entries(update.notes);
  if (
    entries.length > game.players.length ||
    entries.some(
      ([id, note]) =>
        !game!.players.some((player) => player.id === id) ||
        !isRoleNote(note),
    )
  )
    return fail("INVALID", "Invalid player or note");
  if (update.baseRevision !== current.revision) {
    return {
      ok: false,
      error: {
        code: "NOTES_CONFLICT",
        message: "Notes changed; merge and retry",
      },
      data: current,
    };
  }
  const notes = Object.fromEntries(entries) as RoleNotes;
  const document = {
    ...current,
    revision: current.revision + 1,
    notes,
    enabled: update.enabled,
  };
  documents[playerId] = document;
  return ok(document);
}
