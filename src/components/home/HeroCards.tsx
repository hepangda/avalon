import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { GameIcon } from '@/components/game/GameArt';
import type { Role } from '@/lib/engine';
import { CARD_DECKS } from '@/lib/game/cardDecks';
import { ROLE_TEAM_UI, roleArt, type CardArtStyle } from '@/lib/game/roleMeta';
import { useCardArtStore } from '@/lib/store/cardArt';
import { cn } from '@/lib/utils/cn';

const OPENING: readonly Role[] = ['Morgana', 'Merlin', 'Assassin'];
/** Time from one slide to the next, and the length of the slide itself (matches home.css). */
const INTERVAL_MS = 3500;
const SLIDE_MS = 700;

/** -1, 0 and 1 are the visible fan; -2 and 2 sit just outside it, faded out. */
interface FanCard { id: number; src: string; pos: number }

/** Every card in the deck, alternate art included, in a fresh random order. */
function shuffledDeck(style: CardArtStyle): string[] {
  const cards: string[] = [];
  for (const role of Object.keys(ROLE_TEAM_UI) as Role[]) {
    const count = CARD_DECKS[style].variants[role]?.length ?? 1;
    for (let variant = 0; variant < count; variant++) cards.push(roleArt(role, variant, style).card);
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j]!, cards[i]!];
  }
  return cards;
}

function openingFan(style: CardArtStyle): FanCard[] {
  return OPENING.map((role, index) => ({ id: index, src: roleArt(role, 0, style).card, pos: index - 1 }));
}

function Fan({ style }: { style: CardArtStyle }) {
  const [cards, setCards] = useState(() => openingFan(style));

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const deck = shuffledDeck(style);
    let visible = openingFan(style).map((card) => card.src);
    let nextId = visible.length;
    let drawn = 0;
    let cancelled = false;
    const timers = new Set<number>();
    const frames = new Set<number>();
    const later = (run: () => void, ms: number) => {
      const id = window.setTimeout(() => { timers.delete(id); run(); }, ms);
      timers.add(id);
    };
    const nextFrame = (run: () => void) => {
      const id = window.requestAnimationFrame(() => { frames.delete(id); run(); });
      frames.add(id);
    };

    async function slide() {
      if (document.visibilityState !== 'visible') return later(slide, INTERVAL_MS);
      let src = deck[drawn++ % deck.length]!;
      while (visible.includes(src)) src = deck[drawn++ % deck.length]!;
      try {
        // Slide a card in only once its face is decoded, so it never arrives blank.
        const image = new Image();
        image.src = src;
        await image.decode();
      } catch {
        if (!cancelled) later(slide, INTERVAL_MS);
        return;
      }
      if (cancelled) return;
      visible = [...visible.slice(1), src];
      // Mount the newcomer off to the right, let it paint there, then move every card one place left.
      flushSync(() => setCards((current) => [...current, { id: nextId++, src, pos: 2 }]));
      nextFrame(() => nextFrame(() => {
        setCards((current) => current.map((card) => ({ ...card, pos: card.pos - 1 })));
        later(() => setCards((current) => current.filter((card) => card.pos >= -1)), SLIDE_MS + 50);
      }));
      later(slide, INTERVAL_MS);
    }

    later(slide, INTERVAL_MS);
    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
      frames.forEach((id) => window.cancelAnimationFrame(id));
    };
  }, [style]);

  return (
    <div className="home-fan" aria-hidden="true">
      {cards.map((card) => (
        <div key={card.id} data-pos={card.pos} className={cn('home-fan-card', card.id < OPENING.length && 'home-fan-card--deal')}>
          <img
            src={card.src}
            alt=""
            width={1024}
            height={1536}
            draggable={false}
            decoding="async"
            className="home-fan-face"
          />
        </div>
      ))}
      <GameIcon name="crest" className="home-fan-crest" />
    </div>
  );
}

/** Decorative fan from the selected deck, sealed with the crest; it slides on to a new card every few seconds. */
export function HeroCards() {
  const style = useCardArtStore((state) => state.style);
  // A new deck deals a fresh fan.
  return <Fan key={style} style={style} />;
}
