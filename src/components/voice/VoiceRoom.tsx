import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type RealtimeKitClient from '@cloudflare/realtimekit';
import { useLocation } from 'react-router-dom';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/Button';
import { roomActions } from '@/lib/socket/client';
import type { VoicePresenceStatus } from '@/lib/engine';
import { useRoomStore } from '@/lib/store/room';
import { voiceOverlayClass } from './styles';

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
  const [dockTarget, setDockTarget] = useState<HTMLElement | null>(null);
  const meetingRef = useRef<RealtimeKitClient | undefined>(undefined);
  const activeKeyRef = useRef<string | null>(null);
  const eligibleKeyRef = useRef(eligibleKey);
  const mountedRef = useRef(true);
  const joinAttemptRef = useRef(0);
  eligibleKeyRef.current = eligibleKey;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setDockTarget(document.getElementById('voice-dock-slot'));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname, snapshot?.status]);

  const disconnect = useCallback(
    async (status: Exclude<VoicePresenceStatus, 'joined'> = 'left') => {
      joinAttemptRef.current += 1;
      const current = meetingRef.current;
      meetingRef.current = undefined;
      activeKeyRef.current = null;
      if (mountedRef.current) {
        setMeeting(undefined);
        setJoining(false);
      }
      if (!current) return;
      try {
        if (current.self.audioEnabled) await current.self.disableAudio();
      } catch {
        // Leaving still tears down the SDK-owned track.
      }
      await Promise.race([
        roomActions.voicePresence(status),
        new Promise((resolve) => window.setTimeout(resolve, 800)),
      ]);
      try {
        await current.leave();
      } catch {
        // The session may already have ended remotely.
      }
    },
    [],
  );

  useEffect(() => {
    if (activeKeyRef.current && activeKeyRef.current !== eligibleKey) {
      void disconnect();
    }
  }, [disconnect, eligibleKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      joinAttemptRef.current += 1;
      const current = meetingRef.current;
      meetingRef.current = undefined;
      activeKeyRef.current = null;
      if (current) void current.leave();
    };
  }, []);

  async function joinVoice() {
    if (!eligibleKey || joining || meetingRef.current) return;
    const attemptKey = eligibleKey;
    const attemptId = ++joinAttemptRef.current;
    const isCurrentAttempt = () =>
      mountedRef.current &&
      joinAttemptRef.current === attemptId &&
      eligibleKeyRef.current === attemptKey;
    activeKeyRef.current = attemptKey;
    setJoining(true);
    setError(null);

    let nextMeeting: RealtimeKitClient | undefined;
    try {
      const microphoneFailure = await requestMicrophonePermission();
      if (microphoneFailure) {
        if (isCurrentAttempt()) {
          activeKeyRef.current = null;
          setError(
            microphoneFailure === 'insecure'
              ? t('voice.micHttpsRequired')
              : microphoneFailure === 'denied'
                ? t('voice.micPermissionDenied')
                : microphoneFailure === 'unsupported'
                  ? t('voice.micUnsupported')
                  : t('voice.micUnavailable'),
          );
        }
        return;
      }
      if (!isCurrentAttempt()) return;

      const token = await roomActions.voiceToken();
      if (!token.ok || !token.data?.authToken) throw new Error('token');
      if (!isCurrentAttempt()) return;

      const { default: Client } = await import('@cloudflare/realtimekit');
      if (!isCurrentAttempt()) return;
      nextMeeting = await Client.init({
        authToken: token.data.authToken,
        defaults: { audio: false, video: false },
      });
      if (!isCurrentAttempt()) {
        await nextMeeting.leave();
        return;
      }
      meetingRef.current = nextMeeting;
      activeKeyRef.current = attemptKey;

      await nextMeeting.join();
      if (!isCurrentAttempt() || meetingRef.current !== nextMeeting) {
        await nextMeeting.leave();
        return;
      }

      await roomActions.voicePresence('joined');
      setMeeting(nextMeeting);
    } catch {
      if (nextMeeting && meetingRef.current === nextMeeting) {
        meetingRef.current = undefined;
        activeKeyRef.current = null;
      }
      if (nextMeeting) {
        try {
          await nextMeeting.leave();
        } catch {
          // Initialization may fail before a room is fully joined.
        }
      }
      if (isCurrentAttempt()) {
        activeKeyRef.current = null;
        setError(t('voice.joinFailed'));
      }
    } finally {
      if (isCurrentAttempt()) setJoining(false);
    }
  }

  if (!enabled || !snapshot) return null;

  const integrated = Boolean(dockTarget);
  let control: ReactNode;

  if (meeting) {
    control = (
      <Suspense fallback={<VoiceStatusDock message={t('voice.joining')} integrated={integrated} />}>
        <VoiceSession
          meeting={meeting}
          members={snapshot.members}
          myPlayerId={playerId!}
          integrated={integrated}
          onLeave={(status) => void disconnect(status)}
          onReconnect={() => void roomActions.voicePresence('joined')}
          onParticipantDropped={(droppedPlayerId) =>
            void roomActions.voiceDropped(droppedPlayerId)
          }
        />
      </Suspense>
    );
  } else {
    const status = !playerId
      ? t('voice.claimSeatFirst')
      : conn !== 'connected'
        ? t('voice.waitingForRoom')
        : t('voice.readyToJoin');

    control = integrated ? (
      <section className="relative flex h-full shrink-0" aria-label={t('voice.title')}>
        <button
          type="button"
          className="panel flex w-11 shrink-0 items-center justify-center gap-1.5 px-0 py-2 text-sm text-parchment transition hover:border-emerald-400/50 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:px-3"
          disabled={!playerId || conn !== 'connected' || joining}
          onClick={() => void joinVoice()}
          title={status}
        >
          <span className={joining ? 'animate-pulse' : ''} aria-hidden="true">
            🎙
          </span>
          <span className="hidden whitespace-nowrap sm:inline">
            {joining ? t('voice.joining') : t('voice.join')}
          </span>
        </button>
        <span className="sr-only" aria-live="polite">
          {status}
        </span>
        {error && (
          <p className="absolute right-0 bottom-[calc(100%+0.5rem)] z-50 w-64 rounded-lg border border-crimson/40 bg-ink-deep/95 p-2 text-xs text-crimson shadow-xl">
            {error}
          </p>
        )}
      </section>
    ) : (
      <section className={voiceOverlayClass} aria-label={t('voice.title')}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-serif text-sm font-semibold text-gold">🎙 {t('voice.title')}</p>
            <p className="truncate text-xs text-parchment/55" aria-live="polite">
              {status}
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

  return dockTarget ? createPortal(control, dockTarget) : control;
}

type MicrophonePermissionFailure = 'insecure' | 'unsupported' | 'denied' | 'unavailable';

async function requestMicrophonePermission(): Promise<MicrophonePermissionFailure | null> {
  if (!window.isSecureContext) return 'insecure';
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';

  try {
    // Run this before any network await so iOS associates its prompt with the tap.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    for (const track of stream.getTracks()) track.stop();
    return null;
  } catch (error) {
    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'denied';
    }
    return 'unavailable';
  }
}

function VoiceStatusDock({ message, integrated }: { message: string; integrated: boolean }) {
  const t = useTranslations();
  if (integrated) {
    return (
      <div
        className="panel flex w-11 shrink-0 items-center justify-center px-0 py-2 text-sm text-parchment/55 sm:w-auto sm:px-3"
        aria-label={t('voice.title')}
        title={message}
      >
        <span className="animate-pulse" aria-hidden="true">
          🎙
        </span>
        <span className="sr-only">{message}</span>
      </div>
    );
  }
  return (
    <section className={voiceOverlayClass} aria-label={t('voice.title')}>
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
