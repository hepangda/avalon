import { ReconnectOverlay } from '@/components/ui/ReconnectOverlay';
import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { useRouter } from '@/i18n/navigation';
import { RoomHeader } from '@/components/lobby/RoomHeader';
import { ConfigPanel } from '@/components/lobby/ConfigPanel';
import { SeatPicker } from '@/components/lobby/SeatPicker';
import { PreferencesButton } from '@/components/PreferencesButton';
import { Button } from '@/components/ui/Button';
import { useRoomConnection, roomActions } from '@/lib/socket/client';
import { useRoomStore } from '@/lib/store/room';
import { useSessionStore } from '@/lib/store/session';
import { useAuthIdentity } from '@/lib/auth/useAuthIdentity';
import { accountDisplayName } from '@/lib/auth/types';
import type { RoomConfig } from '@/lib/socket/types';

export default function LobbyPage() {
  const t = useTranslations();
  const params = useParams();
  const code = params.code ?? '';
  const router = useRouter();

  useRoomConnection(code);

  const conn = useRoomStore((s) => s.syncing && s.conn === 'connected' ? 'connecting' : s.conn);
  const snapshot = useRoomStore((s) => s.snapshot);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const isHost = useRoomStore((s) => s.isHost);
  const notice = useRoomStore((s) => s.notice);
  const selfLatency = useRoomStore((s) => s.selfLatency);
  const { user } = useAuthIdentity();
  const identityName = user ? accountDisplayName(user) : '';
  const identityAvatarUrl = user?.picture;
  const [actionError, setActionError] = useState<string | null>(null);

  const seatedCount = snapshot?.members.filter((m) => !m.isSpectator && m.claimed).length ?? 0;
  const canStart = seatedCount >= 5 && seatedCount <= 10;

  // Redirect into the game once it starts. Guard on the snapshot's own code:
  // the room store is a global singleton that can briefly still hold a previous
  // room's snapshot right after navigation, and acting on its stale 'finished'
  // status would wrongly bounce us into that old game's end screen.
  useEffect(() => {
    if (snapshot?.code !== code) return;
    if (snapshot.status === 'in_game' || snapshot.status === 'finished') {
      router.replace(`/game/${code}`);
    }
  }, [snapshot?.code, snapshot?.status, code, router]);

  useEffect(() => {
    if (!myPlayerId || !identityName.trim() || conn !== 'connected') return;
    let active = true;
    void roomActions.rename(identityName).then((result) => {
      if (active && !result.ok && result.error) setActionError(result.error.message);
    });
    return () => {
      active = false;
    };
  }, [conn, identityName, myPlayerId]);

  async function handleConfig(config: RoomConfig) {
    setActionError(null);
    const res = await roomActions.config(config);
    if (!res.ok && res.error) setActionError(res.error.message);
  }

  async function handleStart() {
    setActionError(null);
    const res = await roomActions.start();
    if (!res.ok && res.error) setActionError(res.error.message);
  }

  async function handleLeave() {
    await roomActions.leave();
    router.push('/');
  }

  async function handleClaim() {
    if (!user) return;
    setActionError(null);
    const res = await roomActions.claimSeat(undefined, identityName, identityAvatarUrl);
    if (res.ok && res.data) {
      useSessionStore.getState().setSession(code, {
        playerId: res.data.playerId,
        playerToken: res.data.playerToken,
      });
    } else if (res.error) {
      setActionError(res.error.message);
    }
  }

  async function handleStand() {
    setActionError(null);
    const res = await roomActions.releaseSeat();
    if (res.ok) {
      useSessionStore
        .getState()
        .setSession(code, { playerId: undefined, playerToken: undefined });
    } else if (res.error) {
      setActionError(res.error.message);
    }
  }

  async function handleKick(id: string) {
    setActionError(null);
    return roomActions.kick(id);
  }

  if (!snapshot || snapshot.code !== code) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="animate-pulse text-parchment/60">
          {notice?.type === 'session_replaced' ? t('common.sessionReplaced') : conn === 'disconnected' ? t('common.reconnecting') : t('lobby.enteringHall')}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <ReconnectOverlay active={conn !== 'connected' && notice?.type !== 'session_replaced' && notice?.type !== 'join_error'} />
      <div className="flex items-center justify-between gap-4">
        <button
          className="inline-flex min-h-10 items-center gap-2 text-sm text-parchment/60 transition-colors hover:text-parchment"
          onClick={() => void handleLeave()}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="m12 5-7 7 7 7M5 12h14" />
          </svg>
          {t('common.leave')}
        </button>
        <PreferencesButton />
      </div>
      <RoomHeader
        code={code}
        connected={conn === 'connected'}
        latency={selfLatency}
      />

      {(notice?.type === 'join_error' || notice?.type === 'session_replaced' || actionError) && (
        <div className="rounded-lg border border-crimson/50 bg-crimson/20 px-4 py-2 text-sm text-parchment">
          {notice?.type === 'session_replaced' ? t('common.sessionReplaced') : actionError ?? notice?.message}
        </div>
      )}

      <SeatPicker
        members={snapshot.members}
        hostPlayerId={snapshot.hostPlayerId}
        myPlayerId={myPlayerId}
        isHost={isHost}
        disabled={conn !== 'connected'}
        onClaim={handleClaim}
        onStand={handleStand}
        onKick={handleKick}
        onAddBot={roomActions.addBot}
      />

      <ConfigPanel
        config={snapshot.config}
        seatedCount={seatedCount}
        isHost={isHost}
        onChange={handleConfig}
      />

      {isHost ? (
        <div className="space-y-1.5">
          <Button className="w-full py-3 text-base" onClick={handleStart} disabled={!canStart || conn !== 'connected'}>
            {canStart ? t('lobby.beginQuest') : t('lobby.needPlayers', { count: seatedCount })}
          </Button>
        </div>
      ) : (
        <p className="text-center text-sm text-parchment/50">{t('lobby.waitingHost')}</p>
      )}

    </main>
  );
}
