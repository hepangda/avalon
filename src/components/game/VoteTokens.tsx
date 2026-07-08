'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'use-intl';
import { cn } from '@/lib/utils/cn';
import { labelById } from '@/lib/game/playerLabel';
import type { ClientGameState, ClientVoteRecord, VoteValue } from '@/lib/engine';

/**
 * Physical "vote token" primitives drawn procedurally with CSS gradients +
 * glyphs (no art assets). A token has three beats: an empty slot, a face-down
 * token that slams down when the player commits (hiding the choice), and a flip
 * that reveals approve/reject. Honors prefers-reduced-motion.
 *
 * The whole-table synchronized reveal lives in `VoteRevealReel` (used by the
 * result overlay); the per-seat status chip is `SeatVoteChip` (used by the
 * table ring during voting).
 */
type TokenState = 'waiting' | 'committed' | VoteValue;

function VoteToken({
  name,
  state,
  flipOrder,
  isMe,
}: {
  name: string;
  state: TokenState;
  flipOrder: number;
  isMe: boolean;
}) {
  const reduce = useReducedMotion();
  const revealed = state === 'approve' || state === 'reject';
  const placed = state === 'committed' || revealed;
  const flipDelay = reduce ? 0 : flipOrder * 0.07;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="relative h-[5.5rem] w-[3.9rem] sm:h-24 sm:w-[4.3rem]"
        style={{ perspective: 900 }}
      >
        {/* Empty slot the token drops into. */}
        <div
          className={cn(
            'absolute inset-0 rounded-lg border border-dashed transition-colors',
            placed ? 'border-transparent' : 'border-gold/25 bg-ink/20',
          )}
        />

        {/* The token itself: slams down (opacity/scale/y) then flips (rotateY). */}
        <motion.div
          className="absolute inset-0"
          style={{ transformStyle: 'preserve-3d' }}
          initial={false}
          animate={{
            rotateY: revealed ? 180 : 0,
            opacity: placed ? 1 : 0,
            y: placed ? 0 : -16,
            scale: placed ? 1 : 1.12,
          }}
          transition={
            reduce
              ? { duration: 0 }
              : {
                  rotateY: { delay: flipDelay, type: 'spring', stiffness: 210, damping: 20 },
                  // High stiffness + lowish damping = a snappy "slam" with a touch of overshoot.
                  default: { type: 'spring', stiffness: 520, damping: 17 },
                }
          }
        >
          <TokenBack highlight={isMe} />
          <TokenFront value={revealed ? (state as VoteValue) : undefined} />
        </motion.div>
      </div>

      <span
        className={cn(
          'max-w-[4.3rem] truncate text-[11px] leading-tight',
          isMe ? 'text-gold' : 'text-parchment/70',
        )}
        title={name}
      >
        {name}
      </span>
    </div>
  );
}

/** Face-down side: a royal crest. Shown until the synchronized reveal. */
function TokenBack({ highlight }: { highlight: boolean }) {
  return (
    <div
      className={cn(
        'absolute inset-0 flex items-center justify-center rounded-lg border bg-gradient-to-br from-royal to-ink shadow-lg shadow-black/40',
        highlight ? 'border-gold/70' : 'border-gold/35',
      )}
      style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
    >
      {/* Inner gilt ring for a struck-coin feel. */}
      <span className="absolute inset-1.5 rounded-md border border-gold/20" />
      <span
        className="text-2xl text-gold/85 sm:text-[1.75rem]"
        style={{ textShadow: '0 0 12px rgba(201,162,39,0.45)' }}
      >
        ⚜
      </span>
    </div>
  );
}

/** Revealed side: blue/sword for approve, crimson for reject. */
function TokenFront({ value }: { value?: VoteValue }) {
  const t = useTranslations();
  const approve = value === 'approve';

  return (
    <div
      className={cn(
        'absolute inset-0 flex flex-col items-center justify-center gap-0.5 rounded-lg border shadow-lg shadow-black/40',
        approve
          ? 'border-sky-300/60 bg-gradient-to-br from-sky-600 to-royal'
          : 'border-crimson-bright/70 bg-gradient-to-br from-crimson-bright to-crimson',
      )}
      style={{
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        transform: 'rotateY(180deg)',
      }}
    >
      <span className="absolute inset-1.5 rounded-md border border-white/15" />
      <span className="text-2xl drop-shadow sm:text-[1.6rem]">{approve ? '🛡️' : '🗡️'}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-parchment">
        {value ? t(approve ? 'vote.approve' : 'vote.reject') : ''}
      </span>
    </div>
  );
}

/**
 * One-shot synchronized reveal of a *completed* vote, for use inside the result
 * overlay (where it survives the server's instant phase change). Every token
 * starts face-down, then the whole table flips at once after a short beat, then
 * `onComplete` fires so the caller can reveal the verdict + tally. Reads a
 * finished vote record (all values already known) rather than live votes.
 */
export function VoteRevealReel({
  record,
  game,
  myPlayerId,
  onComplete,
}: {
  record: ClientVoteRecord;
  game: ClientGameState;
  myPlayerId: string | null;
  onComplete: () => void;
}) {
  const reduce = useReducedMotion();
  const [flipped, setFlipped] = useState(false);

  const seatOf = (id: string) => game.players.find((p) => p.id === id)?.seat ?? 0;
  const ordered = [...record.votes].sort((a, b) => seatOf(a.playerId) - seatOf(b.playerId));

  useEffect(() => {
    // Hold face-down briefly, flip in a staggered wave, then signal done.
    const flipAt = reduce ? 0 : 500;
    const doneAt = reduce ? 120 : 500 + 650 + ordered.length * 70;
    const t1 = setTimeout(() => setFlipped(true), flipAt);
    const t2 = setTimeout(onComplete, doneAt);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // Runs once per mount; the overlay remounts this on each new cue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-wrap items-end justify-center gap-3 sm:gap-4">
      {ordered.map((v, i) => (
        <VoteToken
          key={v.playerId}
          name={labelById(game, v.playerId)}
          state={flipped ? v.vote : 'committed'}
          flipOrder={i}
          isMe={v.playerId === myPlayerId}
        />
      ))}
    </div>
  );
}

/**
 * The central play pile: vote cards gather face-down in the middle of the table
 * as players vote, then (once everyone has voted) flip over one by one to reveal
 * each player's public vote. A stable slot per seat keeps the layout from
 * jumping; not-yet-voted seats show a faint placeholder.
 *
 *  - `reveal = null` → collecting: face-down cards for those who have voted.
 *  - `reveal = record` → revealing: every card flips in turn (staggered).
 */
export function VotePile({
  game,
  reveal,
}: {
  game: ClientGameState;
  reveal: ClientVoteRecord | null;
}) {
  const reduce = useReducedMotion();
  const ordered = [...game.players].sort((a, b) => a.seat - b.seat);
  const voteOf = (id: string) => reveal?.votes.find((v) => v.playerId === id)?.vote;
  const hasVotedOf = (id: string) => !!game.votes?.find((v) => v.playerId === id)?.hasVoted;

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {ordered.map((p, i) => (
        <PileCard
          key={p.id}
          seat={p.seat + 1}
          down={hasVotedOf(p.id)}
          vote={voteOf(p.id)}
          revealed={!!reveal}
          flipDelay={reduce ? 0 : i * 0.26}
          reduce={!!reduce}
        />
      ))}
    </div>
  );
}

function PileCard({
  seat,
  down,
  vote,
  revealed,
  flipDelay,
  reduce,
}: {
  seat: number;
  down: boolean;
  vote?: VoteValue;
  revealed: boolean;
  flipDelay: number;
  reduce: boolean;
}) {
  const approve = vote === 'approve';

  // Before revealing, an un-voted seat is just a faint placeholder slot.
  if (!revealed && !down) {
    return (
      <span className="flex h-16 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-gold/20 text-xs text-gold/30">
        {seat}
      </span>
    );
  }

  return (
    <span className="relative block h-16 w-12 shrink-0" style={{ perspective: 600 }}>
      <motion.span
        className="absolute inset-0"
        style={{ transformStyle: 'preserve-3d' }}
        initial={reduce ? false : { y: -22, opacity: 0, scale: 0.7 }}
        animate={{ y: 0, opacity: 1, scale: 1, rotateY: revealed ? 180 : 0 }}
        transition={
          reduce
            ? { duration: 0 }
            : {
                y: { type: 'spring', stiffness: 420, damping: 20 },
                scale: { type: 'spring', stiffness: 420, damping: 20 },
                opacity: { duration: 0.2 },
                rotateY: { delay: flipDelay, type: 'spring', stiffness: 220, damping: 20 },
              }
        }
      >
        {/* Face-down. */}
        <span
          className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-gold/45 bg-gradient-to-br from-royal to-ink"
          style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
        >
          <span className="text-xl leading-none text-gold/80">⚜</span>
          <span className="text-[9px] leading-none text-gold/45">{seat}</span>
        </span>
        {/* Revealed. */}
        <span
          className={cn(
            'absolute inset-0 flex flex-col items-center justify-center gap-0.5 rounded-lg border-2',
            approve
              ? 'border-sky-300/70 bg-sky-600 text-white'
              : 'border-crimson-bright/70 bg-crimson-bright text-white',
          )}
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          <span className="text-2xl font-bold leading-none">{vote ? (approve ? '✓' : '✕') : ''}</span>
          <span className="text-[9px] leading-none opacity-80">{seat}</span>
        </span>
      </motion.span>
    </span>
  );
}

/**
 * Compact, non-blocking outcome banner shown above the table when a vote or
 * mission resolves (the central pile carries the reveal). Stays a while, then
 * auto-dismisses; tap to dismiss early.
 */
export function OutcomeBanner({
  kind,
  approves = 0,
  rejects = 0,
  failCount = 0,
  onDismiss,
}: {
  kind: 'voteApproved' | 'voteRejected' | 'missionSuccess' | 'missionFail';
  approves?: number;
  rejects?: number;
  failCount?: number;
  onDismiss: () => void;
}) {
  const t = useTranslations();
  const reduce = useReducedMotion();

  useEffect(() => {
    const id = setTimeout(onDismiss, 7000);
    return () => clearTimeout(id);
  }, [onDismiss]);

  const good = kind === 'voteApproved' || kind === 'missionSuccess';
  const isVote = kind === 'voteApproved' || kind === 'voteRejected';
  const icon =
    kind === 'voteApproved' ? '🛡️' : kind === 'voteRejected' ? '🗡️' : kind === 'missionSuccess' ? '✨' : '💀';
  const detail = isVote
    ? t('vote.tally', { approves, rejects })
    : t('missionResult.failCards', { count: failCount });

  return (
    <motion.button
      type="button"
      onClick={onDismiss}
      initial={reduce ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'mx-auto flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm shadow-candle',
        good
          ? 'border-sky-300/60 bg-sky-600/20 text-sky-100'
          : 'border-crimson-bright/60 bg-crimson/25 text-parchment',
      )}
    >
      <span>{icon}</span>
      <span className="font-serif">{t(`cue.${kind}`)}</span>
      <span className="text-xs tabular-nums opacity-80">{detail}</span>
    </motion.button>
  );
}
