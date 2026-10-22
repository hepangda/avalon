import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'use-intl';
import { EMOTES, EMOTE_GAP_MS, subscribeEmotes, type Emote } from '@/lib/game/emotes';
import { GameIcon } from './GameArt';

/** Game art for each reaction; the two spoken ones are struck as glyphs on a gilt seal. */
export function EmoteArt({ emote }: { emote: Emote }) {
  if (emote === 'question' || emote === 'ponder')
    return <span className="table-emote-glyph" data-emote={emote}>{emote === 'question' ? '?' : '…'}</span>;
  const icon = { approve: 'approve', reject: 'reject', trust: 'missionSuccess', suspect: 'assassinate' } as const;
  return <GameIcon name={icon[emote]} className="table-emote-icon" />;
}

function seatPortrait(layer: HTMLElement, playerId: string) {
  return layer.parentElement?.querySelector(`[data-seat-card="${CSS.escape(playerId)}"]`)?.parentElement
    ?.querySelector<HTMLElement>('.table-seat-number') ?? null;
}

interface Float { key: number; playerId: string; emote: Emote; x: number; y: number; rise: 'up' | 'down' }

/**
 * Reactions over the seats, and the fan the viewer opens from their own
 * portrait. Lives in the table's overlay; only the fan takes pointer input.
 */
export function TableEmotes({ anchor, onClose, onSend }: {
  /** The viewer's own portrait while the fan is open. */
  anchor: HTMLElement | null;
  onClose: () => void;
  onSend: (emote: Emote) => void;
}) {
  const t = useTranslations();
  const layer = useRef<HTMLDivElement>(null);
  const fan = useRef<HTMLDivElement>(null);
  const [floats, setFloats] = useState<Float[]>([]);
  const [fanAt, setFanAt] = useState<{ x: number; y: number } | null>(null);
  const [coolUntil, setCoolUntil] = useState(0);
  const [cooling, setCooling] = useState(false);
  const serial = useRef(0);

  useEffect(() => subscribeEmotes(({ playerId, emote }) => {
    const root = layer.current;
    const portrait = root && seatPortrait(root, playerId);
    if (!root || !portrait) return;
    const origin = root.getBoundingClientRect();
    const rect = portrait.getBoundingClientRect();
    const y = rect.top + rect.height / 2 - origin.top;
    // Reactions rise off the seat towards the middle of the felt.
    const rise = y > origin.height / 2 ? 'up' : 'down';
    const key = ++serial.current;
    // A seat shows its latest reaction only.
    setFloats((items) => [...items.filter((item) => item.playerId !== playerId),
      { key, playerId, emote, x: rect.left + rect.width / 2 - origin.left, y, rise }]);
  }), []);

  useLayoutEffect(() => {
    const root = layer.current;
    if (!anchor || !root) {
      setFanAt(null);
      return;
    }
    const origin = root.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    // Keep the whole arc on the table at narrow widths.
    const reach = 120;
    const x = Math.min(Math.max(rect.left + rect.width / 2 - origin.left, reach + 4), origin.width - reach - 4);
    setFanAt({ x, y: rect.top + rect.height / 2 - origin.top - 14 });
  }, [anchor]);

  useEffect(() => {
    if (!fanAt) return;
    fan.current?.querySelector<HTMLButtonElement>('button:enabled')?.focus({ preventScroll: true });
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!fan.current?.contains(target) && !anchor?.contains(target)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onClose();
      anchor?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [fanAt, anchor, onClose]);

  useEffect(() => {
    if (!cooling) return;
    const timer = setTimeout(() => setCooling(false), Math.max(0, coolUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [cooling, coolUntil]);

  function send(emote: Emote) {
    if (Date.now() < coolUntil) return;
    setCoolUntil(Date.now() + EMOTE_GAP_MS);
    setCooling(true);
    onSend(emote);
    onClose();
    anchor?.focus({ preventScroll: true });
  }

  return (
    <div ref={layer} className="table-emote-layer">
      {floats.map((item) => (
        <span key={item.key} className="table-emote-float" data-rise={item.rise} aria-hidden="true"
          style={{ left: item.x, top: item.y }}
          onAnimationEnd={() => setFloats((items) => items.filter((other) => other.key !== item.key))}>
          <EmoteArt emote={item.emote} />
        </span>
      ))}
      {fanAt && (
        <div ref={fan} className="table-emote-fan" role="menu" aria-label={t('emote.menu')}
          style={{ left: fanAt.x, top: fanAt.y }}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            const items = [...(fan.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
            const at = items.indexOf(document.activeElement as HTMLButtonElement);
            const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
            items[(at + step + items.length) % items.length]?.focus();
          }}>
          {EMOTES.map((emote, index) => {
            // An arc over the portrait that clears the neighbouring seats.
            const angle = Math.PI * (1.14 + (0.72 * index) / (EMOTES.length - 1));
            return (
              <button key={emote} type="button" role="menuitem" className="table-emote-choice"
                disabled={cooling} aria-label={t(`emote.${emote}`)} title={t(`emote.${emote}`)}
                style={{ '--dx': `${Math.cos(angle) * 96}px`, '--dy': `${Math.sin(angle) * 96}px`, '--i': index } as CSSProperties}
                onClick={() => send(emote)}>
                <EmoteArt emote={emote} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
