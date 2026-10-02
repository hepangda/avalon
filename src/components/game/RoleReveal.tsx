'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/Button';
import { FlipCard } from '@/components/animations';
import { GameIcon } from './GameArt';
import { RoleCard } from './RoleCard';
import { gameActions } from '@/lib/socket/client';
import { useAuthIdentity } from '@/lib/auth/useAuthIdentity';
import { RoleKnowledge } from './RoleKnowledge';
import type { ClientGameState, Role, VisibilityInfo } from '@/lib/engine';

interface RoleRevealProps {
  onAck?: typeof gameActions.ackRole;
  onReroll?: typeof gameActions.useRerollCard;
  blocked?: boolean;
  game: ClientGameState;
  reveal: { selfRole: Role; knownPlayers: VisibilityInfo[] } | null;
  myPlayerId: string | null;
  timer?: ReactNode;
}

export function RoleReveal({ game, reveal, myPlayerId, onAck = gameActions.ackRole, onReroll = gameActions.useRerollCard, blocked = false, timer }: RoleRevealProps) {
  const t = useTranslations();
  const { user, refresh } = useAuthIdentity();
  const [rerolling, setRerolling] = useState(false);
  const [confirmReroll, setConfirmReroll] = useState(false);
  const rerollInFlight = useRef(false);
  useEffect(() => { setConfirmReroll(false); }, [game.gameId, game.roleRevision, myPlayerId, user?.id, blocked, game.canRerollOpening]);
  useEffect(() => { void refresh(); }, [refresh, game.gameId, game.roleRevision]);
  const reduceMotion = useReducedMotion();
  const [flipped, setFlipped] = useState(false);
  const [acking, setAcking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const role = game.selfRole ?? reveal?.selfRole;
  const variant = game.players.find((p) => p.id === myPlayerId)?.roleVariant;
  const knownPlayers = game.selfRole ? game.knownPlayers : reveal?.knownPlayers ?? [];

  async function handleAck() {
    // The overlay closes when roleAcks (in projected state) includes us; no need
    // to track a local "waiting" state — each player enters independently.
    if (acking || rerollInFlight.current || blocked) return;
    setConfirmReroll(false);
    setAcking(true);
    setError(null);
    try {
      const res = await onAck(game.roleRevision ?? 0);
      if (!res.ok) {
        setError(res.error?.message ?? t('table.actionFailed'));
        setAcking(false);
      }
    } catch {
      setError(t('table.actionFailed'));
      setAcking(false);
    }
  }

  async function handleReroll() {
    if (rerollInFlight.current || acking || blocked || !user?.rerollCards?.cards || !game.canRerollOpening) return;
    if (!confirmReroll) {
      setConfirmReroll(true);
      return;
    }
    rerollInFlight.current = true;
    setConfirmReroll(false);
    setRerolling(true);
    setError(null);
    try {
      const res = await onReroll(game.roleRevision ?? 0);
      if (!res.ok) {
        const code = res.error?.code;
        setError(t(code === 'NO_REROLL_CARDS' ? 'reroll.empty' : code === 'AUTH_REQUIRED' ? 'reroll.loginShort' : code === 'WRONG_PHASE' ? 'reroll.unavailableShort' : 'table.actionFailed'));
      }
      await refresh();
    } catch {
      setError(t('table.actionFailed'));
    } finally {
      rerollInFlight.current = false;
      setRerolling(false);
    }
  }


  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-4">
      <h1 className="font-serif text-2xl text-gold">{t('roleReveal.title')}</h1>
      {timer}

      <FlipCard
        revealed={flipped}
        onClick={!flipped ? () => setFlipped(true) : undefined}
        ariaLabel={t('roleReveal.tapToReveal')}
        className="role-reveal-card rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
        back={
          <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl border-2 border-gold/50 bg-gradient-to-b from-stone to-ink shadow-2xl">
            <GameIcon
              name="crest"
              className="h-20 w-20 drop-shadow-[0_0_16px_rgba(201,162,39,0.35)]"
            />
            <span className="mt-3 text-xs uppercase tracking-widest text-parchment/50">
              {t('roleReveal.tapToReveal')}
            </span>
          </div>
        }
        front={role && <RoleCard role={role} variant={variant} />}
      />

      {flipped && role && (
        <motion.div
          initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduceMotion ? 0 : 0.3 }}
          className="w-full space-y-4 text-center"
        >
          <RoleKnowledge game={game} knownPlayers={knownPlayers} />

          <div className="flex w-full items-stretch gap-2">
            <Button className="w-36 shrink-0 whitespace-nowrap px-3" variant="secondary" onClick={handleReroll}
              onBlur={() => setConfirmReroll(false)}
              onKeyDown={(event) => { if (event.key === 'Escape') setConfirmReroll(false); }}
              disabled={blocked || acking || rerolling || !user?.rerollCards?.cards || !game.canRerollOpening}>
              {rerolling ? t('reroll.using') : confirmReroll ? t('reroll.confirm') : t('reroll.button', { count: user?.rerollCards?.cards ?? 0 })}
            </Button>
            <Button className="min-w-0 flex-1 whitespace-nowrap" onClick={handleAck} disabled={acking || rerolling || blocked}>
              {acking ? t('roleReveal.entering') : t('roleReveal.understand')}
            </Button>
          </div>
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        </motion.div>
      )}

      {!flipped && <p className="text-sm text-parchment/40">{t('roleReveal.tapWhenReady')}</p>}
    </div>
  );
}
