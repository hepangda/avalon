import { useTranslations } from 'use-intl';
import { TableSheet } from '@/components/game/TableSheet';
import { Button } from '@/components/ui/Button';
import { useRoomAction } from '@/lib/game/useRoomAction';
import { wouldDissolveRoom } from '@/lib/game/roomDissolution';
import { useRouter } from '@/i18n/navigation';
import { useAuthIdentity } from '@/lib/auth/useAuthIdentity';
import {
roomActions
} from '@/lib/socket/client';
import { useRoomStore } from '@/lib/store/room';
import { useSceneGate } from '@/lib/store/sceneGate';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { GameView } from '@/components/game/GameView';

export default function GamePage() {
  const t = useTranslations();
  const [confirmRestart, setConfirmRestart] = useState(false);
  const code = useParams().code ?? '';
  const { refresh } = useAuthIdentity();
  const router = useRouter();
  const {
    snapshot,
    isHost,
    conn,
    game: rawGame,
    roomCode,
    myPlayerId,
    selfLatency,
    syncing,
    recoveryRevision,
    notice,
  } = useRoomStore();
  const restart = useRoomAction(`${code}:restart`, t('table.actionFailed'));
  const game = roomCode === code ? rawGame : null;
  useEffect(() => { if (game?.phase === 'GameOver') void refresh(); }, [game?.gameId, game?.phase, refresh]);
  const ready = !!game || notice?.type === 'join_error';
  useEffect(() => { if (ready) useSceneGate.getState().arrive(code); }, [ready, code]);
  useEffect(() => {
    if (snapshot?.code === code && snapshot.status === 'lobby')
      router.replace(`/room/${code}`);
  }, [code, router, snapshot?.code, snapshot?.status]);
  async function requestRestart() {
    if (snapshot && wouldDissolveRoom({ ...snapshot, status: 'lobby' }, null)) {
      restart.clearError();
      setConfirmRestart(true);
      return { ok: true };
    }
    return roomActions.restart();
  }
  return <><GameView key={`${code}-${recoveryRevision}`} code={code} game={game} isHost={isHost} conn={syncing && conn === 'connected' ? 'connecting' : conn}
    myPlayerId={myPlayerId}
    selfLatency={selfLatency} notice={notice}
    onRestart={requestRestart}
    onDismissNotice={() => useRoomStore.getState().setNotice(null)} />
    <TableSheet open={confirmRestart} title={t('common.dissolveRoomTitle')}
      onClose={() => setConfirmRestart(false)} busy={restart.busy} error={restart.error}>
      <div className="space-y-4">
        <p className="text-sm text-parchment/80">{t('common.confirmDissolveRoom')}</p>
        <div className="flex gap-2">
          <Button variant="ghost" autoFocus disabled={restart.busy} onClick={() => setConfirmRestart(false)}>{t('common.cancel')}</Button>
          <Button variant="danger" disabled={restart.busy || conn !== 'connected' || syncing} onClick={async () => {
            if (await restart.run(roomActions.restart)) setConfirmRestart(false);
          }}>{t('common.confirmDissolve')}</Button>
        </div>
      </div>
    </TableSheet>
  </>;

}
