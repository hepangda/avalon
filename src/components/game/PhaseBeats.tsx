import { useLayoutEffect, useRef } from 'react';
import { useTranslations } from 'use-intl';
import type { PhaseBeat, PhaseBeatSet } from '@/lib/game/phaseBeats';
import { GameIcon } from './GameArt';

const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.25, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.5, 0, 0.2, 1)';
const GOLD = '230 193 74';
const SKY = '159 203 224';

function center(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function seatAvatar(root: Element, id: string) {
  return root.querySelector(`[data-seat-card="${CSS.escape(id)}"]`)?.parentElement?.querySelector<HTMLElement>('.table-seat-number') ?? null;
}

/** Light each card place in turn; the sweep fits inside the beat however many seats there are. */
function sweep(root: Element, order: string[], rgb: string, animations: Animation[]) {
  const stagger = Math.min(70, 520 / Math.max(1, order.length));
  order.forEach((id, index) => {
    const slot = root.querySelector<HTMLElement>(`[data-seat-card="${CSS.escape(id)}"] > .table-card-slot`);
    if (!slot) return;
    animations.push(slot.animate([
      { boxShadow: `0 0 0 0 rgb(${rgb} / 0)`, transform: 'translateY(0) scale(1)' },
      { boxShadow: `0 0 0 1.5px rgb(${rgb} / 0.95), 0 0 18px 3px rgb(${rgb} / 0.5)`, backgroundColor: `rgb(${rgb} / 0.16)`, transform: 'translateY(-3px) scale(1.07)', offset: 0.35 },
      { boxShadow: `0 0 0 0 rgb(${rgb} / 0)`, transform: 'translateY(0) scale(1)' },
    ], { duration: 460, delay: index * stagger, easing: 'ease-out' }));
  });
}

function play(beat: PhaseBeat, layer: HTMLElement, card: HTMLElement | null, crown: HTMLElement | null, animations: Animation[], cleanups: Array<() => void>) {
  const root = layer.parentElement!;
  const origin = layer.getBoundingClientRect();
  const local = (rect: DOMRect) => ({ x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height });
  if (beat.kind === 'round' && card) {
    // The quest's medallion opens out into a title over the felt, then folds back into the track.
    const medal = root.closest('.table-play')?.querySelector<HTMLElement>('.table-missions [aria-current="step"] .table-mission-token');
    const felt = root.querySelector('.table-center')?.getBoundingClientRect();
    if (!felt) return;
    const middle = center(felt);
    card.style.left = `${middle.x - origin.left}px`;
    card.style.top = `${middle.y - origin.top}px`;
    const box = card.getBoundingClientRect();
    const from = medal ? center(medal.getBoundingClientRect()) : { x: middle.x, y: felt.top };
    const dx = from.x - middle.x;
    const dy = from.y - middle.y;
    const scale = medal ? medal.offsetWidth / box.width : 0.2;
    const folded = `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${scale})`;
    const open = 'translate(-50%, -50%) translate(0, 0) scale(1)';
    animations.push(card.animate([
      { transform: folded, opacity: 0, offset: 0 },
      { transform: folded, opacity: 1, offset: 0.04, easing: EASE_OUT },
      { transform: open, opacity: 1, offset: 0.3, easing: 'linear' },
      { transform: 'translate(-50%, -50%) translate(0, 0) scale(1.03)', opacity: 1, offset: 0.68, easing: EASE_IN_OUT },
      { transform: folded, opacity: 0.9, offset: 0.96 },
      { transform: folded, opacity: 0, offset: 1 },
    ], { duration: 1080, fill: 'both' }));
    for (const part of card.querySelectorAll('.table-round-text'))
      animations.push(part.animate([
        { opacity: 0 }, { opacity: 0, offset: 0.2 }, { opacity: 1, offset: 0.34 }, { opacity: 1, offset: 0.62 }, { opacity: 0, offset: 0.74 }, { opacity: 0 },
      ], { duration: 1080, fill: 'both' }));
    if (medal)
      animations.push(medal.animate([
        { transform: 'scale(1)' }, { transform: 'scale(1)', offset: 0.9 }, { transform: 'scale(1.25)', offset: 0.95 }, { transform: 'scale(1)' },
      ], { duration: 1200 }));
  }
  if (beat.kind === 'crown' && crown) {
    const leaving = seatAvatar(root, beat.from);
    const arriving = seatAvatar(root, beat.to)?.querySelector('.table-leader-icon');
    if (!leaving || !arriving) return;
    const end = local(arriving.getBoundingClientRect());
    const seat = local(leaving.getBoundingClientRect());
    // The crown rests on the portrait's upper right (see .table-leader-icon).
    const start = { x: seat.x + seat.width + 7 - end.width, y: seat.y - 8 };
    crown.style.left = `${end.x}px`;
    crown.style.top = `${end.y}px`;
    crown.style.width = `${end.width}px`;
    crown.style.height = `${end.height}px`;
    const dx = start.x - end.x;
    const dy = start.y - end.y;
    const lift = Math.min(70, 24 + Math.abs(dx) * 0.12 + Math.abs(dy) * 0.08);
    root.dataset.crownFlight = '';
    cleanups.push(() => { delete root.dataset.crownFlight; });
    const flight = crown.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(1) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) scale(1.9) rotate(-10deg)`, opacity: 1, offset: 0.5 },
      { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
    ], { duration: 720, easing: 'cubic-bezier(0.35, 0, 0.25, 1)', fill: 'both' });
    animations.push(flight);
    flight.finished.then(() => {
      delete root.dataset.crownFlight;
      crown.style.opacity = '0';
      const portrait = seatAvatar(root, beat.to);
      if (portrait) animations.push(portrait.animate([
        { transform: 'scale(1)' },
        { transform: 'scale(1.12)', boxShadow: `0 0 0 3px #231e16, 0 0 0 5px rgb(${GOLD} / 0.9), 0 0 26px rgb(${GOLD} / 0.6)`, offset: 0.4 },
        { transform: 'scale(1)' },
      ], { duration: 360, easing: 'cubic-bezier(0.3, 1.4, 0.5, 1)' }));
    }, () => {});
  }
  if (beat.kind === 'team') {
    // Each portrait steps off its seat and takes its place in the middle.
    beat.team.forEach((id, index) => {
      const token = root.querySelector<HTMLElement>(`.table-team-chip[data-player-id="${CSS.escape(id)}"] .table-team-avatar`);
      const seat = seatAvatar(root, id);
      if (!token || !seat) return;
      const to = center(token.getBoundingClientRect());
      const from = center(seat.getBoundingClientRect());
      const scale = seat.offsetWidth / Math.max(1, token.offsetWidth);
      animations.push(token.animate([
        { transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${scale})`, opacity: 0.4 },
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      ], { duration: 560, delay: index * 70, easing: EASE_OUT, fill: 'backwards' }));
    });
  }
  if (beat.kind === 'ballots' || beat.kind === 'quest') {
    sweep(root, beat.order, beat.kind === 'quest' ? SKY : GOLD, animations);
    // The team closes ranks before the table decides on it.
    const chips = [...root.querySelectorAll<HTMLElement>('.table-team-chip:not(.is-open)')];
    const row = root.querySelector('.table-team-chips')?.getBoundingClientRect();
    if (row)
      for (const chip of chips) {
        const offset = center(chip.getBoundingClientRect()).x - center(row).x;
        animations.push(chip.animate([
          { transform: 'translateX(0) scale(1)' },
          { transform: `translateX(${-offset * 0.12}px) scale(1.06)`, offset: 0.4 },
          { transform: 'translateX(0) scale(1)' },
        ], { duration: 520, easing: EASE_IN_OUT }));
      }
  }
}

/** One layer over the table; every beat is decoration and never holds the controls. */
export function PhaseBeats({ beat }: { beat: PhaseBeatSet | null }) {
  const t = useTranslations();
  const layer = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const crown = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!beat || !layer.current) return;
    const animations: Animation[] = [];
    const cleanups: Array<() => void> = [];
    for (const item of beat.beats) play(item, layer.current, card.current, crown.current, animations, cleanups);
    // A newer state cancels the beat outright; the table underneath is already current.
    return () => {
      for (const animation of animations) animation.cancel();
      for (const cleanup of cleanups) cleanup();
    };
  }, [beat]);
  const round = beat?.beats.find((item) => item.kind === 'round');
  const flight = beat?.beats.some((item) => item.kind === 'crown');
  return (
    <div ref={layer} className="table-beat-layer" aria-hidden="true">
      {round && (
        <div key={`round-${beat!.id}`} ref={card} className="table-round-card">
          <span className="table-round-medal">
            <span>{round.size}</span>
            {round.needsTwo && <svg className="table-round-shield" viewBox="0 0 16 18" fill="none">
              <path d="M8 1.5 14 4v4.5c0 3.5-2.5 6-6 8-3.5-2-6-4.5-6-8V4l6-2.5Z" fill="currentColor" stroke="#16100a" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>}
          </span>
          <strong className="table-round-text table-round-title">{t('beat.questTitle', { n: round.roundIndex + 1 })}</strong>
          <span className="table-round-text table-round-detail">
            {t('beat.questSize', { count: round.size })}
            {round.needsTwo && <span className="table-round-needs-two">{t('beat.twoFails')}</span>}
          </span>
        </div>
      )}
      {flight && <span key={`crown-${beat!.id}`} ref={crown} className="table-crown-flight"><GameIcon name="leader" /></span>}
    </div>
  );
}
