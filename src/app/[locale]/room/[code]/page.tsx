'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { RoomHeader } from '@/components/lobby/RoomHeader';
import { ConfigPanel } from '@/components/lobby/ConfigPanel';
import { SeatPicker } from '@/components/lobby/SeatPicker';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { Button } from '@/components/ui/Button';
import { useRoomConnection, roomActions } from '@/lib/socket/client';
import { useRoomStore } from '@/lib/store/room';
import type { RoomConfig } from '@/lib/socket/types';

export default function LobbyPage() {
  const t = useTranslations();
  const params = useParams<{ code: string }>();
  const code = (params.code ?? '').toUpperCase();
  const router = useRouter();

  useRoomConnection(code);

  const conn = useRoomStore((s) => s.conn);
  const snapshot = useRoomStore((s) => s.snapshot);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const isHost = useRoomStore((s) => s.isHost);
  const notice = useRoomStore((s) => s.notice);
  const selfLatency = useRoomStore((s) => s.selfLatency);
  const [actionError, setActionError] = useState<string | null>(null);

  const seatedCount = snapshot?.members.filter((m) => !m.isSpectator).length ?? 0;
  const claimedCount = snapshot?.members.filter((m) => !m.isSpectator && m.claimed).length ?? 0;
  const canStart = seatedCount >= 5 && seatedCount <= 10;

  // Redirect into the game once it starts.
  useEffect(() => {
    if (snapshot?.status === 'in_game' || snapshot?.status === 'finished') {
      router.replace(`/game/${code}`);
    }
  }, [snapshot?.status, code, router]);

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


  async function handleClaim(seatId: string) {
    setActionError(null);
    const res = await roomActions.claimSeat(seatId);
    if (res.ok && res.data) {
      useRoomStore.getState().setMyPlayerId(res.data.playerId);
      const { useSessionStore } = await import('@/lib/store/session');
      useSessionStore.getState().setSession(code, { playerId: res.data.playerId });
    } else if (res.error) {
      setActionError(res.error.message);
    }
  }

  async function handleStand() {
    setActionError(null);
    const res = await roomActions.releaseSeat();
    if (res.ok) {
      useRoomStore.getState().setMyPlayerId(null);
      const { useSessionStore } = await import('@/lib/store/session');
      useSessionStore.getState().setSession(code, { playerId: undefined });
    } else if (res.error) {
      setActionError(res.error.message);
    }
  }

  async function handleKick(id: string) {
    setActionError(null);
    return roomActions.kick(id);
  }

  async function handleRosterChange(names: string[]) {
    setActionError(null);
    return roomActions.setRoster(names);
  }

  if (!snapshot) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="animate-pulse text-parchment/60">
          {conn === 'disconnected' ? t('common.reconnecting') : t('lobby.enteringHall')}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex justify-end">
        <LocaleSwitcher />
      </div>
      <RoomHeader
        code={code}
        status={snapshot.status}
        connected={conn === 'connected'}
        latency={selfLatency}
      />

      {(notice?.type === 'join_error' || actionError) && (
        <div className="rounded-lg border border-crimson/50 bg-crimson/20 px-4 py-2 text-sm text-parchment">
          {actionError ?? notice?.message}
        </div>
      )}

      <SeatPicker
        members={snapshot.members}
        hostPlayerId={snapshot.hostPlayerId}
        myPlayerId={myPlayerId}
        isHost={isHost}
        onClaim={handleClaim}
        onStand={handleStand}
        onKick={handleKick}
        onRosterChange={handleRosterChange}
      />

      <ConfigPanel
        config={snapshot.config}
        seatedCount={seatedCount}
        isHost={isHost}
        onChange={handleConfig}
      />

      {isHost ? (
        <div className="space-y-1.5">
          <Button className="w-full py-3 text-base" onClick={handleStart} disabled={!canStart}>
            {canStart ? t('lobby.beginQuest') : t('lobby.needSeats', { count: seatedCount })}
          </Button>
          {canStart && claimedCount < seatedCount && (
            <p className="text-center text-xs text-amber-400">
              {t('lobby.startWithEmpty', { empty: seatedCount - claimedCount })}
            </p>
          )}
        </div>
      ) : (
        <p className="text-center text-sm text-parchment/50">{t('lobby.waitingHost')}</p>
      )}

      <button
        className="mx-auto block text-xs text-parchment/40 hover:text-parchment/70"
        onClick={async () => {
          await roomActions.leave();
          router.push('/');
        }}
      >
        {t('common.leave')}
      </button>
    </main>
  );
}
