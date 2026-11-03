import { useTranslations } from 'use-intl';
import type { ClientGameState, PlayerId, VoteValue } from '@/lib/engine';
import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { Button } from '@/components/ui/Button';
import { GameIcon } from './GameArt';
import { TableSheet } from './TableSheet';

export interface PactSigner { id: PlayerId; vote?: VoteValue }

/** The viewer plus every mutually known red teammate, in seat order. */
export function pactSigners(game: ClientGameState, myPlayerId: string | null): PlayerId[] {
  const ids = new Set(game.knownPlayers.filter((k) => k.shownAs === 'known-ally').map((k) => k.playerId));
  if (myPlayerId) ids.add(myPlayerId);
  return game.players.filter((p) => ids.has(p.id)).map((p) => p.id);
}

/** Each known ally's portrait is a seal; the pact holds only when every seal is set. */
export function PactSeals({ game, myPlayerId, signers, initiatorId }: {
  game: ClientGameState; myPlayerId: string | null; signers: PactSigner[]; initiatorId: PlayerId;
}) {
  const t = useTranslations();
  return (
    <ol className="pact-seals" aria-label={t('assassin.pactSeals')}>
      {signers.map(({ id, vote }) => {
        const player = game.players.find((p) => p.id === id);
        const state = vote === 'approve' ? 'signed' : 'pending';
        return (
          <li key={id} className="pact-seal" data-state={state}
            aria-label={`${player?.name ?? id} · ${t(state === 'signed' ? 'assassin.agreed' : 'assassin.awaitingVote')}`}>
            <span className="pact-seal-ring">
              <PlayerAvatar playerId={id} avatarUrl={player?.avatarUrl} name={player?.name ?? id} className="pact-seal-avatar" />
              <span className="pact-seal-wax" aria-hidden="true">{state === 'signed' ? '✓' : ''}</span>
            </span>
            <span className="pact-seal-name">
              <span className="pact-seal-name-text">{player ? `${player.seat + 1}. ${player.name}` : id}</span>
              {id === myPlayerId && <span className="pact-seal-you">{t('common.you')}</span>}
            </span>
            <span className="pact-seal-tag">
              {id === initiatorId && t('assassin.initiator')}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** One strike decides the game either way. */
export function PactStakes() {
  const t = useTranslations();
  return (
    <div className="pact-stakes">
      <div className="pact-outcome" data-team="evil">
        <span className="pact-outcome-cause">{t('assassin.stakeHit')}</span>
        <strong>{t('gameOver.evilPrevails')}</strong>
      </div>
      <GameIcon name="assassinate" className="pact-dagger" />
      <div className="pact-outcome" data-team="good">
        <span className="pact-outcome-cause">{t('assassin.stakeMiss')}</span>
        <strong>{t('gameOver.goodTriumphs')}</strong>
      </div>
    </div>
  );
}

/** Initiator's view: their own seal is set by proposing; allies' seals wait. */
export function EarlyAssassinationProposal({ open, game, myPlayerId, busy, error, onClose, onConfirm }: {
  open: boolean; game: ClientGameState; myPlayerId: string | null;
  busy: boolean; error: string | null; onClose: () => void; onConfirm: () => void;
}) {
  const t = useTranslations();
  const ids = pactSigners(game, myPlayerId);
  const solo = ids.length <= 1;
  const signers = ids.map((id) => ({ id, vote: id === myPlayerId ? 'approve' as const : undefined }));
  return (
    <TableSheet open={open} title={t('assassin.startEarly')} onClose={onClose} busy={busy} error={error} className="pact-sheet">
      <div className="pact">
        {!solo && <p className="pact-eyebrow">{t('assassin.unanimous')}</p>}
        <PactSeals game={game} myPlayerId={myPlayerId} signers={signers} initiatorId={myPlayerId ?? ''} />
        <PactStakes />
        <div className="pact-actions">
          <Button variant="ghost" autoFocus disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="danger" disabled={busy} onClick={onConfirm}>
            {t(busy ? 'assassin.starting' : solo ? 'assassin.strikeNow' : 'assassin.confirmStart')}
          </Button>
        </div>
      </div>
    </TableSheet>
  );
}
