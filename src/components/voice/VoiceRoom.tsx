import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type RealtimeKitClient from '@cloudflare/realtimekit';
import { useLocation } from 'react-router-dom';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/Button';
import { roomActions } from '@/lib/socket/client';
import { useRoomStore } from '@/lib/store/room';

const VoiceSession = lazy(() => import('./VoiceSession'));

export function VoiceRoom() {
  const t = useTranslations();
  const location = useLocation();
  const conn = useRoomStore((state) => state.conn);
  const snapshot = useRoomStore((state) => state.snapshot);
  const roomCode = useRoomStore((state) => state.roomCode);
  const playerId = useRoomStore((state) => state.myPlayerId);
  const code = snapshot?.code === roomCode ? roomCode : null;
  const onRoomRoute = code ? isRoomRoute(location.pathname, code) : false;
  const enabled = Boolean(onRoomRoute && snapshot?.config.voiceEnabled);
  const eligibleKey = enabled && playerId ? `${code}:${playerId}` : null;

  const [meeting, setMeeting] = useState<RealtimeKitClient>();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meetingRef = useRef<RealtimeKitClient | undefined>(undefined);
  const activeKeyRef = useRef<string | null>(null);
  const eligibleKeyRef = useRef(eligibleKey);
  eligibleKeyRef.current = eligibleKey;

  const disconnect = useCallback(async () => {
    const current = meetingRef.current;
    meetingRef.current = undefined;
    activeKeyRef.current = null;
    setMeeting(undefined);
    setJoining(false);
    if (!current) return;
    try {
      if (current.self.audioEnabled) await current.self.disableAudio();
    } catch {
      // Leaving still tears down the SDK-owned track.
    }
    try {
      await current.leave();
    } catch {
      // The session may already have ended remotely.
    }
  }, []);

  useEffect(() => {
    if (activeKeyRef.current && activeKeyRef.current !== eligibleKey) {
      void disconnect();
    }
  }, [disconnect, eligibleKey]);

  useEffect(
    () => () => {
      const current = meetingRef.current;
      meetingRef.current = undefined;
      if (current) void current.leave();
    },
    [],
  );

  async function joinVoice() {
    if (!eligibleKey || joining || meetingRef.current) return;
    const attemptKey = eligibleKey;
    setJoining(true);
    setError(null);

    try {
      const token = await roomActions.voiceToken();
      if (!token.ok || !token.data?.authToken) throw new Error('token');

      const { default: Client } = await import('@cloudflare/realtimekit');
      const nextMeeting = await Client.init({
        authToken: token.data.authToken,
        defaults: { audio: false, video: false },
      });
      if (eligibleKeyRef.current !== attemptKey) {
        await nextMeeting.leave();
        return;
      }

      await nextMeeting.join();
      if (eligibleKeyRef.current !== attemptKey) {
        await nextMeeting.leave();
        return;
      }

      meetingRef.current = nextMeeting;
      activeKeyRef.current = attemptKey;
      setMeeting(nextMeeting);
    } catch {
      setError(t('voice.joinFailed'));
    } finally {
      setJoining(false);
    }
  }

  if (!enabled || !snapshot) return null;

  if (meeting) {
    return (
      <Suspense fallback={<VoiceStatusDock message={t('voice.joining')} />}>
        <VoiceSession
          meeting={meeting}
          members={snapshot.members}
          myPlayerId={playerId!}
          onLeave={() => void disconnect()}
        />
      </Suspense>
    );
  }

  return (
    <section className={dockClass} aria-label={t('voice.title')}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-serif text-sm font-semibold text-gold">🎙 {t('voice.title')}</p>
          <p className="truncate text-xs text-parchment/55" aria-live="polite">
            {!playerId
              ? t('voice.claimSeatFirst')
              : conn !== 'connected'
                ? t('voice.waitingForRoom')
                : t('voice.readyToJoin')}
          </p>
        </div>
        <Button
          className="h-11 shrink-0 px-5"
          disabled={!playerId || conn !== 'connected' || joining}
          onClick={() => void joinVoice()}
        >
          {joining ? t('voice.joining') : t('voice.join')}
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-crimson">{error}</p>}
    </section>
  );
}

function VoiceStatusDock({ message }: { message: string }) {
  const t = useTranslations();
  return (
    <section className={dockClass} aria-label={t('voice.title')}>
      <p className="animate-pulse text-center text-sm text-parchment/65">{message}</p>
    </section>
  );
}

function isRoomRoute(pathname: string, code: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  return (
    segments.length === 3 &&
    (segments[1] === 'room' || segments[1] === 'game') &&
    segments[2]?.toUpperCase() === code
  );
}

const dockClass =
  'fixed inset-x-0 bottom-0 z-[60] mx-auto w-full max-w-2xl border-t border-gold/30 bg-ink-deep/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-10px_35px_rgba(0,0,0,0.55)] backdrop-blur';
