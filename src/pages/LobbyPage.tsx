import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslations } from 'use-intl';
import { useRouter } from '@/i18n/navigation';
import { TableSheet } from '@/components/game/TableSheet';
import { wouldDissolveRoom } from '@/lib/game/roomDissolution';
import { GameIcon } from '@/components/game/GameArt';
import { LobbyProgress } from '@/components/lobby/LobbyProgress';
import { LobbyTable } from '@/components/lobby/LobbyTable';
import { DeckPreview } from '@/components/lobby/DeckPreview';
import { GameSetup } from '@/components/lobby/GameSetup';
import { RoomTitle } from '@/components/lobby/RoomTitle';
import { PreferencesButton } from '@/components/PreferencesButton';
import { Button } from '@/components/ui/Button';
import { ReconnectOverlay } from '@/components/ui/ReconnectOverlay';
import { useRoomConnection, roomActions } from '@/lib/socket/client';
import { joinErrorText } from '@/lib/socket/client/joinErrorText';
import { disconnectRoom } from '@/lib/socket/client/socket';
import { resolveRoomConfig } from '@/lib/socket/roomConfig';
import { useRoomStore } from '@/lib/store/room';
import { useSessionStore } from '@/lib/store/session';
import { useSceneGate } from '@/lib/store/sceneGate';
import { useAuthIdentity } from '@/lib/auth/useAuthIdentity';
import { accountDisplayName } from '@/lib/auth/types';
import { cn } from '@/lib/utils/cn';
import { formatLatency, latencyTextClass } from '@/lib/utils/latency';
import type { GameOptions } from '@/lib/engine';
import type { Ack, RoomConfig } from '@/lib/socket/types';
import './lobby.css';

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
  const [view, setView] = useState<'table' | 'setup'>('table');
  const viewToggle = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const actionPending = useRef(false);
  const [dissolutionAction, setDissolutionAction] = useState<(() => Promise<void | Ack<unknown>>) | null>(null);

  const seated = (snapshot?.members ?? []).filter((m) => !m.isSpectator && m.claimed).sort((a, b) => a.seat - b.seat);
  const seatedCount = seated.length;
  const hasSeat = seated.some((m) => m.id === myPlayerId);
  const canStart = seatedCount >= 5 && seatedCount <= 10;
  const connected = conn === 'connected';
  const busy = !connected || pending;

  // Redirect into the game once it starts. Guard on the snapshot's own code:
  // the room store is a global singleton that can briefly still hold a previous
  // room's snapshot right after navigation, and acting on its stale 'finished'
  // status would wrongly bounce us into that old game's end screen.
  // Only a start watched from this lobby closes the gate; arriving at a running game just goes in.
  const sawLobby = useRef<string | null>(null);
  useEffect(() => {
    if (snapshot?.code !== code) return;
    if (snapshot.status === 'lobby') sawLobby.current = code;
    if (snapshot.status === 'in_game' || snapshot.status === 'finished') {
      const enter = () => router.replace(`/game/${code}`);
      const crest = document.querySelector('.lobby-felt-crest')?.getBoundingClientRect();
      const origin = crest ? { x: crest.left + crest.width / 2, y: crest.top + crest.height / 2, width: crest.width } : null;
      if (snapshot.status !== 'in_game' || sawLobby.current !== code || !useSceneGate.getState().close(code, origin, enter)) enter();
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

  /** Seat and start actions run one at a time; a failure surfaces in the table's error banner. */
  async function act(action: () => Promise<void | Ack<unknown>>) {
    if (!connected || actionPending.current) return;
    actionPending.current = true;
    setPending(true);
    setActionError(null);
    try {
      const result = await action();
      if (result && !result.ok) setActionError(result.error?.message ?? t('table.actionFailed'));
      else setDissolutionAction(null);
    } catch {
      setActionError(t('table.actionFailed'));
    } finally {
      actionPending.current = false;
      setPending(false);
    }
  }

  async function handleConfig(config: RoomConfig) {
    setActionError(null);
    const res = await roomActions.config(config);
    if (!res.ok && res.error) setActionError(res.error.message);
  }

  function requestDeparture(action: () => Promise<void | Ack<unknown>>, playerId: string | null, hostLeaving = false) {
    if (busy || !snapshot) return;
    if (wouldDissolveRoom(snapshot, playerId, hostLeaving)) {
      setActionError(null);
      setDissolutionAction(() => action);
    } else void act(action);
  }

  async function handleLeave() {
    const res = await roomActions.leave();
    if (res.ok) {
      useSessionStore.getState().setSession(code, { playerId: undefined, playerToken: undefined });
      useRoomStore.getState().reset();
      router.push('/');
    }
    return res;
  }

  async function handleClaim() {
    if (!user) return;
    const res = await roomActions.claimSeat(undefined, identityName, identityAvatarUrl);
    if (res.ok && res.data) {
      useSessionStore.getState().setSession(code, {
        playerId: res.data.playerId,
        playerToken: res.data.playerToken,
      });
    }
    return res;
  }

  async function handleStand() {
    const res = await roomActions.releaseSeat();
    if (res.ok) {
      useSessionStore
        .getState()
        .setSession(code, { playerId: undefined, playerToken: undefined });
    }
    return res;
  }

  if (!snapshot || snapshot.code !== code) {
    // Without a snapshot there is no room to show; a failed join must not wait forever.
    if (notice?.type === 'join_error') {
      return (
        <main className="flex h-[100dvh] flex-col items-center justify-center gap-6 px-6 text-center">
          <GameIcon name="crest" className="h-16 w-16 opacity-50 grayscale" />
          <p role="alert" className="max-w-xs text-parchment/80">{joinErrorText(notice, t)}</p>
          <Button
            variant="secondary"
            onClick={() => {
              disconnectRoom();
              useRoomStore.getState().reset();
              router.push('/');
            }}
          >
            {t('common.backHome')}
          </Button>
        </main>
      );
    }
    return (
      <main className="flex h-[100dvh] flex-col items-center justify-center gap-5">
        <GameIcon name="crest" className="lobby-waiting-crest h-16 w-16" />
        <p className="text-sm tracking-wide text-parchment/60">
          {notice?.type === 'session_replaced' ? t('common.sessionReplaced') : conn === 'disconnected' ? t('common.reconnecting') : t('lobby.enteringHall')}
        </p>
      </main>
    );
  }

  const count = Math.max(5, Math.min(10, seatedCount || 5));
  const config = resolveRoomConfig(snapshot.config, count);
  const canConfigure = isHost && connected;
  /** Any hand-made change leaves the recommended setup. */
  const customize = (patch: Partial<GameOptions>) => {
    if (!canConfigure) return;
    const options = { ...config.options, ...patch };
    if (patch.morgana !== undefined) options.percival = patch.morgana;
    void handleConfig({ ...config, useRecommended: false, options });
  };
  const notices = notice?.type === 'session_replaced'
    ? t('common.sessionReplaced')
    : actionError ?? (notice?.type === 'join_error' ? joinErrorText(notice, t) : null);

  return (
    <main className="table-screen lobby-screen">
      <ReconnectOverlay active={!connected && notice?.type !== 'session_replaced' && notice?.type !== 'join_error'} />
      <header className="table-header">
        <div className="flex min-w-0 items-center">
          <button
            type="button"
            className="table-tool -ml-2.5 shrink-0"
            aria-label={t('common.leave')}
            title={t('common.leave')}
            disabled={busy}
            onClick={() => requestDeparture(handleLeave, myPlayerId, isHost)}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 5-7 7 7 7M5 12h14" />
            </svg>
          </button>
          <RoomTitle
            code={code}
            name={snapshot.name ?? ''}
            visibility={snapshot.visibility ?? 'private'}
            isHost={isHost}
            disabled={!connected}
            onError={setActionError}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`table-latency ${connected ? latencyTextClass(selfLatency) : 'text-amber-300'}`}>
            {connected ? `● ${formatLatency(selfLatency)}` : t('game.reconnecting')}
          </span>
          <PreferencesButton />
        </div>
      </header>

      {/* Only the host configures; everyone else reads the whole setup off the table. */}
      <div className={cn('table-workspace', !isHost && 'is-solo')} data-view={isHost && view === 'setup' ? 'report' : 'table'}>
        <div className="table-play" role="region" aria-label={t('table.tabTable')}>
          <div className="table-progress">
            <LobbyProgress count={count} options={config.options} />
          </div>
          <div className="lobby-stage">
            <LobbyTable
              code={code}
              seated={seated}
              hostPlayerId={snapshot.hostPlayerId}
              myPlayerId={myPlayerId}
              isHost={isHost}
              busy={busy}
              deck={<DeckPreview count={count} options={config.options} onOpen={isHost ? () => setView('setup') : undefined} />}
              onClaim={() => void act(handleClaim)}
              onKick={(id) => requestDeparture(() => roomActions.kick(id), id)}
              onTransferHost={(id) => void act(() => roomActions.transferHost(id))}
            />
          </div>
          <footer className="table-footer">
            <div className="table-actions">
              {isHost ? (
                <button
                  type="button"
                  className="table-action lobby-begin"
                  onClick={() => void act(roomActions.start)}
                  disabled={!canStart || busy}
                >
                  {canStart ? t('lobby.beginQuest') : t('lobby.needPlayers', { count: seatedCount })}
                </button>
              ) : !hasSeat ? (
                <button type="button" className="table-action lobby-begin" disabled={busy} onClick={() => void act(handleClaim)}>
                  {t('seat.sitDown')}
                </button>
              ) : (
                <p className="table-action-placeholder gap-2.5">
                  <span className="lobby-pulse" aria-hidden="true" />
                  {t('lobby.waitingHost')}
                </p>
              )}
            </div>
          </footer>
        </div>

        {isHost && <aside className="table-report lobby-setup" role="region" aria-label={t('lobby.configuration')}>
          <div className="lobby-setup-scroll">
            <GameSetup
              count={count}
              options={config.options}
              useRecommended={config.useRecommended === true}
              disabled={!canConfigure}
              onRecommended={(value) => {
                if (canConfigure) void handleConfig(resolveRoomConfig({ ...config, useRecommended: value }, count));
              }}
              onChange={customize}
            />
          </div>
          <button
            type="button"
            className="table-report-close"
            aria-label={t('table.returnToTable')}
            title={t('table.returnToTable')}
            onClick={() => {
              setView('table');
              viewToggle.current?.focus();
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </aside>}

        {(isHost || hasSeat) && <div className="table-bottom-tools">
          <div className="table-tools">
            {isHost && seatedCount < 10 && (
              <button type="button" className="table-tool" disabled={busy} onClick={() => void act(roomActions.addBot)}>
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="5" y="7" width="14" height="13" rx="3" />
                  <path d="M12 3v4M2 12v4m20-4v4M9 16h6" />
                </svg>
                <span>{t('seat.addBot')}</span>
              </button>
            )}
            {hasSeat && (
              <button type="button" className="table-tool" disabled={busy} onClick={() => requestDeparture(handleStand, myPlayerId)}>
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10 15V4m0 0L6 8m4-4 4 4M4 17h12" />
                </svg>
                <span>{t('seat.standUp')}</span>
              </button>
            )}
            {isHost && <button
              ref={viewToggle}
              type="button"
              className="table-tool table-view-toggle"
              onClick={() => setView(view === 'table' ? 'setup' : 'table')}
            >
              {view === 'table' ? (
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="6" height="9" rx="1.2" transform="rotate(-8 6 8.5)" />
                  <rect x="10" y="5" width="6" height="9" rx="1.2" transform="rotate(8 13 9.5)" />
                </svg>
              ) : (
                <span aria-hidden="true">◉</span>
              )}
              <span>{view === 'table' ? t('lobby.configuration') : t('table.tabTable')}</span>
            </button>}
          </div>
        </div>}
      </div>

      <TableSheet open={dissolutionAction !== null} title={t('common.dissolveRoomTitle')}
        onClose={() => setDissolutionAction(null)} busy={pending} error={actionError}>
        <div className="space-y-4">
          <p className="text-sm text-parchment/80">{t('common.confirmDissolveRoom')}</p>
          <div className="flex gap-2">
            <Button variant="ghost" autoFocus disabled={pending} onClick={() => setDissolutionAction(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" disabled={busy} onClick={() => { if (dissolutionAction) void act(dissolutionAction); }}>{t('common.confirmDissolve')}</Button>
          </div>
        </div>
      </TableSheet>

      {notices && (
        <div role="alert" className="table-error">
          <span>{notices}</span>
          {actionError && notices === actionError && (
            <button type="button" onClick={() => setActionError(null)} aria-label={t('mission.close')}>✕</button>
          )}
        </div>
      )}
    </main>
  );
}
