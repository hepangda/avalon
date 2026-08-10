import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
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
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslations } from 'use-intl';
import {
  announceBottomDockView,
  BOTTOM_DOCK_VIEW_EVENT,
  type BottomDockView,
} from '@/components/ui/bottomDock';
import { cn } from '@/lib/utils/cn';
import type { RoomMember } from '@/lib/socket/types';
import { voiceOverlayClass } from './styles';

interface VoiceSessionProps {
  meeting: RealtimeKitClient;
  members: RoomMember[];
  myPlayerId: string;
  integrated: boolean;
  onLeave: (status: 'left' | 'dropped') => void;
  onReconnect: () => void;
  onParticipantDropped: (playerId: string) => void;
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
  onReconnect,
  onParticipantDropped,
  integrated,
}: Omit<VoiceSessionProps, 'meeting'> & { meeting: RealtimeKitClient }) {
  const t = useTranslations();
  const { meeting } = useRealtimeKitMeeting();
  const audioEnabled = useRealtimeKitSelector((state) => state.self.audioEnabled);
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
  const [expanded, setExpanded] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const latchedRef = useRef(false);
  const pressingRef = useRef(false);
  const desiredAudioRef = useRef(false);
  const syncingRef = useRef(false);
  const pressSourceRef = useRef<
    { kind: 'pointer'; pointerId: number } | { kind: 'keyboard'; key: string } | null
  >(null);

  useEffect(() => setPortalReady(true), []);

  useEffect(() => {
    const closeForAnotherView = (event: Event) => {
      if ((event as CustomEvent<BottomDockView>).detail !== 'voice') setExpanded(false);
    };
    window.addEventListener(BOTTOM_DOCK_VIEW_EVENT, closeForAnotherView);
    return () => window.removeEventListener(BOTTOM_DOCK_VIEW_EVENT, closeForAnotherView);
  }, []);

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
    const handleRoomJoined = ({ reconnected }: { reconnected: boolean }) => {
      if (reconnected) onReconnect();
    };
    const handleRoomLeft = ({ state }: { state: string }) => {
      onLeave(state === 'left' ? 'left' : 'dropped');
    };
    meeting.self.on('roomJoined', handleRoomJoined);
    meeting.self.on('roomLeft', handleRoomLeft);
    return () => {
      meeting.self.off('roomJoined', handleRoomJoined);
      meeting.self.off('roomLeft', handleRoomLeft);
    };
  }, [meeting, onLeave, onReconnect]);

  useEffect(() => {
    const joined = meeting.participants.joined;
    const handleParticipantLeft = (participant: { customParticipantId?: string }) => {
      if (participant.customParticipantId) onParticipantDropped(participant.customParticipantId);
    };
    joined.on('participantLeft', handleParticipantLeft);
    return () => {
      joined.off('participantLeft', handleParticipantLeft);
    };
  }, [meeting, onParticipantDropped]);

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

  function toggleDetails() {
    setExpanded((current) => {
      const next = !current;
      if (next) announceBottomDockView('voice');
      return next;
    });
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

  const participantStrip = (
    <div
      className="flex gap-1.5 overflow-x-auto border-y border-gold/10 py-2"
      aria-label={t('voice.participants')}
    >
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
  );

  const deviceSelector = (
    <label className="block min-w-0">
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
  );

  const microphoneControls = (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
      <button
        type="button"
        aria-pressed={latched}
        onClick={toggleLatched}
        className={cn(
          'h-12 rounded-xl border px-3 text-xs font-semibold',
          latched
            ? 'border-crimson/70 bg-crimson/20 text-crimson-bright'
            : 'border-gold/35 bg-stone/50 text-parchment',
        )}
      >
        {latched ? t('voice.closeMic') : t('voice.openMic')}
      </button>
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
          'h-12 min-w-0 touch-none select-none rounded-xl border-2 px-2 text-sm font-bold transition',
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
    </div>
  );

  if (integrated) {
    const sheet = (
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="voice-sheet"
            className="fixed inset-0 z-40 flex items-end justify-center px-3 pt-3 pb-[4.5rem]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0" onClick={() => setExpanded(false)} />
            <motion.section
              className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-gold/30 bg-ink/90 shadow-2xl shadow-black/60 backdrop-blur-md"
              aria-label={t('voice.title')}
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            >
              <div className="flex h-11 items-center gap-2 border-b border-gold/15 px-4">
                <span className="relative grid h-7 w-7 place-items-center rounded-full border border-emerald-400/35 bg-emerald-500/10 text-sm">
                  {(pressing || latched) && (
                    <span className="absolute -inset-1 animate-pulse rounded-full border border-emerald-400/60" />
                  )}
                  <span aria-hidden="true">🎙</span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-serif text-sm font-semibold text-gold">
                    {t('voice.connected')}
                  </p>
                  <p className="text-[10px] text-parchment/45">
                    {t('voice.participantCount', { count: remoteByPlayerId.size + 1 })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onLeave('left')}
                  className="rounded px-1.5 py-1 text-xs text-parchment/45 hover:text-crimson focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson/60"
                >
                  {t('voice.leave')}
                </button>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="px-1 text-parchment/60 hover:text-parchment"
                  aria-label={t('mission.close')}
                >
                  ✕
                </button>
              </div>
              <div className="max-h-[60vh] space-y-3 overflow-y-auto p-3">
                {participantStrip}
                {deviceSelector}
                {microphoneControls}
                {error && (
                  <p className="text-center text-xs text-crimson" aria-live="polite">
                    {error}
                  </p>
                )}
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    );

    return (
      <>
        <section
          className="panel flex h-full shrink-0 items-stretch overflow-hidden p-0"
          aria-label={t('voice.title')}
        >
          <RtkParticipantsAudio meeting={meeting} />
          <button
            type="button"
            aria-pressed={pressing}
            aria-label={latched ? t('voice.micIsOpen') : t('voice.holdToTalk')}
            title={latched ? t('voice.micIsOpen') : t('voice.holdToTalk')}
            disabled={latched}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onLostPointerCapture={handlePointerEnd}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onContextMenu={(event) => event.preventDefault()}
            className={cn(
              'relative flex min-w-11 touch-none select-none items-center justify-center gap-1.5 px-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400/70 md:px-3',
              pressing
                ? 'bg-emerald-600 text-white'
                : latched
                  ? 'cursor-not-allowed bg-crimson/15 text-crimson-bright'
                  : 'text-emerald-200 hover:bg-emerald-500/10',
            )}
          >
            {(pressing || latched) && (
              <span className="absolute inset-1 animate-pulse rounded-md border border-emerald-400/50" />
            )}
            <span className="relative" aria-hidden="true">
              🎙
            </span>
            <span className="relative hidden whitespace-nowrap md:inline">
              {pressing
                ? t('voice.releaseToMute')
                : latched
                  ? t('voice.micIsOpen')
                  : t('voice.holdToTalk')}
            </span>
          </button>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={toggleDetails}
            className="grid w-7 place-items-center border-l border-gold/15 text-[10px] text-parchment/45 transition hover:bg-gold/5 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold/60"
            title={expanded ? t('voice.hideDetails') : t('voice.showDetails')}
          >
            <span aria-hidden="true">{expanded ? '⌄' : '⌃'}</span>
            <span className="sr-only">
              {expanded ? t('voice.hideDetails') : t('voice.showDetails')}
            </span>
          </button>
        </section>
        {portalReady ? createPortal(sheet, document.body) : null}
      </>
    );
  }

  return (
    <section className={voiceOverlayClass} aria-label={t('voice.title')}>
      <RtkParticipantsAudio meeting={meeting} />

      <div className="mb-2 flex items-center gap-2.5">
        <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full border border-gold/50 bg-gold/10 text-base shadow-[inset_0_0_12px_rgba(201,162,39,0.12)]">
          {(pressing || latched) && (
            <span className="absolute -inset-1 animate-pulse rounded-full border border-emerald-400/60" />
          )}
          <span aria-hidden="true">🎙</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-sm font-semibold text-gold">
            {t('voice.connected')}
          </p>
          <p className="text-[11px] text-parchment/50">
            {t('voice.participantCount', { count: remoteByPlayerId.size + 1 })}
          </p>
        </div>
        {expanded && (
          <button
            type="button"
            onClick={() => onLeave('left')}
            className="rounded px-1.5 py-1 text-xs text-parchment/45 hover:text-crimson focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crimson/60"
          >
            {t('voice.leave')}
          </button>
        )}
        <button
          type="button"
          aria-expanded={expanded}
          onClick={toggleDetails}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-gold/20 text-xs text-parchment/55 transition hover:border-gold/50 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
          title={expanded ? t('voice.hideDetails') : t('voice.showDetails')}
        >
          <span aria-hidden="true">{expanded ? '⌄' : '⌃'}</span>
          <span className="sr-only">
            {expanded ? t('voice.hideDetails') : t('voice.showDetails')}
          </span>
        </button>
      </div>

      {expanded && <div className="mb-2">{participantStrip}</div>}
      {expanded && <div className="mb-2">{deviceSelector}</div>}
      {microphoneControls}
      {error && (
        <p className="mt-1 text-center text-xs text-crimson" aria-live="polite">
          {error}
        </p>
      )}
    </section>
  );
}
