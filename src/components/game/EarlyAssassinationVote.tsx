import { useState } from 'react';
import { useTranslations } from 'use-intl';
import type { ClientGameState } from '@/lib/engine';
import type { gameActions } from '@/lib/socket/client';
import { useRoomAction } from '@/lib/game/useRoomAction';
import { Button } from '@/components/ui/Button';
import { TableSheet } from './TableSheet';

export function EarlyAssassinationVote({ ballot, game, myPlayerId, connected, vote }: {
  ballot: NonNullable<ClientGameState['earlyAssassination']>;
  game: ClientGameState;
  myPlayerId: string | null;
  connected: boolean;
  vote: typeof gameActions.voteAssassination;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(true);
  const action = useRoomAction(String(ballot.id), t('table.actionFailed'));
  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? id;
  const count = Object.keys(ballot.votes).length;
  const hasVoted = !!myPlayerId && !!ballot.votes[myPlayerId];
  return <>
    <button type="button" className="table-tool w-full text-crimson" onClick={() => setOpen(true)}>
      {t('assassin.voteProgress', { count, total: ballot.voterIds.length })}
    </button>
    <TableSheet open={open} title={t('assassin.voteTitle')} onClose={() => setOpen(false)} busy={action.busy} error={action.error}>
      <div className="space-y-4 text-sm text-parchment/80">
        <p>{t('assassin.voteRequested', { player: name(ballot.initiatorId) })}</p>
        <p>{t('assassin.voteRules')}</p>
        <p>{t('assassin.earlyOutcome')}</p>
        <ul className="space-y-2">
          {ballot.voterIds.map((id) => <li key={id} className="flex justify-between gap-4">
            <span>{name(id)}</span><span>{t(ballot.votes[id] ? 'assassin.agreed' : 'assassin.awaitingVote')}</span>
          </li>)}
        </ul>
        {hasVoted ? <p role="status">{t('assassin.waitingAllies')}</p> : <div className="flex gap-2">
          <Button variant="ghost" disabled={!connected || action.busy} onClick={() => void action.run(() => vote(ballot.id, 'reject'))}>{t('assassin.rejectEarly')}</Button>
          <Button variant="danger" disabled={!connected || action.busy} onClick={() => void action.run(() => vote(ballot.id, 'approve'))}>{t('assassin.approveEarly')}</Button>
        </div>}
      </div>
    </TableSheet>
  </>;
}
