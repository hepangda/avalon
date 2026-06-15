import type { Effect, GameEvent, GameState } from '@/lib/engine';
import { teamOf } from '@/lib/engine';
import { prisma } from '@/lib/db/client';
import type { RoomRuntime } from '../types';

/**
 * Effect runner: interpret engine effects and persist checkpoints to Postgres.
 *
 * The engine returns declarative effects; this is the ONLY place they touch
 * I/O. Persistence is best-effort and must never block or break the in-memory
 * game loop — failures are logged, not thrown.
 */

/** Append an event to the log (called for every applied event). */
export async function recordEvent(
  room: RoomRuntime,
  event: GameEvent,
  seq: number,
): Promise<void> {
  if (!room.gameId) return;
  try {
    await prisma.gameEvent.create({
      data: {
        gameId: room.gameId,
        seq,
        type: event.type,
        payload: event as unknown as object,
      },
    });
  } catch (e) {
    console.error('[persist] recordEvent failed', e);
  }
}

/**
 * Run checkpoint effects against the post-transition state. `prevState` is the
 * state BEFORE the event (used to diff e.g. which round just completed).
 */
export async function runEffects(
  room: RoomRuntime,
  effects: Effect[],
  prevState: GameState | null,
  nextState: GameState,
): Promise<void> {
  for (const effect of effects) {
    try {
      if (effect.kind === 'PERSIST_CHECKPOINT') {
        await persistCheckpoint(room, effect.checkpoint, prevState, nextState);
      }
      // PRIVATE_LADY is delivered over sockets, not persisted here (the 'lady'
      // checkpoint persists the inspection record).
    } catch (e) {
      console.error(`[persist] effect ${effect.kind} failed`, e);
    }
  }
}

async function persistCheckpoint(
  room: RoomRuntime,
  kind: Extract<Effect, { kind: 'PERSIST_CHECKPOINT' }>['checkpoint'],
  prevState: GameState | null,
  s: GameState,
): Promise<void> {
  if (!room.gameId) return;
  const gameId = room.gameId;

  switch (kind) {
    case 'game_started': {
      await prisma.game.update({
        where: { id: gameId },
        data: {
          seed: s.seed,
          roleAssignments: s.players.map((p) => ({ playerId: p.id, role: p.role })),
        },
      });
      await prisma.room.update({
        where: { id: room.roomId },
        data: { status: 'in_game' },
      });
      break;
    }

    case 'vote': {
      // A vote resolved. Persist the round row + the votes of the just-closed
      // proposal. The proposal team is on prevState (cleared on reject).
      const roundIndex = s.roundIndex;
      const proposalTeam = prevState?.proposedTeam ?? s.proposedTeam ?? [];
      const votes = prevState?.votes ?? {};
      const leaderSeat = prevState?.leaderIndex ?? s.leaderIndex;
      const leader =
        (prevState ?? s).players.find((p) => p.seat === leaderSeat)?.id ?? '';

      const round = await prisma.round.upsert({
        where: { gameId_roundIndex: { gameId, roundIndex } },
        create: {
          gameId,
          roundIndex,
          leaderPlayerId: leader,
          teamSize: proposalTeam.length,
          finalTeam: proposalTeam,
          rejectionsThisRound: prevState?.rejectionCount ?? 0,
        },
        update: {},
      });

      // proposalIndex = the rejection count at the time of this proposal.
      const proposalIndex = prevState?.rejectionCount ?? 0;
      const voteRows = Object.entries(votes).map(([playerId, value]) => ({
        roundId: round.id,
        proposalIndex,
        playerId,
        value,
      }));
      if (voteRows.length > 0) {
        await prisma.vote.createMany({ data: voteRows });
      }
      break;
    }

    case 'mission_result': {
      const result = s.missionResults.at(-1);
      if (!result) break;
      const round = await prisma.round.upsert({
        where: { gameId_roundIndex: { gameId, roundIndex: result.roundIndex } },
        create: {
          gameId,
          roundIndex: result.roundIndex,
          leaderPlayerId:
            (prevState ?? s).players.find((p) => p.seat === (prevState ?? s).leaderIndex)?.id ??
            '',
          teamSize: result.teamSize,
          finalTeam: result.team,
          approved: true,
          missionSuccess: result.success,
          failCount: result.failCount,
        },
        update: {
          approved: true,
          missionSuccess: result.success,
          failCount: result.failCount,
          finalTeam: result.team,
        },
      });

      // Per-player cards (sensitive; replay-only). Read from the outcome, which
      // snapshots the cards before missionCards is cleared on the transition.
      const cards = result.cards ?? {};
      const cardRows = result.team
        .filter((id) => cards[id] !== undefined)
        .map((playerId) => ({ roundId: round.id, playerId, card: cards[playerId]! }));
      if (cardRows.length > 0) {
        await prisma.missionCardRow.createMany({ data: cardRows, skipDuplicates: true });
      }
      break;
    }

    case 'lady': {
      const r = s.lastLadyResult;
      if (!r) break;
      await prisma.ladyInspection.create({
        data: {
          gameId,
          roundIndex: s.roundIndex,
          holderPlayerId: r.holderId,
          targetPlayerId: r.targetId,
          revealedTeam: r.loyalty,
        },
      });
      break;
    }

    case 'game_over': {
      if (!s.outcome) break;
      await prisma.game.update({
        where: { id: gameId },
        data: {
          finishedAt: new Date(),
          outcome: s.outcome as unknown as object,
        },
      });
      await prisma.room.update({
        where: { id: room.roomId },
        data: { status: 'finished' },
      });
      if (s.outcome.assassinTargetId && s.assassinId) {
        const target = s.players.find((p) => p.id === s.outcome!.assassinTargetId);
        await prisma.assassination.upsert({
          where: { gameId },
          create: {
            gameId,
            assassinPlayerId: s.assassinId,
            targetPlayerId: s.outcome.assassinTargetId,
            hitMerlin: target ? teamOf(target.role) === 'good' && target.role === 'Merlin' : false,
          },
          update: {},
        });
      }
      break;
    }
  }
}
