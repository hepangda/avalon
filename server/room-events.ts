import type { GameEvent } from '@/lib/engine';
import type { RoleNotesDocument } from '@/lib/game/roleNotes';
import type { ClientEvent } from '@/lib/socket/protocol';
import type { Ack } from '@/lib/socket/types';
import type { RoomSocket } from './env';
import type { RoomMembership } from './room-membership';
import type { RefereeCommands } from './room-referee';
import { asStrArray,fail } from './room-result';

export interface RoomCommandHandlers {
  membership: RoomMembership;
  referee: RefereeCommands;
  handleNotesSync(ws: RoomSocket, payload: unknown): Ack<RoleNotesDocument>;
  handleRestart(ws: RoomSocket): Promise<Ack>;
  handleStart(ws: RoomSocket): Promise<Ack>;
  handleUseRerollCard(ws: RoomSocket, payload: unknown): Promise<Ack>;
  handlePing(ws: RoomSocket, payload: unknown): Ack;
  gameAction(ws: RoomSocket, build: (id: string) => GameEvent): Promise<Ack>;
}

/** Decode wire actions; authorization and mutations stay in queued domain handlers. */
export function dispatchRoomEvent(handlers: RoomCommandHandlers, ws: RoomSocket, event: ClientEvent, payload: unknown): Promise<Ack<unknown>> | Ack<unknown> {
    switch (event) {
      case "notes:sync":
        return handlers.handleNotesSync(ws, payload);
      case "room:join":
        return handlers.membership.handleJoin(ws, payload);
      case "room:addBot":
        return handlers.membership.handleAddBot(ws);
      case "room:claimSeat":
        return handlers.membership.handleClaimSeat(ws, payload);
      case "room:releaseSeat":
        return handlers.membership.handleReleaseSeat(ws);
      case "room:setRoster":
        return handlers.membership.handleSetRoster(ws, payload);
      case "room:removeSeat":
        return handlers.membership.handleRemoveSeat(ws, payload);
      case "room:restart":
        return handlers.handleRestart(ws);
      case "room:config":
        return handlers.membership.handleConfig(ws, payload);
      case "room:rename":
        return handlers.membership.handleRename(ws, payload);
      case "room:kick":
        return handlers.membership.handleKick(ws, payload);
      case "room:start":
        return handlers.handleStart(ws);
      case "room:leave":
        return handlers.membership.handleLeave(ws);
      case "game:useRerollCard":
        return handlers.handleUseRerollCard(ws, payload);
      case "game:ackRole":
        return handlers.gameAction(ws, (pid) => ({
          type: "ACK_ROLE",
          by: pid,
          roleRevision: (payload as { roleRevision?: number } | null)
            ?.roleRevision,
        }));
      case "game:proposeTeam":
        return handlers.gameAction(ws, (pid) => ({
          type: "PROPOSE_TEAM",
          by: pid,
          team: asStrArray((payload as { team?: unknown }).team),
        }));
      case "game:finalizeTeam":
        return handlers.gameAction(ws, (pid) => ({
          type: "FINALIZE_TEAM",
          by: pid,
          team: asStrArray((payload as { team?: unknown } | null)?.team),
        }));
      case "game:startDiscussion":
        return handlers.gameAction(ws, (pid) => ({
          type: "START_DISCUSSION",
          by: pid,
          direction: (payload as { direction?: "clockwise" | "counterclockwise" } | null)?.direction,
        }));
      case "game:endSpeech":
        return handlers.gameAction(ws, (pid) => ({ type: "END_SPEECH", by: pid }));
      case "game:vote":
        return handlers.gameAction(ws, (pid) => ({
          type: "CAST_VOTE",
          by: pid,
          value: (payload as { value: "approve" | "reject" }).value,
        }));
      case "game:missionCard":
        return handlers.gameAction(ws, (pid) => ({
          type: "CAST_MISSION_CARD",
          by: pid,
          card: (payload as { card: "success" | "fail" }).card,
        }));
      case "game:useLady":
        return handlers.gameAction(ws, (pid) => ({
          type: "USE_LADY",
          by: pid,
          target: (payload as { targetPlayerId: string }).targetPlayerId,
        }));
      case "game:startAssassination":
        return handlers.gameAction(ws, (pid) => ({
          type: "START_ASSASSINATION",
          by: pid,
        }));
      case "game:assassinate":
        return handlers.gameAction(ws, (pid) => ({
          type: "ASSASSINATE",
          by: pid,
          target: (payload as { targetPlayerId: string }).targetPlayerId,
        }));
      case "net:ping":
        return handlers.handlePing(ws, payload);
      case "admin:auth":
        return handlers.referee.handleAdminAuth(ws);
      case "admin:close":
        return handlers.referee.handleAdminClose(ws);
      case "admin:unbind":
        return handlers.referee.handleAdminUnbind(ws, payload);
      case "admin:vote":
        return handlers.referee.handleAdminVote(ws, payload);
      case "admin:propose":
        return handlers.referee.handleAdminPropose(ws, payload);
      case "admin:retractVotes":
        return handlers.referee.handleAdminRetract(ws, "votes");
      case "admin:retractProposal":
        return handlers.referee.handleAdminRetract(ws, "proposal");
      case "admin:startAssassination":
        return handlers.referee.handleAdminPhase(ws, "assassination");
      case "admin:previousPhase":
        return handlers.referee.handleAdminPhase(ws, "previous");
      case "admin:skipSpeech":
        return handlers.referee.handleAdminSkipSpeech(ws, payload);
      case "admin:setTimersPaused":
        return handlers.referee.handleAdminSetTimersPaused(ws, payload);
      case "admin:rerollLeader":
        return handlers.referee.handleAdminReroll(ws, "REROLL_LEADER");
      case "admin:rerollRoles":
        return handlers.referee.handleAdminReroll(ws, "REROLL_ROLES");
      default:
        return fail("UNKNOWN_EVENT", `Unknown event: ${String(event)}`);
    }
}
