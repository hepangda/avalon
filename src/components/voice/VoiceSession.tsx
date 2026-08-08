import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type RealtimeKitClient from '@cloudflare/realtimekit';
import {
  RealtimeKitProvider,
  useRealtimeKitMeeting,
  useRealtimeKitSelector,
} from '@cloudflare/realtimekit-react';
import {
  RtkAudioVisualizer,
  RtkParticipantsAudio,
} from '@cloudflare/realtimekit-react-ui';
import { useTranslations } from 'use-intl';
import { cn } from '@/lib/utils/cn';
import type { RoomMember } from '@/lib/socket/types';

interface VoiceSessionProps {
  meeting: RealtimeKitClient;
  members: RoomMember[];
  myPlayerId: string;
  onLeave: () => void;
}

export default function VoiceSession(props: VoiceSessionProps) {
  return (
    <RealtimeKitProvider value={props.meeting}>
      <VoiceDock {...props} />
    </RealtimeKitProvider>
  );
}

function VoiceDock({
  members,
  myPlayerId,
  onLeave,
}: Omit<VoiceSessionProps, 'meeting'> & { meeting: RealtimeKitClient }) {
  const t = useTranslations();
  const { meeting } = useRealtimeKitMeeting();
  const audioEnabled = useRealtimeKitSelector((state) => state.self.audioEnabled);
  const roomState = useRealtimeKitSelector((state) => state.self.roomState);
  const joinedParticipants = useRealtimeKitSelector((state) =>
    state.participants.joined.toArray(),
  );
  const activeParticipants = useRealtimeKitSelector((state) =>
    state.participants.active.toArray(),
  );

  const [latched, setLatched] = useState(false);
  const [pressing, setPressing] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const latchedRef = useRef(false);
  const pressingRef = useRef(false);
  const desiredAudioRef = useRef(false);
  const syncingRef = useRef(false);
  const pressSourceRef = useRef<
    { kind: 'pointer'; pointerId: number } | { kind: 'keyboard'; key: string } | null
  >(null);

  const syncMicrophone = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
      while (meeting.self.audioEnabled !== desiredAudioRef.current) {
        const desired = desiredAudioRef.current;
        if (desired) await meeting.self.enableAudio();
        else await meeting.self.disableAudio();
        if (desired === desiredAudioRef.current) break;
      }
    } catch {
      latchedRef.current = false;
      pressingRef.current = false;
      pressSourceRef.current = null;
      desiredAudioRef.current = false;
      setLatched(false);
      setPressing(false);
      setError(t('voice.micFailed'));
      try {
        if (meeting.self.audioEnabled) await meeting.self.disableAudio();
      } catch {
        // The SDK reports the actionable permission/device error to the user.
      }
    } finally {
      syncingRef.current = false;
      if (meeting.self.audioEnabled !== desiredAudioRef.current) {
        void syncMicrophone();
      }
    }
  }, [meeting, t]);

  const setDesiredAudio = useCallback(
    (enabled: boolean) => {
      desiredAudioRef.current = enabled;
      setError(null);
      void syncMicrophone();
    },
    [syncMicrophone],
  );

  const closeMicrophone = useCallback(() => {
    latchedRef.current = false;
    pressingRef.current = false;
    pressSourceRef.current = null;
    setLatched(false);
    setPressing(false);
    setDesiredAudio(false);
  }, [setDesiredAudio]);

  const refreshDevices = useCallback(async () => {
    try {
      const nextDevices = await meeting.self.getAudioDevices();
      const current = meeting.self.getCurrentDevices().audio;
      setDevices(nextDevices);
      setSelectedDeviceId(current?.deviceId ?? nextDevices[0]?.deviceId ?? '');
    } catch {
      setDevices([]);
    }
  }, [meeting]);

  useEffect(() => {
    void refreshDevices();
    const refresh = () => void refreshDevices();
    meeting.self.on('deviceListUpdate', refresh);
    meeting.self.on('deviceUpdate', refresh);
    return () => {
      meeting.self.off('deviceListUpdate', refresh);
      meeting.self.off('deviceUpdate', refresh);
    };
  }, [meeting, refreshDevices]);

  useEffect(() => {
    if (audioEnabled) void refreshDevices();
  }, [audioEnabled, refreshDevices]);

  useEffect(() => {
    const release = () => closeMicrophone();
    const onVisibility = () => {
      if (document.hidden) release();
    };
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', onVisibility);
      desiredAudioRef.current = false;
      if (meeting.self.audioEnabled) void meeting.self.disableAudio();
    };
  }, [closeMicrophone, meeting]);

  useEffect(() => {
    if (roomState === 'left' || roomState === 'ended' || roomState === 'kicked') onLeave();
  }, [onLeave, roomState]);

  const remoteByPlayerId = useMemo(
    () =>
      new Map(
        joinedParticipants.flatMap((participant) =>
          participant.customParticipantId
            ? [[participant.customParticipantId, participant] as const]
            : [],
        ),
      ),
    [joinedParticipants],
  );
  const activePlayerIds = useMemo(
    () =>
      new Set(
        activeParticipants.flatMap((participant) =>
          participant.customParticipantId ? [participant.customParticipantId] : [],
        ),
      ),
    [activeParticipants],
  );
  const claimedMembers = members
    .filter((member) => !member.isSpectator && member.claimed)
    .sort((a, b) => a.seat - b.seat);

  function beginPushToTalk() {
    if (latchedRef.current || pressingRef.current) return;
    pressingRef.current = true;
    setPressing(true);
    setDesiredAudio(true);
  }

  function endPushToTalk() {
    if (!pressingRef.current) return;
    pressingRef.current = false;
    setPressing(false);
    setDesiredAudio(latchedRef.current);
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || latchedRef.current || pressingRef.current || pressSourceRef.current)
      return;
    pressSourceRef.current = { kind: 'pointer', pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    beginPushToTalk();
  }

  function handlePointerEnd(event: PointerEvent<HTMLButtonElement>) {
    const source = pressSourceRef.current;
    if (source?.kind !== 'pointer' || source.pointerId !== event.pointerId) return;
    pressSourceRef.current = null;
    endPushToTalk();
  }

  function toggleLatched() {
    const next = !latchedRef.current;
    latchedRef.current = next;
    setLatched(next);
    setDesiredAudio(next || pressingRef.current);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (
      (event.key === ' ' || event.key === 'Enter') &&
      !event.repeat &&
      !pressSourceRef.current
    ) {
      event.preventDefault();
      pressSourceRef.current = { kind: 'keyboard', key: event.key };
      beginPushToTalk();
    }
  }

  function handleKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (
      (event.key === ' ' || event.key === 'Enter') &&
      pressSourceRef.current?.kind === 'keyboard' &&
      pressSourceRef.current.key === event.key
    ) {
      event.preventDefault();
      pressSourceRef.current = null;
      endPushToTalk();
    }
  }

  async function switchDevice(deviceId: string) {
    const device = devices.find((candidate) => candidate.deviceId === deviceId);
    if (!device) return;
    setError(null);
    try {
      await meeting.self.setDevice(device);
      setSelectedDeviceId(deviceId);
    } catch {
      setError(t('voice.deviceFailed'));
    }
  }

  return (
    <section
      className="fixed inset-x-0 bottom-0 z-[60] mx-auto w-full max-w-2xl border-t border-gold/30 bg-ink-deep/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-10px_35px_rgba(0,0,0,0.55)] backdrop-blur"
      aria-label={t('voice.title')}
    >
      <RtkParticipantsAudio meeting={meeting} />

      <div className="mb-1 flex items-center justify-between">
        <p className="font-serif text-sm font-semibold text-gold">🎙 {t('voice.connected')}</p>
        <button
          type="button"
          onClick={onLeave}
          className="rounded px-2 py-1 text-xs text-parchment/50 hover:text-crimson"
        >
          {t('voice.leave')}
        </button>
      </div>

      <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1" aria-label={t('voice.participants')}>
        {claimedMembers.map((member) => {
          const isSelf = member.id === myPlayerId;
          const participant = isSelf ? meeting.self : remoteByPlayerId.get(member.id);
          const micOn = isSelf ? audioEnabled : Boolean(participant?.audioEnabled);
          const speaking = isSelf
            ? micOn && pressing
            : Boolean(participant && activePlayerIds.has(member.id));
          return (
            <div
              key={member.id}
              className={cn(
                'flex min-w-fit items-center gap-1.5 rounded-full border px-2 py-1 text-[11px]',
                speaking
                  ? 'border-emerald-400 bg-emerald-500/15 text-emerald-200'
                  : micOn
                    ? 'border-gold/45 bg-gold/10 text-parchment'
                    : 'border-gold/15 bg-ink/50 text-parchment/55',
              )}
            >
              {participant ? (
                <RtkAudioVisualizer
                  participant={participant}
                  size="sm"
                  hideMuted={false}
                  className="h-4 w-4"
                />
              ) : (
                <span aria-hidden="true">○</span>
              )}
              <span className="max-w-24 truncate">{member.name}</span>
              <span
                title={micOn ? t('voice.micOn') : t('voice.micOff')}
                aria-label={micOn ? t('voice.micOn') : t('voice.micOff')}
              >
                {micOn ? '🎙' : '🔇'}
              </span>
              {speaking && <span className="font-semibold">{t('voice.speaking')}</span>}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <label className="min-w-0">
          <span className="sr-only">{t('voice.chooseMic')}</span>
          <select
            className="h-10 w-full rounded-lg border border-gold/25 bg-ink px-2 text-xs text-parchment outline-none focus:border-gold"
            value={selectedDeviceId}
            onChange={(event) => void switchDevice(event.target.value)}
            disabled={devices.length === 0}
          >
            {devices.length === 0 && <option value="">{t('voice.defaultMic')}</option>}
            {devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || t('voice.microphoneNumber', { number: index + 1 })}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-pressed={latched}
          onClick={toggleLatched}
          className={cn(
            'h-10 rounded-lg border px-3 text-xs font-semibold',
            latched
              ? 'border-crimson/70 bg-crimson/20 text-crimson-bright'
              : 'border-gold/35 bg-stone/50 text-parchment',
          )}
        >
          {latched ? t('voice.closeMic') : t('voice.openMic')}
        </button>
      </div>

      <button
        type="button"
        aria-pressed={pressing}
        disabled={latched}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={handlePointerEnd}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onContextMenu={(event) => event.preventDefault()}
        className={cn(
          'mt-2 h-14 w-full touch-none select-none rounded-xl border-2 text-base font-bold transition',
          pressing
            ? 'scale-[0.99] border-emerald-300 bg-emerald-600 text-white shadow-[0_0_24px_rgba(16,185,129,0.35)]'
            : latched
              ? 'cursor-not-allowed border-crimson/40 bg-crimson/15 text-crimson-bright'
              : 'border-gold/70 bg-gold/20 text-gold active:scale-[0.99] active:bg-gold/35',
        )}
      >
        {pressing
          ? t('voice.releaseToMute')
          : latched
            ? t('voice.micIsOpen')
            : t('voice.holdToTalk')}
      </button>
      {error && (
        <p className="mt-1 text-center text-xs text-crimson" aria-live="polite">
          {error}
        </p>
      )}
    </section>
  );
}
