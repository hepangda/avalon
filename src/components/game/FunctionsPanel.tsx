import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { gameActions, roomActions } from '@/lib/socket/client';
import { useRoomStore } from '@/lib/store/room';
import { useSessionStore } from '@/lib/store/session';
import { useRoomAction } from '@/lib/game/useRoomAction';
import type { ClientGameState } from '@/lib/engine';
import { AdminPanel } from './AdminPanel';
import { GameIcon } from './GameArt';
import { TableSheet } from './TableSheet';

/** Actions outside the normal turn; confirmations share the native modal boundary. */
export function FunctionsPanel({ code, game, onAssassinationStarted }: {
  code: string; game: ClientGameState; onAssassinationStarted: () => void;
}) {
  const t = useTranslations();
  const router = useRouter();
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
        <button type="button" disabled={action.busy} onClick={() => setConfirm('assassination')}
          className="flex w-full items-center gap-3 rounded-lg border border-crimson/40 bg-ink/30 px-4 py-3 text-left transition-colors hover:border-crimson hover:bg-crimson/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 disabled:opacity-50">
          <GameIcon name="assassinate" className="h-8 w-8" />
          <span className="min-w-0 flex-1 text-sm font-semibold text-parchment">{t('assassin.startEarly')}</span>
        </button>
      )}
      {!game.isSpectator && <AdminPanel game={game} />}
      <button type="button" onClick={() => setConfirm('leave')}
        className="flex w-full items-center gap-3 rounded-lg border border-gold/20 bg-ink/30 px-4 py-3 text-left transition-colors hover:border-crimson/60 hover:bg-crimson/5">
        <span className="flex w-8 shrink-0 justify-center text-2xl" aria-hidden="true">🚪</span>
        <span className="min-w-0 flex-1 text-sm font-semibold text-crimson">{t('game.leaveSeat')}</span>
      </button>
      <TableSheet open={confirm !== null} title={t(confirm === 'assassination' ? 'assassin.startEarly' : 'game.leaveSeat')}
        onClose={() => setConfirm(null)} busy={action.busy} error={action.error}>
        <div className="space-y-4">
          {confirm === 'assassination' ? (
            <div className="space-y-3 text-sm text-parchment/80">
              <p>{t('assassin.earlyConsequences')}</p><p>{t('assassin.earlyOutcome')}</p>
              <p className="font-semibold text-parchment">{t('assassin.irreversible')}</p>
            </div>
          ) : <p className="text-sm text-parchment/80">{t('game.confirmLeave')}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" autoFocus disabled={action.busy} onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" disabled={action.busy} onClick={() => void (confirm === 'assassination' ? startAssassination() : leave())}>
              {t(confirm === 'assassination' ? (action.busy ? 'assassin.starting' : 'assassin.confirmStart') : 'game.leaveSeat')}
            </Button>
          </div>
        </div>
      </TableSheet>
    </div>
  );
}
