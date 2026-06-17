'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useRoomConnection, gameActions } from '@/lib/socket/client';
import { useRoomStore } from '@/lib/store/room';
import { PhaseTransition } from '@/components/animations';
import { GameTable } from '@/components/game/GameTable';
import { MissionTrack } from '@/components/game/MissionTrack';
import { ProposalTracker } from '@/components/game/ProposalTracker';
import { VotePile, OutcomeBanner } from '@/components/game/VoteTokens';
import { PickPile } from '@/components/game/PickPile';
import { MissionCardReveal } from '@/components/game/MissionCardReveal';
import { HandArea, type PickConfig } from '@/components/game/HandArea';
import { RoleReveal } from '@/components/game/RoleReveal';
import { TeamBuilder } from '@/components/game/TeamBuilder';
import { VotePanel } from '@/components/game/VotePanel';
import { MissionVote } from '@/components/game/MissionVote';
import { MissionResult } from '@/components/game/MissionResult';
import { LadyOfLake } from '@/components/game/LadyOfLake';
import { LadyResultReveal } from '@/components/game/LadyResultReveal';
import { AssassinPanel } from '@/components/game/AssassinPanel';
import { GameOverReveal } from '@/components/game/GameOverReveal';
import { RoundHistoryModal } from '@/components/game/RoundHistoryModal';
import { InGameSeatClaim } from '@/components/game/InGameSeatClaim';
import { LogPanel } from '@/components/game/LogPanel';
import { useResultCue } from '@/lib/game/useResultCue';
import { formatLatency, latencyTextClass } from '@/lib/utils/latency';
import type { ClientPlayer } from '@/lib/engine';

/** The table's interaction surface for the current phase. */
interface TableInteraction {
  selectable?: boolean;
  selectedIds?: string[];
  highlightIds?: string[];
  candidateIds?: string[];
  onToggle?: (id: string) => void;
  seatBadge?: (player: ClientPlayer) => ReactNode;
}

export default function GamePage() {
  const t = useTranslations();
  const params = useParams<{ code: string }>();
  const code = (params.code ?? '').toUpperCase();

  useRoomConnection(code);

  const conn = useRoomStore((s) => s.conn);
  const game = useRoomStore((s) => s.game);
  const reveal = useRoomStore((s) => s.reveal);
  const ladyResult = useRoomStore((s) => s.ladyResult);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const selfLatency = useRoomStore((s) => s.selfLatency);

  const [historyRound, setHistoryRound] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [ladySeen, setLadySeen] = useState<string | null>(null);
  const { cue, dismiss } = useResultCue();

  // Clear the table selection whenever the proposal / phase changes.
  const selKey = `${game?.phase}-${game?.roundIndex}-${game?.rejectionCount}`;
  useEffect(() => {
    setSelected([]);
  }, [selKey]);

  if (!game) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="animate-pulse text-parchment/60">
          {conn === 'disconnected' ? t('common.reconnecting') : t('common.loading')}
        </p>
      </main>
    );
  }

  // Per-player role-reveal overlay: shown to a seated player who hasn't yet
  // acked their role. Driven by projected roleAcks, so it survives reconnect.
  const needsRoleReveal =
    !!myPlayerId && !game.isSpectator && !game.roleAcks.includes(myPlayerId);

  if (game.phase === 'GameOver') {
    return (
      <main className="min-h-screen py-6">
        <GameOverReveal game={game} gameId={game.gameId} />
      </main>
    );
  }

  // --- Cues: votes and missions reveal on the table (central pile). No
  //     full-screen overlay — a small banner + the central reveal carry it. ---
  const isVoteCue = !!cue && (cue.kind === 'voteApproved' || cue.kind === 'voteRejected');
  const isMissionCue = !!cue && (cue.kind === 'missionSuccess' || cue.kind === 'missionFail');
  const voteCueRecord = isVoteCue
    ? (game.voteHistory.filter((v) => v.roundIndex === cue.roundIndex).at(-1) ?? null)
    : null;
  const missionCueResult = isMissionCue
    ? (game.missionResults.find((m) => m.roundIndex === cue.roundIndex) ?? null)
    : null;

  // --- Table interaction for the current phase ------------------------------
  const teamSize = game.config.missionSizes[game.roundIndex] ?? 0;
  const leader = game.players.find((p) => p.seat === game.leaderIndex);
  const isLeader = leader?.id === myPlayerId;
  const proposedTeam = game.proposedTeam ?? [];

  const toggleTeam = (id: string) =>
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < teamSize ? [...cur, id] : cur,
    );
  const toggleSingle = (id: string) => setSelected((cur) => (cur[0] === id ? [] : [id]));

  const holderId = game.lady?.holderId ?? null;
  const isHolder = holderId === myPlayerId;
  const ladyInspected = game.lady?.inspectedIds ?? [];
  const ladyCandidates = game.players
    .filter((p) => p.id !== holderId && !ladyInspected.includes(p.id))
    .map((p) => p.id);
  const ladyResolved = !!(isHolder && ladyResult && ladyResult.targetId);
  // Prefer the authoritative projection (survives reconnect); fall back to the
  // one-shot private event.
  const ladyReveal = game.privateLadyResult ?? ladyResult;

  const assassinCandidates = game.assassinCandidates;
  const isAssassin = !!assassinCandidates;

  let table: TableInteraction = {};
  if (game.phase === 'TeamBuilding' && isLeader) {
    table = { selectable: true, selectedIds: selected, highlightIds: selected, onToggle: toggleTeam };
  } else if (game.phase === 'Voting') {
    table = { highlightIds: proposedTeam };
  } else if (game.phase === 'MissionVote') {
    table = { highlightIds: proposedTeam };
  } else if (game.phase === 'LadyOfLake' && isHolder && !ladyResolved) {
    table = {
      selectable: true,
      candidateIds: ladyCandidates,
      selectedIds: selected,
      onToggle: toggleSingle,
    };
  } else if (game.phase === 'Assassination' && isAssassin) {
    table = {
      selectable: true,
      candidateIds: assassinCandidates,
      selectedIds: selected,
      onToggle: toggleSingle,
    };
  }

  // The central vote pile: collecting during voting, then revealing on the cue.
  const showVotePile = game.phase === 'Voting' || !!voteCueRecord;
  // The proposed team stays on the table while it is being voted on / revealed.
  const voteTeam = voteCueRecord ? voteCueRecord.team : game.phase === 'Voting' ? proposedTeam : [];

  // "Pick" phases — play candidate cards from the hand to the centre pile.
  const pickToggle =
    game.phase === 'Assassination' || game.phase === 'LadyOfLake' ? toggleSingle : toggleTeam;
  let pick: PickConfig | null = null;
  if (game.phase === 'TeamBuilding' && isLeader) {
    pick = {
      candidateIds: game.players.map((p) => p.id),
      size: teamSize,
      confirmLabel: t('teamBuilder.proposeTeam'),
      tone: 'gold',
      onConfirm: async () => (await gameActions.proposeTeam(selected)).ok,
    };
  } else if (game.phase === 'LadyOfLake' && isHolder && !ladyResolved) {
    pick = {
      candidateIds: ladyCandidates,
      size: 1,
      confirmLabel: t('lady.examineShort'),
      tone: 'sky',
      onConfirm: async () => (selected[0] ? (await gameActions.useLady(selected[0])).ok : false),
    };
  } else if (game.phase === 'Assassination' && isAssassin && assassinCandidates) {
    pick = {
      candidateIds: assassinCandidates,
      size: 1,
      confirmLabel: t('assassin.strike'),
      tone: 'crimson',
      onConfirm: async () => (selected[0] ? (await gameActions.assassinate(selected[0])).ok : false),
    };
  }

  // --- Active phase controls (rendered inside the table's centre board) -----
  const controls =
    game.phase === 'TeamBuilding' ? (
      <TeamBuilder game={game} myPlayerId={myPlayerId} />
    ) : game.phase === 'Voting' ? (
      <VotePanel game={game} myPlayerId={myPlayerId} />
    ) : game.phase === 'MissionVote' ? (
      <MissionVote game={game} myPlayerId={myPlayerId} />
    ) : game.phase === 'MissionResult' ? (
      <MissionResult game={game} />
    ) : game.phase === 'LadyOfLake' ? (
      <LadyOfLake game={game} myPlayerId={myPlayerId} />
    ) : game.phase === 'Assassination' ? (
      <AssassinPanel game={game} />
    ) : null;

  const showProposalRail = game.phase === 'TeamBuilding' || game.phase === 'Voting';
  const hasPlayArea =
    showVotePile ||
    game.phase === 'TeamBuilding' ||
    game.phase === 'Assassination' ||
    game.phase === 'MissionVote' ||
    (game.phase === 'LadyOfLake' && isHolder && !ladyResolved) ||
    !!missionCueResult;

  const board = (
    <div className="flex gap-3">
      {/* Left rail: mission rounds + proposal rounds, side by side, centred. */}
      <div className="flex shrink-0 items-center gap-2.5">
        <div className="flex flex-col items-center gap-1">
          <span className="text-[9px] uppercase tracking-wide text-parchment/40">
            {t('mission.track')}
          </span>
          <MissionTrack game={game} onSelect={setHistoryRound} vertical />
        </div>
        {showProposalRail && (
          <div className="flex flex-col items-center gap-1">
            <span className="text-[9px] uppercase tracking-wide text-parchment/40">
              {t('proposal.label')}
            </span>
            <ProposalTracker game={game} vertical />
          </div>
        )}
      </div>

      {/* Right: action description (top) + public play area (centred below). */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <PhaseTransition phaseKey={`${game.phase}-${game.roundIndex}-${game.rejectionCount}`}>
          {controls}
        </PhaseTransition>

        {hasPlayArea && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 border-t border-gold/10 pt-2">
            {showVotePile && (
              <>
                {voteTeam.length > 0 && (
                  <PickPile game={game} selected={voteTeam} size={voteTeam.length} tone="gold" />
                )}
                <VotePile game={game} reveal={voteCueRecord} />
              </>
            )}

            {game.phase === 'TeamBuilding' && (
              <PickPile game={game} selected={selected} size={teamSize} tone="gold" onRemove={toggleTeam} />
            )}
            {game.phase === 'Assassination' && (
              <PickPile game={game} selected={selected} size={1} tone="crimson" onRemove={toggleSingle} />
            )}
            {game.phase === 'LadyOfLake' && isHolder && !ladyResolved && (
              <PickPile game={game} selected={selected} size={1} tone="sky" onRemove={toggleSingle} />
            )}

            {game.phase === 'MissionVote' && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {Array.from({ length: teamSize }).map((_, i) => (
                  <span
                    key={i}
                    className="flex h-20 w-14 shrink-0 items-center justify-center rounded-lg border-2 border-gold/50 bg-gradient-to-b from-stone to-ink text-2xl opacity-60"
                  >
                    ⚜️
                  </span>
                ))}
              </div>
            )}

            {missionCueResult && (
              <MissionCardReveal
                key={`mreveal-${cue?.roundIndex}`}
                teamSize={missionCueResult.teamSize}
                failCount={missionCueResult.failCount}
                revealed
              />
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden">
      {needsRoleReveal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-deep py-6">
          <RoleReveal game={game} reveal={reveal} myPlayerId={myPlayerId} />
        </div>
      )}

      {/* Lady of the Lake: the private loyalty result, shown as a reveal. */}
      {ladyReveal && ladyReveal.targetId !== ladySeen && (
        <LadyResultReveal
          game={game}
          result={ladyReveal}
          onClose={() => setLadySeen(ladyReveal.targetId)}
        />
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-3 p-3">
          {game.isSpectator && (
            <>
              <div className="rounded-lg border border-gold/30 bg-gold/10 px-4 py-2 text-center text-sm text-gold">
                👁 {t('game.spectating')}
              </div>
              <InGameSeatClaim code={code} game={game} />
            </>
          )}

          {/* Slim status strip (the rest of the old header now lives on the table). */}
          <div className="flex h-5 items-center justify-end">
            {conn === 'connected' ? (
              <span className={`text-xs tabular-nums ${latencyTextClass(selfLatency)}`}>
                ● {formatLatency(selfLatency)}
              </span>
            ) : (
              <span className="text-xs text-amber-400">● {t('game.reconnecting')}</span>
            )}
          </div>

          {/* Non-blocking outcome banner (the central pile carries the reveal). */}
          {isVoteCue && voteCueRecord && (
            <OutcomeBanner
              key={`${cue.kind}-${cue.roundIndex}`}
              kind={cue.kind}
              approves={voteCueRecord.votes.filter((v) => v.vote === 'approve').length}
              rejects={voteCueRecord.votes.filter((v) => v.vote === 'reject').length}
              onDismiss={dismiss}
            />
          )}
          {isMissionCue && missionCueResult && (
            <OutcomeBanner
              key={`${cue.kind}-${cue.roundIndex}`}
              kind={cue.kind}
              failCount={missionCueResult.failCount}
              onDismiss={dismiss}
            />
          )}

          {/* The table: seats + centre play area + your cards, all on the felt. */}
          <GameTable
            game={game}
            myPlayerId={myPlayerId}
            board={board}
            playZone={
              game.isSpectator ? undefined : (
                <HandArea
                  game={game}
                  myPlayerId={myPlayerId}
                  selected={selected}
                  onToggleSelect={pickToggle}
                  pick={pick}
                />
              )
            }
            {...table}
          />
        </div>
      </div>

      {/* War log — minimized by default, expandable. */}
      <div className="mx-auto w-full max-w-2xl px-3 pb-3 pt-2">
        <LogPanel game={game} code={code} />
      </div>

      <RoundHistoryModal
        roundIndex={historyRound}
        game={game}
        onClose={() => setHistoryRound(null)}
      />
    </main>
  );
}
