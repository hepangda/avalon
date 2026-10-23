import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { gameActions, roomActions } from '@/lib/socket/client';
import { useRoomStore } from '@/lib/store/room';
import { useRoomAction } from '@/lib/game/useRoomAction';
import type { ClientGameState } from '@/lib/engine';
import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { AdminPanel } from './AdminPanel';
import { EarlyAssassinationProposal, pactSigners } from './EarlyAssassinationPact';
import { GameIcon } from './GameArt';

/** Actions outside the normal turn; the pact gets its own sheet. */
export function FunctionsPanel({ code, game, onAssassinationStarted }: {
  code: string; game: ClientGameState; onAssassinationStarted: () => void;
}) {
  const t = useTranslations();
  const myPlayerId = useRoomStore((state) => state.myPlayerId);
  const isHost = useRoomStore((state) => state.isHost);
  const hostPlayerId = useRoomStore((state) => state.snapshot?.hostPlayerId);
  const transfer = useRoomAction(`${code}:host:${isHost}`, t('table.actionFailed'));
  const hostCandidates = game.players.filter((player) => player.claimed && player.connected && !player.isBot && player.id !== hostPlayerId);
  const [heirId, setHeirId] = useState<string | null>(null);
  const heir = hostCandidates.find((player) => player.id === heirId);
  const [confirm, setConfirm] = useState<'assassination' | null>(null);
  const action = useRoomAction(`${code}:${game.gameId}:${game.phaseRevision}:${confirm}`, t('table.actionFailed'));
  useEffect(() => {
    if (!game.canStartAssassination) setConfirm((current) => current === 'assassination' ? null : current);
  }, [game.canStartAssassination]);

  async function startAssassination() {
    if (confirm !== 'assassination' || !game.canStartAssassination) return;
    if (await action.run(gameActions.startAssassination)) {
      setConfirm(null);
      onAssassinationStarted();
    }
  }

  return (
    <div className="fx-panel">
      {game.canStartAssassination && (
        <button type="button" disabled={action.busy} onClick={() => setConfirm('assassination')} className="pact-entry">
          <GameIcon name="assassinate" className="pact-entry-dagger" />
          <span className="pact-entry-title">{t('assassin.startEarly')}</span>
          <span className="pact-ribbon-seals" aria-hidden="true">
            {pactSigners(game, myPlayerId).map((id) => {
              const player = game.players.find((p) => p.id === id);
              return <PlayerAvatar key={id} playerId={id} avatarUrl={player?.avatarUrl} name={player?.name ?? id} />;
            })}
          </span>
        </button>
      )}
      {!game.isSpectator && <AdminPanel game={game} />}
      {isHost && hostCandidates.length > 0 && (
        <section className="fx-crown" aria-label={t('lobby.transferHost')}>
          <header className="fx-crown-head">
            <GameIcon name="crest" className="fx-crown-crest" />
            <h3>{t('lobby.transferHost')}</h3>
            <button type="button" className="fx-crown-confirm" disabled={transfer.busy || !heir}
              aria-label={heir ? `${t('lobby.transferHost')} ${heir.name}` : undefined}
              onClick={() => heir && void transfer.run(() => roomActions.transferHost(heir.id)).then((ok) => ok && setHeirId(null))}>
              {t('common.confirm')}
            </button>
          </header>
          <div className="fx-heirs" role="radiogroup" aria-label={t('lobby.transferHost')}>
            {hostCandidates.map((player) => (
              <button key={player.id} type="button" role="radio" aria-checked={player.id === heirId}
                className="fx-heir" disabled={transfer.busy}
                onClick={() => setHeirId((current) => current === player.id ? null : player.id)}>
                <PlayerAvatar playerId={player.id} avatarUrl={player.avatarUrl} name={player.name} className="fx-heir-avatar" />
                <span className="fx-heir-name">{player.seat + 1}. {player.name}</span>
              </button>
            ))}
          </div>
          {transfer.error && <p role="alert" className="fx-alert">{transfer.error}</p>}
        </section>
      )}
      <EarlyAssassinationProposal open={confirm === 'assassination'} game={game} myPlayerId={myPlayerId}
        busy={action.busy} error={action.error} onClose={() => setConfirm(null)} onConfirm={() => void startAssassination()} />
    </div>
  );
}
