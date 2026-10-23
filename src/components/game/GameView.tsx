import { ActionTimerBadge } from '@/components/game/ActionTimerBadge';
import { DockTimer } from '@/components/game/SeatTimer';
import { AssassinationReveal } from '@/components/game/AssassinationReveal';
import { GameOverTitleCard, useEndingReveal } from '@/components/game/GameOverReveal';
import { GameTable } from '@/components/game/GameTable';
import { GameTools } from '@/components/game/GameTools';
import { HandArea, type PickConfig } from '@/components/game/HandArea';
import { IdentityCard } from '@/components/game/IdentityCard';
import { LadyResultReveal } from '@/components/game/LadyResultReveal';
import { LeaveTableButton } from '@/components/game/LeaveTableButton';
import { LogPanel, type LogChannel } from '@/components/game/LogPanel';
import { MissionTrack } from '@/components/game/MissionTrack';
import { ProposalTracker } from '@/components/game/ProposalTracker';
import { RoleNotePopover } from '@/components/game/RoleNotePopover';
import { RoleReveal } from '@/components/game/RoleReveal';
import { SeatMenu, type SeatMenuActions } from '@/components/game/SeatMenu';
import { TableCard } from '@/components/game/TableCard';
import { TableFrame } from '@/components/game/TableFrame';
import { AvatarFactionProvider } from '@/components/player/AvatarFactions';
import { ReconnectOverlay } from '@/components/ui/ReconnectOverlay';
import { Link } from '@/i18n/navigation';
import type { ClientGameState, ClientPlayer } from '@/lib/engine';
import { actionAvailability } from '@/lib/game/actionAvailability';
import { avatarFactions, displayedRoleNotes, knownRoleNotes, roleNoteOptions, roleNotesKey } from '@/lib/game/roleNotes';
import { useGameClock } from '@/lib/game/useGameClock';
import { useRoleNotes } from '@/lib/game/useRoleNotes';
import { useRoomAction } from '@/lib/game/useRoomAction';
import { useLadyResult } from '@/lib/game/useLadyResult';
import { useTablePresentation } from '@/lib/game/useTablePresentation';
import { endingMarks } from '@/lib/game/tablePresentation';
import { useTableShortcuts } from '@/lib/game/tableShortcuts';
import { useTurnAlert } from '@/lib/game/useTurnAlert';
import { useGameVoice } from '@/lib/audio/useGameVoice';
import { useEndingSounds, useTableSounds } from '@/lib/audio/useTableSounds';
import {
  gameActions,
  roomActions
} from '@/lib/socket/client';
import type { Ack } from '@/lib/socket/types';
import { joinErrorText } from '@/lib/socket/client/joinErrorText';
import { useRoomStore, type RoomNotice } from '@/lib/store/room';
import { AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { PhaseBoard } from './PhaseBoard';
import { EarlyAssassinationVote } from './EarlyAssassinationVote';
import { FeltAmbience, FeltObjects } from './FeltObjects';
import { PhaseBeats } from './PhaseBeats';
import { TableEmotes } from './TableEmotes';

/** Shared table: live rooms supply socket actions; the gallery supplies a local engine. */
export function GameView({
  code, roomName, game, isHost, conn, myPlayerId,
  selfLatency, notice = null, onDismissNotice, actions = gameActions,
  onRestart = roomActions.restart, functionsContent,
}: {
  code: string;
  roomName?: string;
  game: ClientGameState | null;
  isHost: boolean;
  conn: 'connected' | 'connecting' | 'disconnected';
  myPlayerId: string | null;
  selfLatency: number | null;
  notice?: RoomNotice | null;
  onDismissNotice?: () => void;
  actions?: typeof gameActions;
  onRestart?: () => Promise<Ack>;
  functionsContent?: ReactNode;
}) {
  const t = useTranslations();
  const [logFocus, setLogFocus] = useState<{ round: number; at: number } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
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
  const [emoteAnchor, setEmoteAnchor] = useState<HTMLElement | null>(null);
  const closeEmotes = useCallback(() => setEmoteAnchor(null), []);
  const [seatMenu, setSeatMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const closeSeatMenu = useCallback(() => setSeatMenu(null), []);
  const hostPlayerId = useRoomStore((state) => state.snapshot?.hostPlayerId);
  const transfer = useRoomAction(`${code}:seat-host:${isHost}:${seatMenu?.id}`, t('table.actionFailed'));
  const phaseKey = `${code}-${game?.gameId}-${myPlayerId}-${game?.phase}-${game?.roundIndex}-${game?.rejectionCount}-${game?.phaseRevision}-${game?.roleRevision}-${game?.discussion?.speakerIndex}`;
  const now = useGameClock(game?.serverTime);
  const action = useRoomAction(phaseKey, t('table.actionFailed'));
  const leaving = useRoomAction(`${code}:leave`, t('table.actionFailed'));
  const { presentation, reportGame, finish, settled } = useTablePresentation(game);
  useGameVoice(game, settled, conn === 'connected');
  const ending = useEndingReveal(presentation?.kind === 'gameOver' ? presentation : null, finish);
  const lady = useLadyResult(game, myPlayerId);
  const draftKey = game?.proposedTeam?.join(',') ?? '';
  useEffect(() => setSelected(game?.phase === 'TeamFinalizing' && draftKey ? draftKey.split(',') : []), [phaseKey, game?.phase, draftKey]);
  useTurnAlert(game, myPlayerId, !settled || conn !== 'connected');
  useTableShortcuts(!!game && settled && conn === 'connected');
  const shownLeader = game?.players.find((p) => p.seat === game.leaderIndex)?.id;
  useTableSounds({
    game,
    settled,
    sealedRounds: game?.missionResults.length ?? 0,
    leaderId: shownLeader,
  });
  useEndingSounds(game, presentation?.kind === 'gameOver' ? presentation : null, ending.stage, ending.revealed.size);

  if (!game)
    return (
      <main className="table-screen items-center justify-center">
        <ReconnectOverlay active={notice?.type === 'session_replaced'} sessionReplaced />
        <p role={notice?.type === 'join_error' ? 'alert' : 'status'}>
          {notice?.type === 'join_error'
              ? joinErrorText(notice, t)
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
  const needsRoleReveal =
    game.phase !== 'GameOver' &&
    !!myPlayerId &&
    !game.isSpectator &&
    !game.roleAcks.includes(myPlayerId);
  const notePlayer = game.players.find((p) => p.id === noteTarget?.id);
  const noteOptions = notePlayer ? roleNoteOptions(game, myPlayerId, notePlayer.id) : [];
  const editableNoteIds = game.players.filter((p) => roleNoteOptions(game, myPlayerId, p.id).length > 0).map((p) => p.id);
  const displayedNotes = displayedRoleNotes(game, myPlayerId, notes, notesEnabled);
  const knownNotes = knownRoleNotes(game, myPlayerId);
  const automaticNotes = notesEnabled ? knownNotes : {};
  // Portrait rings would tell the viewer's role before they have read their own card.
  const factions = needsRoleReveal ? {} : avatarFactions(displayedNotes, knownNotes, myPlayerId);
  const { canVote, canMission } = actionAvailability(game, myPlayerId);
  const leader = game.players.find((p) => p.seat === game.leaderIndex);
  const isLeader = leader?.id === myPlayerId;
  const teamSize = game.config.missionSizes[game.roundIndex] ?? 0;
  const team = game.proposedTeam ?? [];
  const speakerId = game.phase === 'Discussion' ? game.discussion?.order[game.discussion.speakerIndex] : undefined;
  const selfTimer = game.actionTimers?.find((timer) => timer.playerId === myPlayerId);
  const isHolder = game.lady?.holderId === myPlayerId;
  const isAssassin = !!game.assassinCandidates;
  const isOver = game.phase === 'GameOver' && presentation?.kind !== 'assassination';
  const endingMarksById = game.outcome ? endingMarks(game.outcome) : {};
  const lostSide = (id: string) =>
    !!game.outcome && game.outcome.revealedRoles.find((r) => r.playerId === id)?.team !== game.outcome.winner;
  const canEmote = !!myPlayerId && !game.isSpectator && conn === 'connected';
  const activePhase =
    presentation?.kind === 'vote'
      ? 'Voting'
      : presentation?.kind === 'mission'
        ? 'MissionResult'
        : presentation?.kind === 'assassination'
          ? 'Assassination'
          : presentation?.kind === 'lady'
            ? 'LadyOfLake'
            : game.phase;
  const round =
    presentation?.kind === 'vote'
      ? presentation.record.roundIndex
      : presentation?.kind === 'mission'
        ? presentation.result.roundIndex
        : presentation?.kind === 'lady'
          ? presentation.roundIndex
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
  let candidateIds: string[] | undefined;
  let pick: PickConfig | null = null;
  if (game.rolesPending) {
    // Nobody acts until every identity has been confirmed.
  } else if ((game.phase === 'TeamBuilding' || game.phase === 'TeamFinalizing') && isLeader) {
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
    if (presentation?.kind === 'gameOver' && p.role)
      return <TableCard role={p.role} variant={p.roleVariant} faceDown={!ending.revealed.has(p.id)}
        mark={endingMarksById[p.id]} lost={lostSide(p.id)} />;
    if (isOver && p.role) return <TableCard role={p.role} variant={p.roleVariant} mark={endingMarksById[p.id]} lost={lostSide(p.id)} />;
    if (game!.rolesPending) return <TableCard state={game!.roleAcks.includes(p.id) ? 'back' : 'empty'} />;
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
        state="inactive"
        nominee={selected.includes(p.id) ? p.seat + 1 : undefined}
        assassination={game!.phase === 'Assassination'}
      />
    );
  }
  const canMarkRole = notesEnabled && !needsRoleReveal;
  function seatMenuActions(p: ClientPlayer): SeatMenuActions {
    const isMe = p.id === myPlayerId;
    return {
      onMarkRole: canMarkRole && !isMe && editableNoteIds.includes(p.id) ? () => {
        const tag = seatMenu?.anchor.closest('.table-seat-wrap')?.querySelector<HTMLButtonElement>('button.table-role-note');
        if (tag) setNoteTarget({ id: p.id, anchor: tag });
      } : undefined,
      onEmote: isMe && canEmote && !needsRoleReveal ? () => setEmoteAnchor(seatMenu?.anchor ?? null) : undefined,
      transfer: isHost && !isMe && p.claimed && p.connected && !p.isBot && p.id !== hostPlayerId ? {
        busy: transfer.busy,
        error: transfer.error,
        run: () => void transfer.run(() => roomActions.transferHost(p.id)).then((done) => done && setSeatMenu(null)),
      } : undefined,
    };
  }
  const menuPlayer = seatMenu && game.players.find((p) => p.id === seatMenu.id);
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
    : game.rolesPending
      ? t('table.roleCount', { count: game.roleAcks.length, total: game.players.length })
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
    <AvatarFactionProvider value={factions}>
      <ReconnectOverlay active={notice?.type === 'session_replaced' || (conn !== 'connected' && notice?.type !== 'join_error')} sessionReplaced={notice?.type === 'session_replaced'} />
      <TableFrame
        code={code}
        title={roomName}
        headerStart={<LeaveTableButton code={code} busy={leaving.busy} run={leaving.run} />}
        onOpenReport={() => { setLogFocus(null); setLogChannel('public'); }}
        report={
          <LogPanel game={reportGame ?? game} channel={logChannel} focus={logFocus}
            onChannelChange={(channel) => { setLogFocus(null); setLogChannel(channel); }} />
        }
        dockStart={<IdentityCard game={game} myPlayerId={myPlayerId} />}
        tools={(viewToggle) => (
          <GameTools
            game={game}
            code={code}
            viewToggle={viewToggle}
            functionsContent={functionsContent}
            notesEnabled={notesEnabled}
            onNotesChange={setNotesEnabled}
            notesSaveFailed={saveFailed}
            onClearNotes={() => { clearNotes(); setNoteTarget(null); }}
            hasManualNotes={Object.keys(notes).length > 0}
          />
        )}
        connected={conn === 'connected'}
        latency={selfLatency}
        error={
          action.error ??
          leaving.error ??
          (notice?.type === 'join_error' ? joinErrorText(notice, t) ?? null : null)
        }
        onDismissError={() => {
          action.clearError();
          leaving.clearError();
          onDismissNotice?.();
        }}
        progress={(openReport) => (
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
                {showProposals && !game.rolesPending ? <>
                  {activePhase === 'Voting' && <span className="tabular-nums" aria-label={t('table.voteCount', { count: voteCount, total: game.players.length })}>{voteCount}/{game.players.length}</span>}
                  <ProposalTracker game={proposalGame} />
                </> : status}
              </span>
            </div>
            <MissionTrack
              game={displayGame}
              onSelect={(round) => {
                setLogChannel('public');
                setLogFocus({ round, at: Date.now() });
                openReport();
              }}
            />
          </>
        )}
        footer={
          <>
            {!presentation && !isOver && selfTimer && <DockTimer timer={selfTimer} now={now} />}
            <div className="table-actions">
              {needsRoleReveal ? (
                <div className="table-action-placeholder" />
              ) : presentation ? (
                <div className="table-action-placeholder" aria-live="polite">
                  {t('table.resolving')}
                </div>
              ) : isOver ? (
                <>
                  {isHost ? (
                    <button
                      type="button"
                      className="table-action"
                      disabled={action.busy || blocked}
                      onClick={() => void action.run(onRestart)}
                    >
                      {t(action.busy ? 'gameOver.restarting' : 'gameOver.playAgain')}
                    </button>
                  ) : (
                    <p className="table-action-placeholder gap-2.5" aria-live="polite">
                      <span className="lobby-pulse" aria-hidden="true" />
                      {t('gameOver.waitingRestart')}
                    </p>
                  )}
                  {game.gameId ? (
                    <Link
                      href={`/replay/${game.gameId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="table-action is-quiet"
                    >
                      {t('gameOver.viewReplay')}
                    </Link>
                  ) : (
                    <button type="button" className="table-action is-quiet" disabled>
                      {t('gameOver.viewReplay')}
                    </button>
                  )}
                </>
              ) : game.isSpectator ? (
                <div className="table-action-placeholder">
                  {t('game.spectating')}
                </div>
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
          board={needsRoleReveal ? null : <>
            {!presentation && !isOver && !game.earlyAssassination && <FeltObjects game={game} />}
            {/* The ballot rides in the empty band above the title, so opening one moves nothing. */}
            {game.earlyAssassination && <EarlyAssassinationVote
              key={game.earlyAssassination.id} ballot={game.earlyAssassination} game={game}
              myPlayerId={myPlayerId} connected={conn === 'connected'} vote={actions.voteAssassination} />}
            <PhaseBoard game={game} presentation={presentation} isOver={isOver} isLeader={isLeader}
              isHolder={isHolder} isAssassin={isAssassin} canVote={canVote} canMission={canMission}
              selected={selected} round={round} teamSize={teamSize} endingStage={ending.stage} />
          </>}
          card={card}
          speakerId={!presentation ? speakerId : undefined}
          seatTimer={(p) => presentation ? undefined : game.actionTimers?.find((item) => item.playerId === p.id)}
          now={now}
          selectedIds={selected}
          selectable={!!pick && !blocked && !action.busy}
          candidateIds={candidateIds}
          highlightIds={displayTeam}
          onToggle={toggle}
          missionReveal={presentation?.kind === 'mission' ? presentation : null}
          ladyFlight={presentation?.kind === 'lady' && !presentation.loyalty ? presentation : null}
          onRevealComplete={finish}
          roleNotes={displayedNotes}
          knownNotes={knownNotes}
          editableNoteIds={editableNoteIds}
          // Seat notes would name the viewer's role before their card is turned over.
          onEditRoleNote={notesEnabled && !needsRoleReveal ? (id, anchor) => {
            if (editableNoteIds.includes(id)) setNoteTarget((current) => current?.id === id ? null : { id, anchor });
          } : undefined}
          notePlayerId={noteTarget?.id}
          notePopoverId={notePopoverId}
          felt={<FeltAmbience game={game} />}
          overlay={<>
            <PhaseBeats game={game} myPlayerId={myPlayerId} held={!!presentation} />
            <TableEmotes anchor={canEmote && !needsRoleReveal ? emoteAnchor : null} onClose={closeEmotes}
              onSend={(emote) => void actions.emote(emote)} />
          </>}
          onSelfMenu={canEmote && !needsRoleReveal ? (anchor) => setEmoteAnchor((current) => current ? null : anchor) : undefined}
          selfMenuOpen={canEmote && !!emoteAnchor}
          onSeatMenu={(id, anchor) => {
            const player = game.players.find((p) => p.id === id);
            const actions = player && seatMenuActions(player);
            // A seat with neither a record nor anything to do opens nothing.
            if (player && (!player.isBot || actions?.onMarkRole)) setSeatMenu({ id, anchor });
          }}
          seatMenuId={seatMenu?.id}
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
      <AnimatePresence>
        {menuPlayer && seatMenu && (
          <SeatMenu key={menuPlayer.id} code={code} player={menuPlayer} anchor={seatMenu.anchor}
            isMe={menuPlayer.id === myPlayerId} actions={seatMenuActions(menuPlayer)} onClose={closeSeatMenu} />
        )}
      </AnimatePresence>
      {presentation?.kind === 'assassination' && (
        <AssassinationReveal key={presentation.id} event={presentation} onComplete={finish} />
      )}
      <AnimatePresence>
        {presentation?.kind === 'gameOver' && ending.stage === 'title' && (
          <GameOverTitleCard key={presentation.id} event={presentation} game={game} onSkip={ending.skipTitle} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {needsRoleReveal && (
          <RoleReveal key={`${game.gameId}-${myPlayerId}-${game.roleRevision ?? 0}`} game={game} myPlayerId={myPlayerId} onAck={actions.ackRole} onReroll={actions.useRerollCard} blocked={conn !== 'connected'}
            timer={selfTimer && <ActionTimerBadge timer={selfTimer} now={now} />} />
        )}
      </AnimatePresence>
      {presentation?.kind === 'lady' && presentation.loyalty && (
        <LadyResultReveal
          key={presentation.id}
          game={game}
          result={{ targetId: presentation.targetId, loyalty: presentation.loyalty }}
          onClose={() => { lady.markSeen(); finish(presentation.id); }}
        />
      )}
      {!presentation && lady.unseen && (
        <LadyResultReveal
          game={game}
          result={lady.unseen}
          onClose={lady.markSeen}
        />
      )}
    </AvatarFactionProvider>
  );
}
