import { useRouter } from '@/i18n/navigation';
import { useAuthIdentity } from '@/lib/auth/useAuthIdentity';
import {
useRoomConnection
} from '@/lib/socket/client';
import { useRoomStore } from '@/lib/store/room';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';

import { GameView } from '@/components/game/GameView';

export default function GamePage() {
  const code = useParams().code ?? '';
  const { refresh } = useAuthIdentity();
  const router = useRouter();
  useRoomConnection(code);
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
  const game = roomCode === code ? rawGame : null;
  useEffect(() => { if (game?.phase === 'GameOver') void refresh(); }, [game?.gameId, game?.phase, refresh]);
  useEffect(() => {
    if (snapshot?.code === code && snapshot.status === 'lobby')
      router.replace(`/room/${code}`);
  }, [code, router, snapshot?.code, snapshot?.status]);
  return <GameView key={`${code}-${recoveryRevision}`} code={code} game={game} isHost={isHost} conn={syncing && conn === 'connected' ? 'connecting' : conn}
    myPlayerId={myPlayerId}
    selfLatency={selfLatency} notice={notice}
    onDismissNotice={() => useRoomStore.getState().setNotice(null)} />;
}
