import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'use-intl';
import type { ClientGameState, ClientVoteRecord, VoteValue } from '@/lib/engine';
import { useSoundCue } from '@/lib/audio/useSoundCue';
import { voteRevealTimeline } from '@/lib/game/tablePresentation';
import { GameIcon } from './GameArt';
import { RejectionFlight } from './SealFlight';

const SIDES: VoteValue[] = ['approve', 'reject'];

/**
 * The count after the ballots turn: each stone is lifted off its card and dropped into
 * its pan, seat by seat from the leader, and only then is the verdict struck.
 */
export function VoteTally({ id, record, game, team }: {
  id: string;
  record: ClientVoteRecord;
  game: ClientGameState;
  /** The team, laid out between the title and the pans. */
  team: ReactNode;
}) {
  const t = useTranslations();
  const reduce = !!useReducedMotion();
  const [timeline] = useState(() => voteRevealTimeline(record.votes.length, reduce));
  const seated = [...game.players].sort((a, b) => a.seat - b.seat);
  const start = Math.max(0, seated.findIndex((p) => p.id === record.leaderId));
  const order = seated
    .map((_, i) => seated[(start + i) % seated.length]!.id)
    .flatMap((playerId) => record.votes.filter((v) => v.playerId === playerId));
  const [landed, setLanded] = useState(() => reduce ? order.length : 0);
  const [verdict, setVerdict] = useState(reduce);
  const stones = useRef(new Map<string, HTMLElement>());
  useSoundCue(landed > 0 && !reduce && 'stone', { key: landed });

  useLayoutEffect(() => {
    if (reduce) return;
    const flights = order.map((vote, i) => {
      const stone = stones.current.get(vote.playerId);
      if (!stone) return null;
      const to = stone.getBoundingClientRect();
      const icon = document.querySelector(`[data-seat-card="${vote.playerId}"] .table-card-front .table-card-icon`);
      const from = icon?.getBoundingClientRect();
      const options = { duration: timeline.flight, delay: timeline.stones[i], fill: 'backwards' as const };
      const flight = from?.width
        ? (() => {
            const dx = from.left + from.width / 2 - (to.left + to.width / 2);
            const dy = from.top + from.height / 2 - (to.top + to.height / 2);
            const scale = from.width / to.width;
            return stone.animate([
              { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0 },
              { transform: `translate(${dx}px, ${dy - 6}px) scale(${scale * 1.1})`, opacity: 1, offset: 0.12 },
              { transform: `translate(${dx * 0.45}px, ${Math.min(dy * 0.45, 0) - 34}px) scale(${Math.max(scale, 1) * 1.15})`, offset: 0.55 },
              { transform: 'translate(0, 0) scale(1)', opacity: 1 },
            ], { ...options, easing: 'cubic-bezier(0.45, 0, 0.3, 1)' });
          })()
        : stone.animate([{ opacity: 0, transform: 'scale(1.6)' }, { opacity: 1, transform: 'scale(1)' }], options);
      flight.onfinish = () => setLanded((n) => n + 1);
      // The ballot keeps only the hollow its stone was lifted from.
      const hollow = icon?.animate([{ opacity: 1 }, { opacity: 0.18, filter: 'grayscale(1)' }],
        { duration: 160, delay: timeline.stones[i], fill: 'forwards' });
      return [flight, hollow];
    });
    return () => flights.flat().forEach((animation) => animation?.cancel());
    // The flights are planned once, from where the cards lie when the count begins.
  }, []);
  useEffect(() => {
    if (reduce) return;
    const timer = setTimeout(() => setVerdict(true), timeline.verdict);
    return () => clearTimeout(timer);
  }, [reduce, timeline.verdict]);

  const landedVotes = order.slice(0, landed);
  const tally = (side: VoteValue) => (verdict ? record.votes : landedVotes).filter((v) => v.vote === side).length;
  const winner: VoteValue = record.approved ? 'approve' : 'reject';
  return (
    <>
      <div className="table-board-title">
        <motion.h2
          key={verdict ? 'verdict' : 'count'}
          className={`table-phase-title${verdict ? ' vote-verdict' : ''}`}
          data-result={winner}
          aria-live="polite"
          initial={reduce || !verdict ? false : { opacity: 0, scale: 1.6, filter: 'blur(8px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          transition={{ type: 'spring', stiffness: 300, damping: 18, filter: { type: 'tween', duration: 0.35, ease: 'easeOut' } }}
        >
          {verdict ? t(record.approved ? 'cue.voteApproved' : 'cue.voteRejected') : t('cue.voteCount')}
          {verdict && !record.approved && <RejectionFlight key={id} slot={record.proposalIndex} />}
        </motion.h2>
      </div>
      <div className="table-board-body">
        {team}
        <div className="vote-tally" data-verdict={verdict ? winner : undefined}
          aria-label={t('vote.tally', { approves: tally('approve'), rejects: tally('reject') })}>
          {SIDES.map((side) => (
            <div key={side} className="vote-pan" data-side={side}>
              <span className="vote-pan-stones" aria-hidden="true">
                {order.filter((v) => v.vote === side).map((v) => (
                  <span key={v.playerId} className="vote-pan-stone"
                    ref={(el) => { if (el) stones.current.set(v.playerId, el); else stones.current.delete(v.playerId); }}>
                    <GameIcon name={side} className="h-full w-full" />
                  </span>
                ))}
              </span>
              <b key={tally(side)} className="vote-pan-count" aria-hidden="true">{tally(side)}</b>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
