import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import type { ClientGameState } from '@/lib/engine';
import type { gameActions } from '@/lib/socket/client';
import { useRoomAction } from '@/lib/game/useRoomAction';
import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { Button } from '@/components/ui/Button';
import { GameIcon } from './GameArt';
import { PactSeals, PactStakes } from './EarlyAssassinationPact';
import { TableSheet } from './TableSheet';

/** Private ribbon for known red teammates; opens itself for allies who still owe a seal. */
export function EarlyAssassinationVote({ ballot, game, myPlayerId, connected, vote }: {
  ballot: NonNullable<ClientGameState['earlyAssassination']>;
  game: ClientGameState;
  myPlayerId: string | null;
  connected: boolean;
  vote: typeof gameActions.voteAssassination;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const hasVoted = !!myPlayerId && !!ballot.votes[myPlayerId];
  const [open, setOpen] = useState(!hasVoted);
  const action = useRoomAction(String(ballot.id), t('table.actionFailed'));
  const player = (id: string) => game.players.find((p) => p.id === id);
  const signers = ballot.voterIds.map((id) => ({ id, vote: ballot.votes[id] }));
  const count = signers.filter((s) => s.vote === 'approve').length;
  const waiting = signers.filter((s) => !s.vote).map((s) => player(s.id)?.name ?? s.id);
  return <>
    <button type="button" className="pact-ribbon" data-owed={!hasVoted || undefined} onClick={() => setOpen(true)}
      aria-label={t('assassin.voteProgress', { count, total: ballot.voterIds.length })}>
      <GameIcon name="assassinate" className="pact-ribbon-dagger" />
      <span className="pact-ribbon-title">{t('assassin.startEarly')}</span>
      <span className="pact-ribbon-seals" aria-hidden="true">
        {signers.map(({ id, vote: v }) => (
          <PlayerAvatar key={id} playerId={id} avatarUrl={player(id)?.avatarUrl} name={player(id)?.name ?? id}
            className={v === 'approve' ? 'is-signed' : undefined} />
        ))}
      </span>
      <span className="pact-ribbon-count" aria-hidden="true">{count}/{ballot.voterIds.length}</span>
    </button>
    <TableSheet open={open} title={t('assassin.startEarly')} onClose={() => setOpen(false)} busy={action.busy} error={action.error} className="pact-sheet">
      <div className="pact">
        <p className="pact-eyebrow">{t('assassin.unanimous')}</p>
        <PactSeals game={game} myPlayerId={myPlayerId} signers={signers} initiatorId={ballot.initiatorId} />
        <PactStakes />
        {hasVoted ? (
          <p role="status" className="pact-waiting">{t('assassin.waitingFor', { players: new Intl.ListFormat(locale).format(waiting) })}</p>
        ) : (
          <div className="pact-actions">
            <Button variant="ghost" disabled={!connected || action.busy} onClick={() => void action.run(() => vote(ballot.id, 'reject'))}>
              {t('assassin.rejectEarly')}
            </Button>
            <Button variant="danger" disabled={!connected || action.busy} onClick={() => void action.run(() => vote(ballot.id, 'approve'))}>
              {t('assassin.approveEarly')}
            </Button>
          </div>
        )}
      </div>
    </TableSheet>
  </>;
}
