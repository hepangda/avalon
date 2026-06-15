'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useRoomConnection, roomActions } from '@/lib/socket/client';
import { useRoomStore } from '@/lib/store/room';
import { Card } from '@/components/ui/Card';
import { PhaseTransition } from '@/components/animations';
import { MissionTrack } from '@/components/game/MissionTrack';
import { RoleReveal } from '@/components/game/RoleReveal';
import { TeamBuilder } from '@/components/game/TeamBuilder';
import { VotePanel } from '@/components/game/VotePanel';
import { MissionVote } from '@/components/game/MissionVote';
import { MissionResult } from '@/components/game/MissionResult';
import { LadyOfLake } from '@/components/game/LadyOfLake';
import { AssassinPanel } from '@/components/game/AssassinPanel';
import { GameOverReveal } from '@/components/game/GameOverReveal';
import { RoundHistoryModal } from '@/components/game/RoundHistoryModal';
import { ResultOverlay } from '@/components/game/ResultOverlay';
import { MyIdentityButton } from '@/components/game/MyIdentityButton';
import { InGameSeatClaim } from '@/components/game/InGameSeatClaim';
import { ProposalTracker } from '@/components/game/ProposalTracker';
import { LogPanel } from '@/components/game/LogPanel';
import { AdminPanel } from '@/components/game/AdminPanel';
import { useResultCue } from '@/lib/game/useResultCue';
import { formatLatency, latencyTextClass } from '@/lib/utils/latency';
import type { GamePhase } from '@/lib/engine';

export default function GamePage() {
  const t = useTranslations();
  const params = useParams<{ code: string }>();
  const code = (params.code ?? '').toUpperCase();
  const router = useRouter();

  useRoomConnection(code);

  const conn = useRoomStore((s) => s.conn);
  const game = useRoomStore((s) => s.game);
  const reveal = useRoomStore((s) => s.reveal);
  const ladyResult = useRoomStore((s) => s.ladyResult);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const selfLatency = useRoomStore((s) => s.selfLatency);

  const [historyRound, setHistoryRound] = useState<number | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const { cue, dismiss } = useResultCue();

  async function handleLeave() {
    // Leaving frees (unbinds) our seat server-side; clear the local session so a
    // later visit doesn't auto-rejoin it, then go home.
    await roomActions.leave();
    const { useSessionStore } = await import('@/lib/store/session');
    useSessionStore.getState().setSession(code, { playerId: undefined });
    useRoomStore.getState().reset();
    router.push('/');
  }

  if (!game) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="animate-pulse text-parchment/60">
          {conn === 'disconnected' ? t('common.reconnecting') : t('common.loading')}
        </p>
      </main>
    );
  }

  // Per-player role-reveal overlay: shown to a seated player who hasn't yet
  // acked their role. Driven by projected roleAcks, so it survives reconnect
  // (an un-acked player returns to the card) and clears as soon as the ack
  // lands in the next state:sync. Spectators never see it.
  const needsRoleReveal =
    !!myPlayerId && !game.isSpectator && !game.roleAcks.includes(myPlayerId);

  if (game.phase === 'GameOver') {
    return (
      <main className="min-h-screen py-6">
        <ResultOverlay cue={cue} game={game} onClose={dismiss} />
        <GameOverReveal game={game} gameId={game.gameId} />
      </main>
    );
  }

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden">
      <ResultOverlay cue={cue} game={game} onClose={dismiss} />

      {needsRoleReveal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-deep py-6">
          <RoleReveal game={game} reveal={reveal} myPlayerId={myPlayerId} />
        </div>
      )}

      {/* Game content — fixed top region; scrolls internally only if it can't
          fit. flex-[0_1_auto] = natural height, but yields when the screen is
          short so the log always keeps its share. */}
      <div className="mx-auto w-full max-w-2xl flex-[0_1_auto] space-y-4 overflow-y-auto p-4">
        {game.isSpectator && (
          <>
            <div className="rounded-lg border border-gold/30 bg-gold/10 px-4 py-2 text-center text-sm text-gold">
              👁 {t('game.spectating')}
            </div>
            <InGameSeatClaim code={code} game={game} />
          </>
        )}
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-parchment/50">
                {t(`phase.${game.phase as GamePhase}`)}
              </p>
              <p className="font-serif text-lg text-gold">
                {t('game.missionOf', { round: game.roundIndex + 1 })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <MyIdentityButton game={game} />
              {conn === 'connected' ? (
                <span className={`text-xs tabular-nums ${latencyTextClass(selfLatency)}`}>
                  ● {formatLatency(selfLatency)}
                </span>
              ) : (
                <span className="text-xs text-amber-400">● {t('game.reconnecting')}</span>
              )}
            </div>
          </div>
          <MissionTrack game={game} onSelect={setHistoryRound} />
          {(game.phase === 'TeamBuilding' || game.phase === 'Voting') && (
            <ProposalTracker game={game} />
          )}
        </Card>

        <PhaseTransition phaseKey={`${game.phase}-${game.roundIndex}-${game.rejectionCount}`}>
          {game.phase === 'TeamBuilding' && <TeamBuilder game={game} myPlayerId={myPlayerId} />}
          {game.phase === 'Voting' && <VotePanel game={game} myPlayerId={myPlayerId} />}
          {game.phase === 'MissionVote' && <MissionVote game={game} myPlayerId={myPlayerId} />}
          {game.phase === 'MissionResult' && <MissionResult game={game} />}
          {game.phase === 'LadyOfLake' && (
            <LadyOfLake game={game} myPlayerId={myPlayerId} ladyResult={ladyResult} />
          )}
          {game.phase === 'Assassination' && (
            <AssassinPanel game={game} myPlayerId={myPlayerId} />
          )}
        </PhaseTransition>
      </div>

      {/* Log panel fills the remaining screen height. */}
      <div className="mx-auto flex w-full max-w-2xl min-h-0 flex-1 flex-col px-4 pb-4">
        <LogPanel game={game} />
      </div>

      {/* Super-password (referee) panel — floating, available to anyone with the
          password while a game is live. */}
      <AdminPanel game={game} />

      {/* Leave room — floating bottom-right, above the admin button. Leaving
          frees (unbinds) this player's seat. Two-tap confirm to avoid misclicks. */}
      <div className="fixed bottom-32 right-3 z-40 flex flex-col items-end gap-1">
        {confirmLeave && (
          <button
            onClick={handleLeave}
            className="rounded-full border border-crimson/60 bg-crimson/40 px-3 py-1.5 text-xs font-semibold text-parchment shadow-candle backdrop-blur hover:bg-crimson/30"
          >
            {t('game.confirmLeave')}
          </button>
        )}
        <button
          onClick={() => setConfirmLeave((c) => !c)}
          aria-label={t('common.leave')}
          title={t('common.leave')}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-gold/40 bg-ink/80 text-lg shadow-candle backdrop-blur hover:border-gold"
        >
          {confirmLeave ? '✕' : '🚪'}
        </button>
      </div>

      <RoundHistoryModal
        roundIndex={historyRound}
        game={game}
        onClose={() => setHistoryRound(null)}
      />
    </main>
  );
}
