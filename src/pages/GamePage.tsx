import { useParams } from 'react-router-dom';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { Link, useRouter } from '@/i18n/navigation';
import {
  useRoomConnection,
  gameActions,
  roomActions,
} from '@/lib/socket/client';
import { useRoomStore } from '@/lib/store/room';
import { GameTable } from '@/components/game/GameTable';
import { RoleNotePopover } from '@/components/game/RoleNotePopover';
import { useRoleNotes } from '@/lib/game/useRoleNotes';
import { displayedRoleNotes, knownRoleNotes, roleNoteOptions, roleNotesKey } from '@/lib/game/roleNotes';
import { ShowKnownNotes } from '@/components/game/ShowKnownNotes';
import { TableFrame } from '@/components/game/TableFrame';
import { TableSheet } from '@/components/game/TableSheet';
import { TableCard } from '@/components/game/TableCard';
import { HandArea, type PickConfig } from '@/components/game/HandArea';
import { IdentityCard } from '@/components/game/IdentityCard';
import { RoleReveal } from '@/components/game/RoleReveal';
import { LadyResultReveal } from '@/components/game/LadyResultReveal';
import { AssassinationReveal } from '@/components/game/AssassinationReveal';
import { RoundHistoryModal } from '@/components/game/RoundHistoryModal';
import { InGameSeatClaim } from '@/components/game/InGameSeatClaim';
import { LogPanel, type LogChannel } from '@/components/game/LogPanel';
import { GameTools } from '@/components/game/GameTools';
import { MissionTrack } from '@/components/game/MissionTrack';
import { ProposalTracker } from '@/components/game/ProposalTracker';
import { useTablePresentation } from '@/lib/game/useTablePresentation';
import { useRoomAction } from '@/lib/game/useRoomAction';
import { actionAvailability } from '@/lib/game/actionAvailability';
import { ActionTimerBadge } from '@/components/game/ActionTimerBadge';
import { ActionTimerBar } from '@/components/game/ActionTimerBar';
import { useGameClock } from '@/lib/game/useGameClock';
import { ROLE_TEAM_UI } from '@/lib/game/roleMeta';
import { outcomeReasonKey } from '@/lib/game/outcomeText';
import type { ClientPlayer, ClientGameState, Role, VisibilityInfo, Team } from '@/lib/engine';
import type { Ack } from '@/lib/socket/types';

export default function GamePage() {
  const code = useParams().code ?? '';
  const router = useRouter();
  useRoomConnection(code);
  const {
    snapshot,
    isHost,
    conn,
    game: rawGame,
    roomCode,
    reveal,
    ladyResult,
    myPlayerId,
    selfLatency,
    notice,
  } = useRoomStore();
  const game = roomCode === code ? rawGame : null;
  useEffect(() => {
    if (snapshot?.code === code && snapshot.status === 'lobby')
      router.replace(`/room/${code}`);
  }, [code, router, snapshot?.code, snapshot?.status]);
  return <GameView code={code} game={game} isHost={isHost} conn={conn}
    reveal={reveal} ladyResult={ladyResult} myPlayerId={myPlayerId}
    selfLatency={selfLatency} notice={notice}
    onDismissNotice={() => useRoomStore.getState().setNotice(null)} />;
}

/** Shared table: live rooms supply socket actions; the gallery supplies a local engine. */
export function GameView({
  code, game, isHost, conn, reveal = null, ladyResult = null, myPlayerId,
  selfLatency, notice = null, onDismissNotice, actions = gameActions,
  onRestart = roomActions.restart, functionsContent, seatClaimContent,
}: {
  code: string;
  game: ClientGameState | null;
  isHost: boolean;
  conn: 'connected' | 'connecting' | 'disconnected';
  reveal?: { selfRole: Role; knownPlayers: VisibilityInfo[] } | null;
  ladyResult?: { targetId: string; loyalty: Team } | null;
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
  const phaseKey = `${code}-${game?.gameId}-${myPlayerId}-${game?.phase}-${game?.roundIndex}-${game?.rejectionCount}-${game?.phaseRevision}-${game?.discussion?.speakerIndex}`;
  const now = useGameClock(game?.serverTime);
  const action = useRoomAction(phaseKey, t('table.actionFailed'));
  const { presentation, finish } = useTablePresentation(game);
  const draftKey = game?.proposedTeam?.join(',') ?? '';
  useEffect(() => setSelected(game?.phase === 'TeamFinalizing' && draftKey ? draftKey.split(',') : []), [phaseKey, game?.phase, draftKey]);
  useEffect(() => setLadySeen(null), [game?.phaseRevision, myPlayerId]);

  if (!game)
    return (
      <main className="table-screen items-center justify-center">
        <p role={notice?.type === 'join_error' ? 'alert' : 'status'}>
          {notice?.type === 'join_error'
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
  const speaker = game.players.find((p) => p.id === speakerId);
  const selfTimer = game.actionTimers?.find((timer) => timer.playerId === myPlayerId);
  const isHolder = game.lady?.holderId === myPlayerId;
  const ladyReveal = game.privateLadyResult ?? ladyResult;
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
  function chips(ids: string[]) {
    return (
      <div className="table-team-chips">
        {ids.map((id) => {
          const p = game!.players.find((player) => player.id === id);
          return (
            p && (
              <span key={id} className="table-team-chip">
                <b className="font-medium">{p.seat + 1}</b>
                <span>{p.name}</span>
              </span>
            )
          );
        })}
      </div>
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
  let board;
  if (presentation?.kind === 'mission' || presentation?.kind === 'assassination') board = null;
  else if (presentation?.kind === 'vote')
    board = (
      <>
        <h2 className="table-phase-title">
          {t(
            presentation.record.approved
              ? 'cue.voteApproved'
              : 'cue.voteRejected',
          )}
        </h2>
        {chips(presentation.record.team)}
        <p className="table-phase-detail">
          {t('vote.tally', {
            approves: presentation.record.votes.filter(
              (v) => v.vote === 'approve',
            ).length,
            rejects: presentation.record.votes.filter(
              (v) => v.vote === 'reject',
            ).length,
          })}
        </p>
      </>
    );
  else if (isOver)
    board = (
      <>
        <h1 className="table-phase-title outcome-title" data-winner={game.outcome?.winner}>
          {t(
            game.outcome?.winner === 'good'
              ? 'gameOver.goodTriumphs'
              : 'gameOver.evilPrevails',
          )}
        </h1>
        {game.outcome && (
          <p className="table-phase-detail">
            {t(`gameOver.${outcomeReasonKey(game.outcome)}`)}
          </p>
        )}
      </>
    );
  else if (game.phase === 'TeamAnnouncement' || game.phase === 'Discussion')
    board = (
      <>
        <h2 className="table-phase-title" aria-live="polite">
          {game.phase === 'TeamAnnouncement' ? t('discussion.announced') : t('discussion.speaking', {
            name: speaker ? `${speaker.seat + 1}. ${speaker.name}` : '',
          })}
        </h2>
        {chips(team)}
        {game.phase === 'Discussion' && (
          <div className="discussion-turn">
            <p className="table-phase-detail">{t('discussion.speechProgress', {
              current: (game.discussion?.speakerIndex ?? 0) + 1, total: game.players.length,
            })}</p>
            <ol className="discussion-order" aria-label={t('discussion.order')}>
              {game.discussion?.order.map((id, index) => {
                const player = game.players.find((p) => p.id === id)!;
                return <li key={id} aria-current={id === speakerId ? 'step' : undefined}
                  data-done={index < game.discussion!.speakerIndex} title={player.name}>
                  {player.seat + 1}
                </li>;
              })}
            </ol>
          </div>
        )}
      </>
    );
  else if (game.phase === 'TeamBuilding' || game.phase === 'TeamFinalizing')
    board = (
      <>
        <h2 className="table-phase-title">
          {game.phase === 'TeamFinalizing' ? t('discussion.finalizing') : isLeader
            ? t('teamBuilder.youLead')
            : t('teamBuilder.leaderChoosing', {
                name: leader ? `${leader.seat + 1}. ${leader.name}` : '',
              })}
        </h2>
        {game.phase === 'TeamFinalizing' && <p className="table-phase-detail">{t('discussion.finalizingHint')}</p>}
        {game.phase === 'TeamFinalizing' && !isLeader ? chips(team) : selected.length > 0 ? (
          chips(selected)
        ) : (
          <p className="table-phase-detail">
            {t('teamBuilder.selectKnights', {
              size: teamSize,
              round: round + 1,
            })}
          </p>
        )}
      </>
    );
  else if (game.phase === 'Voting')
    board = (
      <>
        <h2 className="table-phase-title" aria-live="polite">
          {t(canVote ? 'table.voteQuestion' : 'table.waitingVotes')}
        </h2>
        {chips(team)}
      </>
    );
  else if (game.phase === 'MissionVote')
    board = (
      <>
        <h2 className="table-phase-title" aria-live="polite">
          {t(canMission ? 'table.missionPrompt' : 'table.waitingMissionCards')}
        </h2>
        <p className="table-phase-detail">
          {t(
            game.config.requiredFails[round] === 2
              ? 'table.twoFails'
              : 'missionVote.oneFailSpoils',
          )}
        </p>
      </>
    );
  else if (game.phase === 'LadyOfLake')
    board = (
      <>
        <h2 className="table-phase-title">{t('lady.title')}</h2>
        <p className="table-phase-detail">
          {isHolder
            ? t('lady.chooseExamine')
            : t('lady.gazingWaters', {
                name:
                  game.players.find((p) => p.id === game.lady?.holderId)
                    ?.name ?? '',
              })}
        </p>
        {chips(selected)}
      </>
    );
  else if (game.phase === 'Assassination')
    board = (
      <>
        <h2 className="table-phase-title">{t('assassin.title')}</h2>
        <div
          className="table-public-roles"
          aria-label={t('assassin.identitiesPublic')}
        >
          {game.players
            .filter((p) => p.role && ROLE_TEAM_UI[p.role] === 'evil')
            .map((p) => (
              <div className="table-public-role" key={p.id}>
                <TableCard role={p.role} />
                <span>
                  {p.seat + 1}. {p.name}
                </span>
              </div>
            ))}
        </div>
        <p className="table-phase-detail">
          {t(isAssassin ? 'assassin.nameMerlin' : 'assassin.contemplating')}
        </p>
      </>
    );
  const proposalPhases = game.phase === 'TeamAnnouncement'
    ? ['TeamBuilding', 'TeamAnnouncement', 'Discussion', 'TeamFinalizing', 'Voting'] as const
    : ['TeamBuilding', 'Discussion', 'TeamFinalizing', 'Voting'] as const;
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
      <TableFrame
        code={code}
        onOpenReport={() => setLogChannel('public')}
        report={
          <LogPanel game={game} channel={logChannel} onChannelChange={setLogChannel} />
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
            identity={<IdentityCard game={game} myPlayerId={myPlayerId} compact />}
          />
        )}
        connected={conn === 'connected'}
        latency={selfLatency}
        error={
          action.error ??
          (notice?.type === 'join_error' ? notice.message : null)
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
                  <ProposalTracker game={proposalGame} compact />
                </> : status}
              </span>
            </div>
            <MissionTrack
              game={displayGame}
              onSelect={setHistoryRound}
              compact
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
          board={board}
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
          <RoleReveal key={`${game.gameId}-${myPlayerId}-${game.roleRevision ?? 0}`} game={game} reveal={reveal} myPlayerId={myPlayerId} onAck={actions.ackRole} blocked={conn !== 'connected'}
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
