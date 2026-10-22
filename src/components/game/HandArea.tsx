import { useTranslations } from 'use-intl';
import { speakingOrder, type ClientGameState } from '@/lib/engine';
import type { Ack } from '@/lib/socket/types';
import { gameActions } from '@/lib/socket/client';
import { actionAvailability } from '@/lib/game/actionAvailability';
import { GameIcon } from './GameArt';

export interface PickConfig {
  size: number;
  confirmLabel: string;
  tone: 'gold' | 'crimson' | 'sky';
  onConfirm: () => Promise<Ack>;
}

/** Fixed action rail. Acknowledged submissions are read from the room projection. */
export function HandArea({
  game,
  myPlayerId,
  selected,
  pick,
  busy,
  blocked,
  run,
  actions = gameActions,
}: {
  actions?: Pick<typeof gameActions, 'vote' | 'missionCard' | 'startDiscussion' | 'endSpeech'>;
  game: ClientGameState;
  myPlayerId: string | null;
  selected: string[];
  pick: PickConfig | null;
  busy: boolean;
  blocked: boolean;
  run: (action: () => Promise<Ack<unknown>>) => Promise<boolean>;
}) {
  const t = useTranslations();
  const disabled = busy || blocked;
  const { canVote, canMission, canFail } = actionAvailability(game, myPlayerId);
  if (game.isSpectator)
    return (
      <div className="table-action-placeholder">{t('game.spectating')}</div>
    );
  if (pick)
    return (
      <button
        type="button"
        className={`table-action ${pick.tone === 'crimson' ? 'is-negative' : pick.tone === 'sky' ? 'is-positive' : ''}`}
        disabled={disabled || selected.length !== pick.size}
        aria-keyshortcuts="Enter"
        onClick={() => void run(pick.onConfirm)}
      >
        {selected.length === pick.size
          ? pick.confirmLabel
          : t('table.pickRemaining', { count: pick.size - selected.length })}
      </button>
    );
  const canStartDiscussion = game.phase === 'TeamAnnouncement' && game.players.some((p) => p.id === myPlayerId && p.isLeader);
  const canEndSpeech = game.phase === 'Discussion' && game.discussion?.order[game.discussion.speakerIndex] === myPlayerId;
  if (canStartDiscussion && myPlayerId) {
    // Name the seat that opens each way round: the leader's neighbour on either side.
    const openers = (['clockwise', 'counterclockwise'] as const).map((direction) => ({
      direction,
      // The client is not told the flow version. Of the versions that wait for the leader here, only the
      // current one (5) is still dealt; version 2 games, where the leader always spoke first, predate it.
      player: game.players.find((p) => p.id === speakingOrder(game.players, myPlayerId, direction, 5)[0]),
    }));
    return (
      <>
        {openers.map(({ direction, player }) => player && (
          <button key={direction} type="button" className="table-action is-compact" disabled={disabled}
            title={`${player.seat + 1}. ${player.name}`}
            aria-label={t('discussion.startFrom', { seat: player.seat + 1 })}
            onClick={() => void run(() => actions.startDiscussion(direction))}>
            {/* You sit mid-row with seats rising left to right, so seat X-1 is always on your left. */}
            <span className="table-start-seat">
              {direction === 'clockwise' && <Arrow side="left" />}
              {t('discussion.startSeat', { seat: player.seat + 1 })}
              {/* Stacked on a phone the arrow stays by the seat; on one line it closes the label. */}
              {direction === 'counterclockwise' && <Arrow side="right" className="is-stacked" />}
            </span>
            <span className="table-start-verb">{t('discussion.startVerb')}</span>
            {direction === 'counterclockwise' && <Arrow side="right" className="is-inline" />}
          </button>
        ))}
      </>
    );
  }
  if (canEndSpeech)
    return (
      <button type="button" className="table-action" disabled={disabled}
        onClick={() => void run(actions.endSpeech)}>
        {t('discussion.finishSpeech')}
      </button>
    );
  if (canVote)
    return (
      <>
        <button
          type="button"
          className="table-action is-positive"
          disabled={disabled}
          aria-keyshortcuts="Y"
          onClick={() => void run(() => actions.vote('approve'))}
        >
          <GameIcon name="approve" className="table-action-icon" />
          {t('vote.approve')}
        </button>
        <button
          type="button"
          className="table-action is-negative"
          disabled={disabled}
          aria-keyshortcuts="N"
          onClick={() => void run(() => actions.vote('reject'))}
        >
          <GameIcon name="reject" className="table-action-icon" />
          {t('vote.reject')}
        </button>
      </>
    );
  if (canMission)
    return (
      <>
        <button
          type="button"
          className="table-action is-positive"
          disabled={disabled}
          aria-keyshortcuts="S"
          onClick={() => void run(() => actions.missionCard('success'))}
        >
          <GameIcon name="missionSuccess" className="table-action-icon" />
          {t('missionVote.success')}
        </button>
        <button
          type="button"
          className="table-action is-negative"
          disabled={disabled || !canFail}
          aria-keyshortcuts="F"
          aria-label={
            !canFail ? t('missionVote.loyalOnlySuccess') : t('missionVote.fail')
          }
          onClick={() => void run(() => actions.missionCard('fail'))}
        >
          <GameIcon name="missionFail" className="table-action-icon" />
          {t('missionVote.fail')}
          {!canFail && (
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <rect x="4.5" y="9" width="11" height="8" rx="1.5" />
              <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
            </svg>
          )}
        </button>
      </>
    );
  return (
    <div className="table-action-placeholder" aria-live="polite">
      {t(game.phase === 'Voting'
        ? 'table.waitingVotes'
        : game.phase === 'MissionVote'
          ? 'table.waitingMissionCards'
          : 'table.waiting')}
    </div>
  );
}

function Arrow({ side, className }: { side: 'left' | 'right'; className?: string }) {
  return (
    <svg className={`table-action-arrow ${className ?? ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={side === 'left' ? 'M13 8H3m4-4L3 8l4 4' : 'M3 8h10M9 4l4 4-4 4'} />
    </svg>
  );
}
