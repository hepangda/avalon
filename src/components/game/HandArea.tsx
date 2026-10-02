import { useTranslations } from 'use-intl';
import type { ClientGameState } from '@/lib/engine';
import type { Ack } from '@/lib/socket/types';
import { gameActions } from '@/lib/socket/client';
import { actionAvailability } from '@/lib/game/actionAvailability';

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
        className={`table-action ${pick.tone === 'crimson' ? 'is-negative' : ''}`}
        disabled={disabled || selected.length !== pick.size}
        onClick={() => void run(pick.onConfirm)}
      >
        {selected.length === pick.size
          ? pick.confirmLabel
          : t('table.pickRemaining', { count: pick.size - selected.length })}
      </button>
    );
  const canStartDiscussion = game.phase === 'TeamAnnouncement' && game.players.some((p) => p.id === myPlayerId && p.isLeader);
  const canEndSpeech = game.phase === 'Discussion' && game.discussion?.order[game.discussion.speakerIndex] === myPlayerId;
  if (canStartDiscussion)
    return (
      <>
        <button type="button" className="table-action" disabled={disabled}
          onClick={() => void run(() => actions.startDiscussion('clockwise'))}>
          <svg className="discussion-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M19 12H5m7-7-7 7 7 7" />
          </svg>
          <span>{t('discussion.startClockwise')}</span>
        </button>
        <button type="button" className="table-action" disabled={disabled}
          onClick={() => void run(() => actions.startDiscussion('counterclockwise'))}>
          <span>{t('discussion.startCounterclockwise')}</span>
          <svg className="discussion-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M5 12h14m-7-7 7 7-7 7" />
          </svg>
        </button>
      </>
    );
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
          onClick={() => void run(() => actions.vote('approve'))}
        >
          {t('vote.approve')}
        </button>
        <button
          type="button"
          className="table-action is-negative"
          disabled={disabled}
          onClick={() => void run(() => actions.vote('reject'))}
        >
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
          onClick={() => void run(() => actions.missionCard('success'))}
        >
          {t('missionVote.success')}
        </button>
        <button
          type="button"
          className="table-action is-negative"
          disabled={disabled || !canFail}
          aria-label={
            !canFail ? t('missionVote.loyalOnlySuccess') : t('missionVote.fail')
          }
          onClick={() => void run(() => actions.missionCard('fail'))}
        >
          {t('missionVote.fail')}
          {!canFail && <span aria-hidden="true"> · 🔒</span>}
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
