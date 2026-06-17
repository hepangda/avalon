'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils/cn';
import { IdentityCard } from './IdentityCard';
import { gameActions } from '@/lib/socket/client';
import { ROLE_TEAM_UI } from '@/lib/game/roleMeta';
import type { ClientGameState, ClientPlayer } from '@/lib/engine';

/** A "play cards to pick targets" phase (nomination / assassination). */
export interface PickConfig {
  /** Ids that may be picked. */
  candidateIds: string[];
  /** How many to pick before the confirm card is dealt (team size / 1). */
  size: number;
  confirmLabel: string;
  tone: 'gold' | 'crimson' | 'sky';
  /** Commit the pick; resolves to whether it succeeded. */
  onConfirm: () => Promise<boolean>;
}

/**
 * The viewer's hand, pinned to the bottom of the table. Always holds the
 * identity card. Action phases deal playable cards:
 *  - A "pick" phase (nominate / assassinate): a card per candidate. Tapping one
 *    plays it up to the centre pile; once enough are picked the rest fly away
 *    and a confirm card is dealt. A retract card (and tapping a centre card) undo.
 *  - Voting: an Approve and a Reject card — tap one to play.
 *  - MissionVote (on the team): a Success and a Fail card — tap one to play.
 */
export function HandArea({
  game,
  myPlayerId,
  selected,
  onToggleSelect,
  pick,
}: {
  game: ClientGameState;
  myPlayerId: string | null;
  selected: string[];
  onToggleSelect: (id: string) => void;
  pick: PickConfig | null;
}) {
  const t = useTranslations();
  const reduce = useReducedMotion();
  const [cast, setCast] = useState<'approve' | 'reject' | null>(null);
  const [missionPlayed, setMissionPlayed] = useState<'success' | 'fail' | null>(null);
  const [confirming, setConfirming] = useState(false);

  const phaseKey = `${game.phase}-${game.roundIndex}-${game.rejectionCount}`;
  useEffect(() => {
    setCast(null);
    setMissionPlayed(null);
    setConfirming(false);
  }, [phaseKey]);

  if (game.isSpectator) return null;

  const myVote = game.votes?.find((v) => v.playerId === myPlayerId);
  const alreadyVoted = cast !== null || !!myVote?.hasVoted;
  const canVote = game.phase === 'Voting' && !!myPlayerId && !alreadyVoted;

  const team = game.proposedTeam ?? [];
  const onTeam = !!myPlayerId && team.includes(myPlayerId);
  const isEvil = game.selfRole ? ROLE_TEAM_UI[game.selfRole] === 'evil' : false;
  const canMission = game.phase === 'MissionVote' && onTeam && missionPlayed === null;

  const full = !!pick && selected.length >= pick.size;
  const available = pick
    ? pick.candidateIds
        .filter((id) => !selected.includes(id))
        .map((id) => game.players.find((p) => p.id === id))
        .filter((p): p is ClientPlayer => !!p)
        .sort((a, b) => a.seat - b.seat)
    : [];

  async function vote(value: 'approve' | 'reject') {
    setCast(value);
    const res = await gameActions.vote(value);
    if (!res.ok) setCast(null);
  }
  async function playMission(card: 'success' | 'fail') {
    setMissionPlayed(card);
    const res = await gameActions.missionCard(card);
    if (!res.ok) setMissionPlayed(null);
  }
  async function confirm() {
    if (!pick) return;
    setConfirming(true);
    const ok = await pick.onConfirm();
    if (!ok) setConfirming(false);
  }

  return (
    <div className="flex w-full flex-col items-center gap-2">
      {pick ? (
        <div className="flex w-full items-end gap-2">
          <DragScrollRow innerClassName="min-h-[6.5rem] items-end gap-2 px-2 py-4">
            <AnimatePresence mode="popLayout" initial={false}>
              {!full &&
                available.map((p) => (
                  <NomineeHandCard
                    key={p.id}
                    player={p}
                    reduce={!!reduce}
                    onClick={() => onToggleSelect(p.id)}
                  />
                ))}
              {full && (
                <ConfirmCard
                  key="confirm"
                  label={pick.confirmLabel}
                  tone={pick.tone}
                  disabled={confirming}
                  reduce={!!reduce}
                  onClick={confirm}
                />
              )}
            </AnimatePresence>
          </DragScrollRow>
          <IdentityCard game={game} />
        </div>
      ) : (
        <div className="flex min-h-[6.5rem] w-full items-center justify-center gap-4 px-3">
          <AnimatePresence mode="popLayout">
            {canVote && (
              <motion.div
                key="vote-hand"
                className="flex items-end gap-3"
                exit={reduce ? { opacity: 0 } : { y: -180, opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.35 }}
              >
                <ActionCard tone="approve" sigil="🛡️" label={t('vote.approve')} dealIndex={0} reduce={!!reduce} onPlay={() => vote('approve')} />
                <ActionCard tone="reject" sigil="🗡️" label={t('vote.reject')} dealIndex={1} reduce={!!reduce} onPlay={() => vote('reject')} />
              </motion.div>
            )}

            {canMission && (
              <motion.div
                key="mission-hand"
                className="flex items-end gap-3"
                exit={reduce ? { opacity: 0 } : { y: -180, opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.35 }}
              >
                <ActionCard tone="approve" sigil="✨" label={t('missionVote.success')} dealIndex={0} reduce={!!reduce} onPlay={() => playMission('success')} />
                <ActionCard
                  tone="reject"
                  sigil="💀"
                  label={t('missionVote.fail')}
                  dealIndex={1}
                  reduce={!!reduce}
                  disabled={!isEvil}
                  lockedHint={!isEvil ? t('missionVote.loyalOnlySuccess') : undefined}
                  onPlay={() => playMission('fail')}
                />
              </motion.div>
            )}

            {game.phase === 'Voting' && alreadyVoted && (
              <motion.span key="voted" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-parchment/50">
                {t('vote.castWaiting')}
              </motion.span>
            )}

            {game.phase === 'MissionVote' && onTeam && missionPlayed && (
              <motion.span key="sealed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-parchment/50">
                {t('missionVote.sealed')}
              </motion.span>
            )}
          </AnimatePresence>

          <IdentityCard game={game} />
        </div>
      )}

      {/* Retract card below the hand. */}
      <AnimatePresence>
        {pick && selected.length > 0 && (
          <RetractCard
            key="retract"
            label={t('teamBuilder.retract')}
            reduce={!!reduce}
            onClick={() => onToggleSelect(selected[selected.length - 1]!)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * A horizontally scrollable row. Touch uses native scroll; mouse can drag to
 * scroll. The inner padding leaves room so lifted cards are not clipped. A drag
 * that moved is swallowed so it doesn't also select a card.
 */
function DragScrollRow({ children, innerClassName }: { children: ReactNode; innerClassName?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const st = useRef({ active: false, startX: 0, startScroll: 0, moved: false });

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        if (e.pointerType !== 'mouse' || !ref.current) return;
        st.current = { active: true, startX: e.clientX, startScroll: ref.current.scrollLeft, moved: false };
      }}
      onPointerMove={(e) => {
        if (!st.current.active || !ref.current) return;
        const dx = e.clientX - st.current.startX;
        if (Math.abs(dx) > 4) st.current.moved = true;
        ref.current.scrollLeft = st.current.startScroll - dx;
      }}
      onPointerUp={() => {
        st.current.active = false;
      }}
      onPointerLeave={() => {
        st.current.active = false;
      }}
      onClickCapture={(e) => {
        if (st.current.moved) {
          e.stopPropagation();
          st.current.moved = false;
        }
      }}
      className="w-full min-w-0 overflow-x-auto overscroll-x-contain"
      style={{ scrollbarWidth: 'none', cursor: 'grab' }}
    >
      <div className={cn('flex w-max mx-auto', innerClassName)}>{children}</div>
    </div>
  );
}

/** A large play card (vote / mission) that deals in and flies up when played. */
function ActionCard({
  tone,
  sigil,
  label,
  dealIndex,
  reduce,
  disabled,
  lockedHint,
  onPlay,
}: {
  tone: 'approve' | 'reject';
  sigil: string;
  label: string;
  dealIndex: number;
  reduce: boolean;
  disabled?: boolean;
  lockedHint?: string;
  onPlay: () => void;
}) {
  const approve = tone === 'approve';
  return (
    <motion.button
      type="button"
      onClick={onPlay}
      disabled={disabled}
      title={lockedHint}
      initial={reduce ? false : { y: -150, opacity: 0, rotate: approve ? -10 : 10, scale: 0.8 }}
      animate={{ y: 0, opacity: 1, rotate: 0, scale: 1 }}
      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 24, delay: dealIndex * 0.12 }}
      whileHover={reduce || disabled ? undefined : { y: -10, scale: 1.05 }}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      className={cn(
        'relative flex h-24 w-[4.3rem] flex-col items-center justify-center gap-1.5 rounded-xl border-2 shadow-lg shadow-black/40',
        disabled
          ? 'cursor-not-allowed border-gold/20 bg-stone/40 opacity-55'
          : approve
            ? 'border-sky-300/60 bg-gradient-to-br from-sky-600 to-royal'
            : 'border-crimson-bright/70 bg-gradient-to-br from-crimson-bright to-crimson',
      )}
    >
      <span className="text-3xl drop-shadow">{sigil}</span>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-parchment">{label}</span>
      {disabled && <span className="absolute right-1.5 top-1.5 text-xs">🔒</span>}
    </motion.button>
  );
}

/** One pick candidate (face-up — nomination / assassination are public). Tap to
 *  play it up to the centre; when enough are picked, the rest fly away. */
function NomineeHandCard({
  player,
  reduce,
  onClick,
}: {
  player: ClientPlayer;
  reduce: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      layout
      initial={reduce ? false : { y: -120, opacity: 0, scale: 0.8 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { y: -90, opacity: 0, scale: 0.6 }}
      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 340, damping: 24 }}
      whileHover={reduce ? undefined : { y: -8, scale: 1.04 }}
      className="flex h-[4.6rem] w-12 shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-gold/40 bg-ink/60 px-1 shadow-md"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gold/20 text-xs text-gold">
        {player.seat + 1}
      </span>
      <span className="max-w-full truncate text-[9px] leading-tight text-parchment">{player.name}</span>
    </motion.button>
  );
}

/** The "confirm" card, dealt once enough picks are made. */
function ConfirmCard({
  label,
  tone,
  disabled,
  reduce,
  onClick,
}: {
  label: string;
  tone: 'gold' | 'crimson' | 'sky';
  disabled: boolean;
  reduce: boolean;
  onClick: () => void;
}) {
  const cls =
    tone === 'crimson'
      ? 'border-crimson-bright bg-gradient-to-br from-crimson-bright to-crimson text-parchment'
      : tone === 'sky'
        ? 'border-sky-300 bg-gradient-to-br from-sky-500 to-royal text-parchment'
        : 'border-gold-bright bg-gradient-to-br from-gold-bright to-gold text-ink-deep';
  const icon = tone === 'crimson' ? '🗡️' : tone === 'sky' ? '🌊' : '✓';
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      initial={reduce ? false : { y: -150, opacity: 0, scale: 0.8 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { y: -90, opacity: 0, scale: 0.7 }}
      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 22, delay: 0.18 }}
      whileHover={reduce || disabled ? undefined : { y: -8, scale: 1.05 }}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      className={cn(
        'flex h-24 w-20 flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-1.5 shadow-candle disabled:opacity-60',
        cls,
      )}
    >
      <span className="text-3xl leading-none">{icon}</span>
      <span className="text-center text-[11px] font-semibold leading-tight">{label}</span>
    </motion.button>
  );
}

/** The "retract" card, below the hand — undoes the most recent pick. */
function RetractCard({
  label,
  reduce,
  onClick,
}: {
  label: string;
  reduce: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex items-center gap-1.5 rounded-full border border-gold/40 bg-stone/70 px-4 py-1.5 text-xs text-parchment hover:border-gold/80 hover:shadow-candle"
    >
      <span>↩</span>
      {label}
    </motion.button>
  );
}
