import { ActionTimerBadge } from '@/components/game/ActionTimerBadge';
import { ActionTimerBar } from '@/components/game/ActionTimerBar';
import { AssassinationReveal } from '@/components/game/AssassinationReveal';
import { GameTable } from '@/components/game/GameTable';
import { GameTools } from '@/components/game/GameTools';
import { HandArea, type PickConfig } from '@/components/game/HandArea';
import { IdentityCard } from '@/components/game/IdentityCard';
import { InGameSeatClaim } from '@/components/game/InGameSeatClaim';
import { LadyResultReveal } from '@/components/game/LadyResultReveal';
import { LogPanel, type LogChannel } from '@/components/game/LogPanel';
import { MissionTrack } from '@/components/game/MissionTrack';
import { ProposalTracker } from '@/components/game/ProposalTracker';
import { RoleNotePopover } from '@/components/game/RoleNotePopover';
import { RoleReveal } from '@/components/game/RoleReveal';
import { RoundHistoryModal } from '@/components/game/RoundHistoryModal';
import { ShowKnownNotes } from '@/components/game/ShowKnownNotes';
import { TableCard } from '@/components/game/TableCard';
import { TableFrame } from '@/components/game/TableFrame';
import { TableSheet } from '@/components/game/TableSheet';
import { ReconnectOverlay } from '@/components/ui/ReconnectOverlay';
import { Link } from '@/i18n/navigation';
import type { ClientGameState, ClientPlayer } from '@/lib/engine';
import { actionAvailability } from '@/lib/game/actionAvailability';
import { displayedRoleNotes, knownRoleNotes, roleNoteOptions, roleNotesKey } from '@/lib/game/roleNotes';
import { useGameClock } from '@/lib/game/useGameClock';
import { useRoleNotes } from '@/lib/game/useRoleNotes';
import { useRoomAction } from '@/lib/game/useRoomAction';
import { useTablePresentation } from '@/lib/game/useTablePresentation';
import {
  gameActions,
  roomActions
} from '@/lib/socket/client';
import type { Ack } from '@/lib/socket/types';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { PhaseBoard } from './PhaseBoard';

/** Shared table: live rooms supply socket actions; the gallery supplies a local engine. */
export function GameView({
  code, game, isHost, conn, myPlayerId,
  selfLatency, notice = null, onDismissNotice, actions = gameActions,
  onRestart = roomActions.restart, functionsContent, seatClaimContent,
}: {
  code: string;
  game: ClientGameState | null;
  isHost: boolean;
  conn: 'connected' | 'connecting' | 'disconnected';
  myPlayerId: string | null;
  selfLatency: number | null;
  notice?: { type: string; message?: string } | null;
  onDismissNotice?: () => void;
  actions?: typeof gameActions;
  onRestart?: () => Promise<Ack>;
  functionsContent?: ReactNode;
  seatClaimContent?: ReactNode;
}) {
  const t = useTranslations();
  const [historyRound, setHistoryRound] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [ladySeen, setLadySeen] = useState<string | null>(null);
  const [seatClaimOpen, setSeatClaimOpen] = useState(false);
  const [logChannel, setLogChannel] = useState<LogChannel>('public');
  const [noteTarget, setNoteTarget] = useState<{ id: string; anchor: HTMLButtonElement } | null>(null);
  const notePopoverId = useId();
  const notesKey = game?.gameId ? roleNotesKey(code, game.gameId, myPlayerId, game.roleRevision) : null;
  const { notes, setNote, clearNotes, enabled: notesEnabled, setEnabled: setNotesEnabled, saveFailed } = useRoleNotes(notesKey,
    game?.gameId && myPlayerId && !game.isSpectator && actions === gameActions
      ? { code, connected: conn === 'connected', gameId: game.gameId, roleRevision: game.roleRevision, playerId: myPlayerId }
      : undefined,
  );
  useEffect(() => setNoteTarget(null), [notesKey, notesEnabled]);
  const phaseKey = `${code}-${game?.gameId}-${myPlayerId}-${game?.phase}-${game?.roundIndex}-${game?.rejectionCount}-${game?.phaseRevision}-${game?.roleRevision}-${game?.discussion?.speakerIndex}`;
  const now = useGameClock(game?.serverTime);
  const action = useRoomAction(phaseKey, t('table.actionFailed'));
  const { presentation, reportGame, finish } = useTablePresentation(game);
  const draftKey = game?.proposedTeam?.join(',') ?? '';
  useEffect(() => setSelected(game?.phase === 'TeamFinalizing' && draftKey ? draftKey.split(',') : []), [phaseKey, game?.phase, draftKey]);
  useEffect(() => setLadySeen(null), [game?.phaseRevision, myPlayerId]);

  if (!game)
    return (
      <main className="table-screen items-center justify-center">
        <p role={notice?.type === 'join_error' ? 'alert' : 'status'}>
          {notice?.type === 'session_replaced'
            ? t('common.sessionReplaced')
            : notice?.type === 'join_error'
              ? notice.message
              : t(
                conn === 'disconnected'
                  ? 'common.reconnecting'
                  : 'common.loading',
              )}
        </p>
        {notice?.type === 'join_error' && (
          <Link href="/" className="table-tool">
            {t('gameOver.newGame')}
          </Link>
        )}
      </main>
    );

  const blocked = conn !== 'connected' || !!presentation;
  const notePlayer = game.players.find((p) => p.id === noteTarget?.id);
  const noteOptions = notePlayer ? roleNoteOptions(game, myPlayerId, notePlayer.id) : [];
  const editableNoteIds = game.players.filter((p) => roleNoteOptions(game, myPlayerId, p.id).length > 0).map((p) => p.id);
  const displayedNotes = displayedRoleNotes(game, myPlayerId, notes, notesEnabled);
  const knownNotes = knownRoleNotes(game, myPlayerId);
  const automaticNotes = notesEnabled ? knownNotes : {};
  const notesControl = <ShowKnownNotes checked={notesEnabled} onChange={setNotesEnabled} saveFailed={saveFailed} />;
  const { canVote, canMission } = actionAvailability(game, myPlayerId);
  const leader = game.players.find((p) => p.seat === game.leaderIndex);
  const isLeader = leader?.id === myPlayerId;
  const teamSize = game.config.missionSizes[game.roundIndex] ?? 0;
  const team = game.proposedTeam ?? [];
  const speakerId = game.phase === 'Discussion' ? game.discussion?.order[game.discussion.speakerIndex] : undefined;
  const selfTimer = game.actionTimers?.find((timer) => timer.playerId === myPlayerId);
  const isHolder = game.lady?.holderId === myPlayerId;
  const ladyReveal = game.privateLadyResult;
  const isAssassin = !!game.assassinCandidates;
  const isOver = game.phase === 'GameOver' && presentation?.kind !== 'assassination';
  const activePhase =
    presentation?.kind === 'vote'
      ? 'Voting'
      : presentation?.kind === 'mission'
        ? 'MissionResult'
        : presentation?.kind === 'assassination'
          ? 'Assassination'
          : game.phase;
  const round =
    presentation?.kind === 'vote'
      ? presentation.record.roundIndex
      : presentation?.kind === 'mission'
        ? presentation.result.roundIndex
        : game.roundIndex;
  const displayGame =
    presentation?.kind === 'mission'
      ? {
        ...game,
        roundIndex: round,
        missionResults: game.missionResults.filter(
          (m) => m.roundIndex < round,
        ),
      }
      : { ...game, roundIndex: round };
  const needsRoleReveal =
    game.phase !== 'GameOver' &&
    !!myPlayerId &&
    !game.isSpectator &&
    !game.roleAcks.includes(myPlayerId);
  let candidateIds: string[] | undefined;
  let pick: PickConfig | null = null;
  if ((game.phase === 'TeamBuilding' || game.phase === 'TeamFinalizing') && isLeader) {
    pick = {
      size: teamSize,
      tone: 'gold',
      confirmLabel: t(game.phase === 'TeamFinalizing' ? 'discussion.finalize' : 'teamBuilder.proposeTeam'),
      onConfirm: () => game.phase === 'TeamFinalizing' ? actions.finalizeTeam(selected) : actions.proposeTeam(selected),
    };
  } else if (game.phase === 'LadyOfLake' && isHolder) {
    candidateIds = game.players
      .filter(
        (p) => p.id !== myPlayerId && !game.lady?.inspectedIds.includes(p.id),
      )
      .map((p) => p.id);
    pick = {
      size: 1,
      tone: 'sky',
      confirmLabel: t('lady.examineShort'),
      onConfirm: () => actions.useLady(selected[0]!),
    };
  } else if (game.phase === 'Assassination' && isAssassin) {
    candidateIds = game.assassinCandidates;
    const target = game.players.find((p) => p.id === selected[0]);
    pick = {
      size: 1,
      tone: 'crimson',
      confirmLabel: target
        ? t('assassin.strikeSeat', { seat: target.seat + 1 })
        : t('assassin.strike'),
      onConfirm: () => actions.assassinate(selected[0]!),
    };
  }
  function toggle(id: string) {
    if (!pick) return;
    setSelected((ids) =>
      ids.includes(id)
        ? ids.filter((x) => x !== id)
        : pick.size === 1
          ? [id]
          : ids.length < pick.size
            ? [...ids, id]
            : ids,
    );
  }
  const displayTeam =
    presentation?.kind === 'vote'
      ? presentation.record.team
      : presentation?.kind === 'mission'
        ? presentation.team
        : team;
  const displayLeader =
    presentation?.kind === 'vote' ? presentation.record.leaderId : leader?.id;
  const tablePlayers = game.players.map((p) => ({
    ...p,
    isLeader: p.id === displayLeader,
  }));
  function card(p: ClientPlayer) {
    if (presentation?.kind === 'mission')
      return (
        <TableCard
          state={presentation.team.includes(p.id) ? 'back' : 'inactive'}
        />
      );
    if (presentation?.kind === 'vote')
      return (
        <TableCard
          revealId={presentation.id}
          state={
            presentation.record.votes.find((v) => v.playerId === p.id)?.vote ??
            'back'
          }
        />
      );
    if (isOver && p.role) return <TableCard role={p.role} variant={p.roleVariant} />;
    if (game!.phase === 'Voting')
      return (
        <TableCard
          state={
            game!.votes?.some((v) => v.playerId === p.id && v.hasVoted)
              ? 'back'
              : 'empty'
          }
        />
      );
    if (game!.phase === 'MissionVote')
      return (
        <TableCard
          state={
            !team.includes(p.id)
              ? 'inactive'
              : game!.missionSubmissions?.includes(p.id)
                ? 'back'
                : 'empty'
          }
        />
      );
    return (
      <TableCard
        state={pick ? 'empty' : 'inactive'}
        nominee={selected.includes(p.id) ? p.seat + 1 : undefined}
        assassination={game!.phase === 'Assassination'}
      />
    );
  }
  const proposalPhases = ['TeamBuilding', 'TeamAnnouncement', 'Discussion', 'TeamFinalizing', 'Voting'] as const;
  const showProposals = proposalPhases.some((phase) => phase === activePhase);
  const proposalGame = presentation?.kind === 'vote'
    ? { ...game, rejectionCount: presentation.record.proposalIndex }
    : game;
  const voteCount = presentation?.kind === 'vote'
    ? presentation.record.votes.length
    : game.votes?.filter((v) => v.hasVoted).length ?? 0;
  const status = presentation
    ? ''
    : game.phase === 'Voting'
      ? t('table.voteCount', {
        count: game.votes?.filter((v) => v.hasVoted).length ?? 0,
        total: game.players.length,
      })
      : game.phase === 'MissionVote'
        ? t('table.missionCount', {
          count: game.missionSubmissions?.length ?? 0,
          total: team.length,
        })
        : '';
  return (
    <>
      <ReconnectOverlay active={conn !== 'connected' && notice?.type !== 'session_replaced' && notice?.type !== 'join_error'} />
      <TableFrame
        code={code}
        onOpenReport={() => setLogChannel('public')}
        report={
          <LogPanel game={reportGame ?? game} channel={logChannel} onChannelChange={setLogChannel} />
        }
        headerAction={(openReport) => (
          <button
            type="button"
            className="table-tool"
            onClick={() => {
              setLogChannel('rules');
              openReport();
            }}
          >
            {t('table.rules')}
          </button>
        )}
        tools={(viewToggle) => (
          <GameTools
            game={game}
            code={code}
            viewToggle={viewToggle}
            functionsContent={functionsContent}
            notesControl={notesControl}
            onClearNotes={() => { clearNotes(); setNoteTarget(null); }}
            hasManualNotes={Object.keys(notes).length > 0}
            identity={<IdentityCard game={game} myPlayerId={myPlayerId} />}
          />
        )}
        connected={conn === 'connected'}
        latency={selfLatency}
        error={
          action.error ??
          (notice?.type === 'session_replaced' ? t('common.sessionReplaced') : notice?.type === 'join_error' ? notice.message : null)
        }
        onDismissError={() => {
          action.clearError();
          onDismissNotice?.();
        }}
        progress={
          <>
            <div className={`table-status${showProposals && !presentation ? ' has-discussion' : ''}`}>
              <span className="table-status-label">
                <span className="table-status-full">
                  {t('table.roundPhase', {
                    round: round + 1,
                    phase: t(`phase.${activePhase}`),
                  })}
                </span>
                <span className="table-status-round">{t('lobby.missionNumber', { n: round + 1 })}</span>
              </span>
              {showProposals && !presentation && <ol className="discussion-steps" aria-label={t('discussion.flow')}>
                {proposalPhases.map((phase) => <li key={phase} aria-current={game.phase === phase ? 'step' : undefined}>
                  <span className="discussion-step-full">{t(`discussion.steps.${phase}`)}</span>
                  <span className="discussion-step-short">{t(phase === 'Discussion' ? 'phase.Discussion' : `discussion.steps.${phase}`)}</span>
                </li>)}
              </ol>}
              <span className="table-status-detail inline-flex items-center gap-2">
                {showProposals ? <>
                  {activePhase === 'Voting' && <span className="tabular-nums" aria-label={t('table.voteCount', { count: voteCount, total: game.players.length })}>{voteCount}/{game.players.length}</span>}
                  <ProposalTracker game={proposalGame} />
                </> : status}
              </span>
            </div>
            <MissionTrack
              game={displayGame}
              onSelect={setHistoryRound}

            />
          </>
        }
        footer={
          <>
            {!presentation && !isOver && selfTimer && <div className="table-timing-status">
              <ActionTimerBadge timer={selfTimer} now={now} />
            </div>}
            <div className="table-actions">
              {presentation ? (
                <div className="table-action-placeholder" aria-live="polite">
                  {t('table.resolving')}
                </div>
              ) : isOver ? (
                <>
                  <button
                    type="button"
                    className="table-action"
                    disabled={!isHost || action.busy || blocked}
                    title={!isHost ? t('gameOver.waitingRestart') : undefined}
                    onClick={() => void action.run(onRestart)}
                  >
                    {t(action.busy ? 'gameOver.restarting' : 'gameOver.playAgain')}
                  </button>
                  {game.gameId ? (
                    <Link
                      href={`/replay/${game.gameId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="table-action"
                    >
                      {t('gameOver.viewReplay')}
                    </Link>
                  ) : (
                    <button type="button" className="table-action" disabled>
                      {t('gameOver.viewReplay')}
                    </button>
                  )}
                </>
              ) : game.isSpectator ? (
                game.players.some((p) => p.claimed === false) ? (
                  <button
                    className="table-action"
                    onClick={() => setSeatClaimOpen(true)}
                  >
                    {t('seat.claimToJoin')}
                  </button>
                ) : (
                  <div className="table-action-placeholder">
                    {t('game.spectating')}
                  </div>
                )
              ) : (
                <HandArea
                  game={game}
                  myPlayerId={myPlayerId}
                  selected={selected}
                  pick={pick}
                  busy={action.busy}
                  blocked={blocked}
                  run={action.run}
                  actions={actions}
                />
              )}
            </div>
          </>
        }
      >
        <GameTable
          players={tablePlayers}
          myPlayerId={myPlayerId}
          board={<PhaseBoard game={game} presentation={presentation} isOver={isOver} isLeader={isLeader}
            isHolder={isHolder} isAssassin={isAssassin} canVote={canVote} canMission={canMission}
            selected={selected} round={round} teamSize={teamSize} />}
          card={card}
          speakerId={!presentation ? speakerId : undefined}
          proposalLayout={!presentation && showProposals && activePhase !== 'Voting'}
          playerStatus={(p) => {
            const timer = !presentation && game.actionTimers?.find((item) => item.playerId === p.id);
            return timer ? <ActionTimerBar timer={timer} now={now} /> : null;
          }}
          selectedIds={selected}
          selectable={!!pick && !blocked && !action.busy}
          candidateIds={candidateIds}
          highlightIds={displayTeam}
          onToggle={toggle}
          missionReveal={presentation?.kind === 'mission' ? presentation : null}
          onRevealComplete={finish}
          roleNotes={displayedNotes}
          knownNotes={knownNotes}
          editableNoteIds={editableNoteIds}
          onEditRoleNote={notesEnabled ? (id, anchor) => {
            if (editableNoteIds.includes(id)) setNoteTarget((current) => current?.id === id ? null : { id, anchor });
          } : undefined}
          notePlayerId={noteTarget?.id}
          notePopoverId={notePopoverId}
        />
      </TableFrame>
      {notesEnabled && noteTarget && notePlayer && noteOptions.length > 0 && <RoleNotePopover
        key={noteTarget.id}
        id={notePopoverId}
        anchor={noteTarget.anchor}
        player={notePlayer}
        options={noteOptions}
        defaultNote={automaticNotes[noteTarget.id]}
        hasManualNote={notes[noteTarget.id] !== undefined}
        note={displayedNotes[noteTarget.id]}
        onChange={(note) => {
          if (note !== null && !noteOptions.includes(note)) return;
          if (setNote(noteTarget.id, note)) setNoteTarget(null);
        }}
        onClose={() => setNoteTarget(null)}
        saveFailed={saveFailed}
      />}
      {presentation?.kind === 'assassination' && (
        <AssassinationReveal key={presentation.id} event={presentation} onComplete={finish} />
      )}
      {needsRoleReveal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-deep py-6">
          <RoleReveal key={`${game.gameId}-${myPlayerId}-${game.roleRevision ?? 0}`} game={game} myPlayerId={myPlayerId} onAck={actions.ackRole} onReroll={actions.useRerollCard} blocked={conn !== 'connected'}
            timer={selfTimer && <ActionTimerBadge timer={selfTimer} now={now} />} />
        </div>
      )}
      {!presentation && ladyReveal && ladyReveal.targetId !== ladySeen && (
        <LadyResultReveal
          game={game}
          result={ladyReveal}
          onClose={() => setLadySeen(ladyReveal.targetId)}
        />
      )}
      <RoundHistoryModal
        roundIndex={historyRound}
        game={game}
        onClose={() => setHistoryRound(null)}
      />
      <TableSheet
        open={seatClaimOpen}
        title={t('seat.sitTitle')}
        onClose={() => setSeatClaimOpen(false)}
      >
        {seatClaimOpen && (seatClaimContent ?? <InGameSeatClaim code={code} game={game} />)}
      </TableSheet>
    </>
  );
}
