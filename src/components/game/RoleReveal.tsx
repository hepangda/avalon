import { Button } from '@/components/ui/Button';
import { useAuthIdentity } from '@/lib/auth/useAuthIdentity';
import type { ClientGameState } from '@/lib/engine';
import { gameActions } from '@/lib/socket/client';
import { useSceneGate } from '@/lib/store/sceneGate';
import { cn } from '@/lib/utils/cn';
import { animate, motion, useReducedMotion, type Transition } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { GameIcon } from './GameArt';
import { RoleCard } from './RoleCard';
import { RoleKnowledge } from './RoleKnowledge';
import { flyToChip, returnToCenter } from './cardFlight';

interface RoleRevealProps {
  onAck?: typeof gameActions.ackRole;
  onReroll?: typeof gameActions.useRerollCard;
  blocked?: boolean;
  game: ClientGameState;
  myPlayerId: string | null;
  timer?: ReactNode;
}

/** Why the reroll button is disabled, as a message key; the most lasting reason wins. */
export function rerollHintKey({ open, signedIn, cards, connected }: { open: boolean; signedIn: boolean; cards: number; connected: boolean }): string | null {
  if (!open) return 'reroll.unavailable';
  if (!signedIn) return 'reroll.loginShort';
  if (!cards) return 'reroll.empty';
  if (!connected) return 'reroll.reconnecting';
  return null;
}

/**
 * The deal, played on the real table: the opening deck lies face up, turns over card
 * by card, is shuffled and dealt to every seat. A reroll reshuffles the whole table,
 * so its deal starts by gathering the cards back from the seats.
 */
type Stage = 'fan' | 'flip' | 'gather' | 'shuffle' | 'deal' | 'dealt' | 'reveal';

interface Point { x: number; y: number }
interface Geometry {
  /** Deck card size; seats scale it down to their card frame. */
  width: number;
  height: number;
  center: Point;
  fan: Array<Point & { rotate: number }>;
  /** In deal order, which is seat order. */
  seats: Array<Point & { scale: number }>;
}

type Pose = { x: number; y: number; rotate: number; scale: number; opacity: number };
type PoseFrames = Omit<Pose, 'x' | 'y' | 'rotate'> & Record<'x' | 'y' | 'rotate', number | number[]>;

const FAN_STAGGER = 0.06;
const FLIP_STAGGER = 0.09;
const DEAL_STAGGER = 0.1;
/** How long the dealt card rests at its seat before the player picks it up. */
const PICKUP_DELAY = 0.75;
/** Lifting the card off the table into the player's hand, face down. */
const LIFT = 0.75;
/** Putting the read card away into the dock's identity card. */
const STOW = 0.75;
/** Turning it over when the player taps: peek under a corner, then flip. */
const TURN = { duration: 1, times: [0, 0.3, 0.45, 1] };
const EASE_OUT = [0.2, 0.8, 0.25, 1] as const;

/** Card centers in the layer's own coordinates, so a transformed host (the debug gallery) still lines up. */
function measure(layer: HTMLElement, seatIds: string[]): Geometry | null {
  const table = layer.parentElement?.querySelector<HTMLElement>('.game-table');
  const middle = table?.querySelector<HTMLElement>('.table-center');
  if (!table || !middle) return null;
  const origin = layer.getBoundingClientRect();
  const box = middle.getBoundingClientRect();
  const n = seatIds.length;
  // The caption sits under the deck, inside the same middle band as the cards.
  const captionSpace = 26;
  let height = Math.min((box.height - captionSpace) * 0.9, 176);
  let width = (height * 2) / 3;
  let step = width * 0.64;
  const fit = Math.min(1, (box.width - 24) / (width + (n - 1) * step));
  height *= fit;
  width *= fit;
  step *= fit;
  const center = { x: box.left - origin.left + box.width / 2, y: box.top - origin.top + (box.height - captionSpace) / 2 };
  const fan = seatIds.map((_, i) => {
    const offset = i - (n - 1) / 2;
    return { x: center.x + offset * step, y: center.y + offset * offset * height * 0.014, rotate: offset * 2.6 };
  });
  const seats = seatIds.map((id) => {
    const zone = table.querySelector<HTMLElement>(`[data-seat-card="${CSS.escape(id)}"]`)?.getBoundingClientRect();
    if (!zone) return { ...center, scale: 0.4 };
    return {
      x: zone.left - origin.left + zone.width / 2,
      y: zone.top - origin.top + zone.height / 2,
      scale: Math.min(zone.height / height, zone.width / width),
    };
  });
  return { width, height, center, fan, seats };
}

function dealtKey(game: ClientGameState, playerId: string | null) {
  return game.gameId && playerId ? `avalon:dealt:${game.gameId}:${playerId}:${game.roleRevision ?? 0}` : null;
}

function rememberDeal(key: string | null) {
  if (!key) return;
  try { sessionStorage.setItem(key, '1'); } catch { /* the deal simply replays */ }
}

function dealSeen(key: string | null) {
  if (!key) return false;
  try { return sessionStorage.getItem(key) === '1'; } catch { return false; }
}

export function RoleReveal({ game, myPlayerId, onAck = gameActions.ackRole, onReroll = gameActions.useRerollCard, blocked = false, timer }: RoleRevealProps) {
  const t = useTranslations();
  const { user, refresh } = useAuthIdentity();
  const [rerolling, setRerolling] = useState(false);
  const [confirmReroll, setConfirmReroll] = useState(false);
  const rerollInFlight = useRef(false);
  useEffect(() => { setConfirmReroll(false); }, [game.gameId, game.roleRevision, myPlayerId, user?.id, blocked, game.canRerollOpening]);
  useEffect(() => { void refresh(); }, [refresh, game.gameId]);
  const reduceMotion = !!useReducedMotion();
  const [acking, setAcking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const role = game.selfRole;
  const variant = game.players.find((p) => p.id === myPlayerId)?.roleVariant;
  const knownPlayers = game.knownPlayers;
  const cards = user?.rerollCards?.cards ?? 0;
  const rerollHint = rerollHintKey({ open: game.canRerollOpening, signedIn: !!user, cards, connected: !blocked });
  const showRerollHint = !error && !acking && !rerolling && rerollHint !== null;

  const seatOrder = useMemo(() => [...game.players].sort((a, b) => a.seat - b.seat), [game.players]);
  const seatIds = useMemo(() => seatOrder.map((p) => p.id), [seatOrder]);
  const mySlot = seatIds.indexOf(myPlayerId ?? '');
  /** Duplicate roles show their alternate art, as a real deck would. */
  const deck = useMemo(() => game.config.rolesInPlay.map((r, i, all) => ({
    role: r,
    variant: all.slice(0, i).filter((other) => other === r).length,
  })), [game.config.rolesInPlay]);
  const n = seatIds.length;
  const opening = (game.roleRevision ?? 0) === 0;
  const storageKey = dealtKey(game, myPlayerId);
  const [stage, setStage] = useState<Stage>(() =>
    reduceMotion || dealSeen(storageKey) ? 'dealt' : opening ? 'fan' : 'gather');
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [measured, setMeasured] = useState(false);
  const layerRef = useRef<HTMLDivElement>(null);
  const myCardRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const rotorRef = useRef<HTMLDivElement>(null);
  const ceremony = stage !== 'dealt' && stage !== 'reveal';

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const update = () => setGeometry(measure(layer, seatIds));
    update();
    setMeasured(true);
    const table = layer.parentElement?.querySelector('.game-table');
    const observer = new ResizeObserver(update);
    if (table) observer.observe(table);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [seatIds]);

  // Without a table to deal onto there is nothing to stage: show the card itself.
  useEffect(() => {
    if (measured && !geometry && stage !== 'reveal') setStage('reveal');
  }, [measured, geometry, stage]);

  // A background tab would run the schedule unseen, so the deal waits for its audience.
  const [watching, setWatching] = useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => {
    if (watching) return;
    const wake = () => { if (!document.hidden) setWatching(true); };
    document.addEventListener('visibilitychange', wake);
    return () => document.removeEventListener('visibilitychange', wake);
  }, [watching]);

  // Nor does it start behind the gate from the lobby.
  const gateOpen = useSceneGate((s) => s.phase === 'idle');
  const live = watching && gateOpen;

  const hasGeometry = !!geometry;
  useEffect(() => {
    if (!hasGeometry || !ceremony || !live) return;
    const fanIn = 0.15 + (n - 1) * FAN_STAGGER + 0.5 + 0.5;
    const flip = (n - 1) * FLIP_STAGGER + 0.45 + 0.3;
    const gather = 0.5;
    const shuffle = 1.35;
    const dealing = (n - 1) * DEAL_STAGGER + 0.55;
    const plan: Array<[Stage, number]> = opening
      ? [['flip', fanIn], ['gather', fanIn + flip], ['shuffle', fanIn + flip + gather], ['deal', fanIn + flip + gather + shuffle], ['dealt', fanIn + flip + gather + shuffle + dealing]]
      : [['shuffle', gather + 0.1], ['deal', gather + 0.1 + shuffle], ['dealt', gather + 0.1 + shuffle + dealing]];
    const timers = plan
      .filter(([, at]) => at > 0)
      .map(([next, at]) => setTimeout(() => setStage((current) => current === 'dealt' || current === 'reveal' ? current : next), at * 1000));
    return () => timers.forEach(clearTimeout);
    // The schedule is fixed when the deal begins; skipping cancels it through `ceremony`.
  }, [hasGeometry, ceremony, live]);

  useEffect(() => {
    if (stage === 'dealt') rememberDeal(storageKey);
    if (stage === 'dealt') myCardRef.current?.focus({ preventScroll: true });
  }, [stage, storageKey]);

  // Once the deal settles the player picks up their own card; turning it over is theirs to do.
  useEffect(() => {
    if (stage !== 'dealt' || !live) return;
    const timer = setTimeout(() => setStage((current) => current === 'dealt' ? 'reveal' : current), reduceMotion ? 0 : PICKUP_DELAY * 1000);
    return () => clearTimeout(timer);
  }, [stage, live, reduceMotion]);

  useEffect(() => { layerRef.current?.focus({ preventScroll: true }); }, []);

  const skip = useCallback(() => {
    if (ceremony) setStage('dealt');
  }, [ceremony]);

  const [faceUp, setFaceUp] = useState(false);
  const [held, setHeld] = useState(false);

  // Pick the dealt card up from its seat and hold it face down until the player turns it over.
  useLayoutEffect(() => {
    if (stage !== 'reveal') return;
    const layer = layerRef.current;
    const pop = popRef.current;
    if (!layer || !pop) return;
    const seat = geometry?.seats[mySlot];
    const settle = () => {
      setHeld(true);
      pop.focus({ preventScroll: true });
    };
    if (reduceMotion || !geometry || !seat) {
      pop.style.opacity = '1';
      settle();
      return;
    }
    const origin = layer.getBoundingClientRect();
    const box = pop.getBoundingClientRect();
    const dx = seat.x - (box.left - origin.left + box.width / 2);
    const dy = seat.y - (box.top - origin.top + box.height / 2);
    const scale = (geometry.height * seat.scale) / box.height;
    void animate(pop, {
      x: [dx, 0, 0],
      y: [dy, -6, 0],
      scale: [scale, 1.03, 1],
      rotate: [0, -5, -3],
      opacity: [1, 1, 1],
    }, { duration: LIFT, times: [0, 0.75, 1], ease: [EASE_OUT, 'easeInOut'] }).then(settle);
    // Only the moment of lifting matters; later resizes keep the card centered by layout.
  }, [stage]);

  function turnOver() {
    if (faceUp || !held) return;
    setFaceUp(true);
    const pop = popRef.current;
    const rotor = rotorRef.current;
    if (!pop || !rotor) return;
    if (reduceMotion) {
      void animate(rotor, { rotateY: 0 }, { duration: 0 });
      return;
    }
    void animate(rotor, {
      rotateY: [180, 156, 154, 0],
      rotateX: [0, 10, 8, 0],
    }, { ...TURN, ease: ['easeOut', 'linear', [0.3, 0, 0.2, 1]] });
    void animate(pop, { rotate: [-3, -3, 0] }, { duration: TURN.duration, times: [0, 0.45, 1], ease: 'easeOut' });
  }

  const [stowed, setStowed] = useState(false);

  /** Turn the card face down and slide it into the identity card at the dock; resolves when it lands. */
  async function stow() {
    setStowed(true);
    const pop = popRef.current;
    const rotor = rotorRef.current;
    if (!pop || !rotor || reduceMotion) return;
    await flyToChip(pop, rotor, document.querySelector<HTMLElement>('.identity-chip'), STOW);
  }

  /** Bring the card back out when the room did not take the acknowledgement. */
  function unstow() {
    setStowed(false);
    const pop = popRef.current;
    const rotor = rotorRef.current;
    if (pop && rotor) returnToCenter(pop, rotor, reduceMotion ? 0 : 0.45);
  }

  async function handleAck() {
    // The overlay closes when roleAcks (in projected state) includes us; no need
    // to track a local "waiting" state — each player enters independently.
    if (acking || rerollInFlight.current || blocked) return;
    setConfirmReroll(false);
    setAcking(true);
    setError(null);
    await stow();
    try {
      const res = await onAck(game.roleRevision ?? 0);
      if (!res.ok) {
        setError(res.error?.message ?? t('table.actionFailed'));
        setAcking(false);
        unstow();
      }
    } catch {
      setError(t('table.actionFailed'));
      setAcking(false);
      unstow();
    }
  }

  async function handleReroll() {
    if (rerollInFlight.current || acking || blocked || !cards || !game.canRerollOpening) return;
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

  function cardMotion(i: number): { initial: Pose | false; animate: PoseFrames; transition: Transition; faceUp: boolean; flipDelay: number } {
    const g = geometry!;
    const slot = n - 1 - i; // the top of the deck is dealt first
    const place = (p: Point, rotate = 0, scale = 1): Pose => ({ x: p.x - g.width / 2, y: p.y - g.height / 2, rotate, scale, opacity: 1 });
    const stack = place({ x: g.center.x + i * 0.3, y: g.center.y - i * 0.7 }, ((i % 3) - 1) * 0.9);
    const seat = g.seats[slot]!;
    const atSeat = place(seat, 0, seat.scale);
    const fan = g.fan[i]!;
    const initial = !ceremony
      ? false
      : opening
        ? { ...place(g.center), opacity: 0, scale: 0.86 }
        : atSeat;
    switch (stage) {
      case 'fan':
        return { initial, animate: place(fan, fan.rotate), transition: { delay: 0.15 + i * FAN_STAGGER, duration: 0.5, ease: EASE_OUT }, faceUp: true, flipDelay: 0 };
      case 'flip':
        return { initial, animate: place(fan, fan.rotate), transition: { duration: 0.3 }, faceUp: false, flipDelay: i * FLIP_STAGGER };
      case 'gather':
        return { initial, animate: stack, transition: { delay: opening ? i * 0.02 : slot * 0.03, duration: 0.45, ease: 'easeInOut' }, faceUp: false, flipDelay: 0 };
      case 'shuffle': {
        const side = i % 2 ? 1 : -1;
        const reach = g.width * 0.62;
        return {
          initial,
          animate: {
            ...stack,
            x: [stack.x, stack.x + side * reach, stack.x, stack.x + side * reach, stack.x],
            y: [stack.y, stack.y - 5, stack.y, stack.y - 5, stack.y],
            rotate: [stack.rotate, side * 8, stack.rotate, side * 8, stack.rotate],
          },
          transition: { duration: 1.25, delay: i * 0.008, times: [0, 0.24, 0.5, 0.74, 1], ease: 'easeInOut' },
          faceUp: false,
          flipDelay: 0,
        };
      }
      case 'deal': {
        // Each card spins a little as it slides across the felt, as a flicked card does.
        const spin = (slot % 2 ? 1 : -1) * (10 + (slot % 3) * 4);
        return {
          initial,
          animate: { ...atSeat, x: [stack.x, atSeat.x], y: [stack.y, atSeat.y], rotate: [stack.rotate, spin, 0], scale: atSeat.scale },
          transition: { delay: slot * DEAL_STAGGER, duration: 0.55, ease: EASE_OUT, rotate: { delay: slot * DEAL_STAGGER, duration: 0.55, times: [0, 0.55, 1], ease: 'easeOut' } },
          faceUp: false,
          flipDelay: 0,
        };
      }
      default:
        return { initial, animate: atSeat, transition: { duration: reduceMotion ? 0 : 0.3, ease: 'easeOut' }, faceUp: false, flipDelay: 0 };
    }
  }

  const caption = !geometry || !live ? null
    : stage === 'fan' || stage === 'flip' ? t('lobby.rolesInPlay', { count: n })
    : stage === 'gather' || stage === 'shuffle' ? t('table.shuffling')
    : stage === 'deal' ? t('roleReveal.dealing')
    : null;

  return (
    <motion.div
      ref={layerRef}
      className="role-deal"
      data-stage={stage}
      role="dialog"
      aria-modal="true"
      aria-label={t('roleReveal.title')}
      tabIndex={-1}
      exit={{ opacity: 0, transition: { duration: reduceMotion ? 0 : 0.35 } }}
      onClick={skip}
      onKeyDown={(event) => {
        if (ceremony && (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape')) {
          event.preventDefault();
          skip();
        }
      }}
    >
      {geometry && (live || !ceremony) && deck.map((card, i) => {
        const slot = n - 1 - i;
        const owner = seatOrder[slot];
        const mine = slot === mySlot;
        const motionProps = cardMotion(i);
        const canOpen = mine && stage === 'dealt';
        return (
          <motion.div
            key={i}
            ref={mine ? myCardRef : undefined}
            className={cn('role-deal-card', mine && 'is-mine')}
            style={{ width: geometry.width, height: geometry.height, zIndex: i + 1, visibility: mine && stage === 'reveal' ? 'hidden' : undefined }}
            data-ready={!ceremony && !mine && owner && game.roleAcks.includes(owner.id) ? '' : undefined}
            initial={motionProps.initial}
            animate={motionProps.animate}
            transition={motionProps.transition}
            role={canOpen ? 'button' : undefined}
            tabIndex={canOpen ? 0 : undefined}
            aria-label={canOpen ? t('roleReveal.tapToReveal') : undefined}
            aria-hidden={canOpen ? undefined : true}
            onClick={canOpen ? (event) => { event.stopPropagation(); setStage('reveal'); } : undefined}
            onKeyDown={canOpen ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                setStage('reveal');
              }
            } : undefined}
          >
            <motion.div
              className="role-deal-rotor"
              initial={motionProps.initial === false || !opening ? { rotateY: 180 } : { rotateY: 0 }}
              animate={{ rotateY: motionProps.faceUp ? 0 : 180 }}
              transition={{ delay: motionProps.flipDelay, duration: reduceMotion ? 0 : 0.45, ease: 'easeInOut' }}
            >
              {opening && ceremony && (
                <div className="role-deal-face">
                  <RoleCard role={card.role} variant={card.variant} size="table" />
                </div>
              )}
              <div className="role-deal-face role-deal-back">
                <GameIcon name="crest" className="role-deal-crest" />
              </div>
            </motion.div>
            <span className="role-deal-ready" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 10.5 3.2 3.2L15 7" />
              </svg>
            </span>
          </motion.div>
        );
      })}

      {caption && geometry && (
        <motion.p
          key={caption}
          className="role-deal-caption"
          role="status"
          style={{ left: geometry.center.x, top: geometry.center.y + geometry.height / 2 + 6 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {caption}
        </motion.p>
      )}

      {stage === 'reveal' && (
        <>
          <motion.div
            className="role-deal-scrim"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: stowed ? 0 : 1 }}
            transition={{ duration: reduceMotion ? 0 : stowed ? STOW * 0.8 : 0.4 }}
          />
          <div className="role-deal-reveal" onClick={(event) => event.stopPropagation()}>
            {timer && <motion.div className="role-deal-timer" animate={{ opacity: stowed ? 0 : 1 }} transition={{ duration: 0.2 }}>{timer}</motion.div>}
            <div className="role-deal-frame">
              <div
                ref={popRef}
                className="role-deal-pop"
                style={{ opacity: 0 }}
                data-held={held && !faceUp ? '' : undefined}
                role={faceUp ? undefined : 'button'}
                tabIndex={faceUp ? undefined : 0}
                aria-label={faceUp ? undefined : t('roleReveal.tapToReveal')}
                onClick={turnOver}
                onKeyDown={(event) => {
                  if (!faceUp && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    turnOver();
                  }
                }}
              >
                <div ref={rotorRef} className="identity-card-rotor" style={{ transform: 'rotateY(180deg)' }}>
                  <div className="identity-card-face">
                    {role && <RoleCard role={role} variant={variant} />}
                  </div>
                  <div className="identity-card-face identity-card-back" aria-hidden="true">
                    <GameIcon name="crest" className="w-1/3 drop-shadow-[0_0_16px_rgba(201,162,39,0.35)]" />
                  </div>
                </div>
              </div>
            </div>
            <motion.div
              className="role-deal-details"
              style={{ visibility: faceUp ? undefined : 'hidden', pointerEvents: stowed ? 'none' : undefined }}
              initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
              animate={faceUp && !stowed ? { opacity: 1, y: 0 } : { opacity: 0, y: reduceMotion ? 0 : 10 }}
              transition={{ delay: faceUp && !stowed && !reduceMotion ? TURN.duration * 0.8 : 0, duration: stowed ? 0.18 : 0.3 }}
            >
              <RoleKnowledge game={game} knownPlayers={knownPlayers} />
              <div className="flex w-full items-stretch gap-2">
                <Button className="w-36 shrink-0 whitespace-nowrap px-3" variant="secondary" onClick={handleReroll}
                  onBlur={() => setConfirmReroll(false)}
                  onKeyDown={(event) => { if (event.key === 'Escape') setConfirmReroll(false); }}
                  aria-describedby={showRerollHint ? 'reroll-hint' : undefined}
                  disabled={blocked || acking || rerolling || !cards || !game.canRerollOpening}>
                  {rerolling ? t('reroll.using') : confirmReroll ? t('reroll.confirm') : t('reroll.button', { count: cards })}
                </Button>
                <Button className="min-w-0 flex-1 whitespace-nowrap" onClick={handleAck} disabled={acking || rerolling || blocked}>
                  {acking ? t('roleReveal.entering') : t('roleReveal.understand')}
                </Button>
              </div>
              {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
              {showRerollHint && <p id="reroll-hint" className="text-xs text-parchment/50">{t(rerollHint)}</p>}
            </motion.div>
          </div>
        </>
      )}
    </motion.div>
  );
}
