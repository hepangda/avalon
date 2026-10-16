import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { gameActions, roomActions } from '@/lib/socket/client';
import { useRoomStore } from '@/lib/store/room';
import { useSessionStore } from '@/lib/store/session';
import { wouldDissolveRoom } from '@/lib/game/roomDissolution';
import { useRoomAction } from '@/lib/game/useRoomAction';
import type { ClientGameState } from '@/lib/engine';
import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { AdminPanel } from './AdminPanel';
import { EarlyAssassinationProposal, pactSigners } from './EarlyAssassinationPact';
import { GameIcon } from './GameArt';
import { TableSheet } from './TableSheet';

/** Actions outside the normal turn; confirmations share the native modal boundary. */
export function FunctionsPanel({ code, game, onAssassinationStarted }: {
  code: string; game: ClientGameState; onAssassinationStarted: () => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const snapshot = useRoomStore((state) => state.snapshot);
  const myPlayerId = useRoomStore((state) => state.myPlayerId);
  const isHost = useRoomStore((state) => state.isHost);
  const hostPlayerId = useRoomStore((state) => state.snapshot?.hostPlayerId);
  const willDissolve = snapshot ? wouldDissolveRoom(snapshot, myPlayerId, isHost) : false;
  const transfer = useRoomAction(`${code}:host:${isHost}`, t('table.actionFailed'));
  const hostCandidates = game.players.filter((player) => player.claimed && player.connected && !player.isBot && player.id !== hostPlayerId);
  const [confirm, setConfirm] = useState<'leave' | 'assassination' | null>(null);
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
  async function leave() {
    if (!await action.run(roomActions.leave)) return;
    useSessionStore.getState().setSession(code, { playerId: undefined, playerToken: undefined });
    useRoomStore.getState().reset();
    router.push('/');
  }

  return (
    <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
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
        <details className="rounded-lg border border-gold/20 bg-ink/30 px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-parchment">{t('lobby.transferHost')}</summary>
          <div className="mt-3 space-y-2">
            {hostCandidates.map((player) => (
              <div key={player.id} className="flex items-center justify-between gap-3 text-sm text-parchment">
                <span className="truncate">{player.name}</span>
                <Button variant="ghost" disabled={transfer.busy} aria-label={`${t('lobby.transferHost')} ${player.name}`}
                  onClick={() => void transfer.run(() => roomActions.transferHost(player.id))}>
                  {t('lobby.transferHost')}
                </Button>
              </div>
            ))}
            {transfer.error && <p role="alert" className="text-sm text-crimson">{transfer.error}</p>}
          </div>
        </details>
      )}
      <button type="button" onClick={() => setConfirm('leave')}
        className="flex w-full items-center gap-3 rounded-lg border border-gold/20 bg-ink/30 px-4 py-3 text-left transition-colors hover:border-crimson/60 hover:bg-crimson/5">
        <span className="flex w-8 shrink-0 justify-center text-2xl" aria-hidden="true">🚪</span>
        <span className="min-w-0 flex-1 text-sm font-semibold text-crimson">{t('game.leaveSeat')}</span>
      </button>
      <EarlyAssassinationProposal open={confirm === 'assassination'} game={game} myPlayerId={myPlayerId}
        busy={action.busy} error={action.error} onClose={() => setConfirm(null)} onConfirm={() => void startAssassination()} />
      <TableSheet open={confirm === 'leave'} title={t(willDissolve ? 'common.dissolveRoomTitle' : 'game.leaveSeat')}
        onClose={() => setConfirm(null)} busy={action.busy} error={action.error}>
        <div className="space-y-4">
          <p className="text-sm text-parchment/80">{t(willDissolve ? 'common.confirmDissolveRoom' : 'game.confirmLeave')}</p>
          <div className="flex gap-2">
            <Button variant="ghost" autoFocus disabled={action.busy} onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" disabled={action.busy} onClick={() => void leave()}>
              {t(willDissolve ? 'common.confirmDissolve' : 'game.leaveSeat')}
            </Button>
          </div>
        </div>
      </TableSheet>
    </div>
  );
}
