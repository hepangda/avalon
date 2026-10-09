import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import type { PublicRoom, PublicRoomPage } from '@/lib/socket/types';
import { cn } from '@/lib/utils/cn';

/** Seats as pips: filled for players already at the table. */
function SeatPips({ count, max }: { count: number; max: number }) {
  return (
    <span aria-hidden="true" className="flex gap-[3px]">
      {Array.from({ length: max }, (_, index) => (
        <span key={index} className={cn('h-1.5 w-1.5 rounded-full', index < count ? 'bg-gold' : 'bg-parchment/15')} />
      ))}
    </span>
  );
}

function RoomRow({ room }: { room: PublicRoom }) {
  const t = useTranslations('publicRooms');
  return (
    <Link
      href={`/room/${room.code}`}
      className="group flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-gold/[0.06] focus-visible:bg-gold/[0.06] focus-visible:outline-none sm:gap-4 sm:px-5"
    >
      <span className="room-code grid h-11 w-[3.75rem] shrink-0 place-items-center rounded-lg border border-gold/25 bg-ink-deep/70 text-[15px] tracking-[0.14em] text-gold">
        {room.code}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] text-parchment">{room.name || t('unnamed', { code: room.code })}</span>
        <span className="mt-1.5 flex items-center gap-2.5">
          <SeatPips count={room.playerCount} max={room.maxPlayers} />
          <span className="whitespace-nowrap text-xs tabular-nums text-parchment/50">{t('players', { count: room.playerCount, max: room.maxPlayers })}</span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-sm text-gold/75 transition-colors group-hover:text-gold-bright group-focus-visible:text-gold-bright">
        <span className="sr-only sm:not-sr-only">{t('join')}</span>
        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8h10m-4-4 4 4-4 4" />
        </svg>
      </span>
    </Link>
  );
}

function RoomSkeleton() {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
      <span className="h-11 w-[3.75rem] shrink-0 animate-pulse rounded-lg bg-parchment/[0.06]" />
      <span className="flex-1 space-y-2.5">
        <span className="block h-3.5 w-2/5 animate-pulse rounded bg-parchment/[0.07]" />
        <span className="block h-2 w-1/3 animate-pulse rounded bg-parchment/[0.05]" />
      </span>
    </div>
  );
}

export function PublicRooms() {
  const t = useTranslations('publicRooms');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PublicRoomPage | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    // Keep the current rows on screen while a refresh or page change loads.
    setLoading(true);
    async function load() {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(`/api/rooms?page=${page}`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Failed to load rooms');
        const data = await response.json() as PublicRoomPage;
        if (controller.signal.aborted) return;
        setResult(data);
        setPage(data.page);
        setError(false);
      } catch {
        if (!controller.signal.aborted) { setError(true); setResult(null); }
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [page, refresh]);

  return (
    <section aria-labelledby="public-rooms-title">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <h2 id="public-rooms-title" className="font-serif text-[15px] tracking-wide text-parchment/90">
          {t('title')}
        </h2>
        <button
          type="button"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
          aria-label={t('refresh')}
          title={t('refresh')}
          className="grid h-10 w-10 place-items-center rounded-full text-parchment/50 transition-colors hover:bg-white/5 hover:text-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-default"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className={cn('h-4 w-4', loading && 'animate-spin')} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" />
          </svg>
        </button>
      </div>

      <div
        aria-live="polite"
        aria-busy={loading}
        className="overflow-hidden rounded-2xl border border-gold/15 bg-ink/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      >
        {!result && loading ? (
          <div className="divide-y divide-gold/10">
            <span className="sr-only">{t('loading')}</span>
            <RoomSkeleton />
            <RoomSkeleton />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 px-6 py-9 text-center">
            <p role="alert" className="text-sm text-crimson-bright">{t('error')}</p>
            <Button variant="secondary" className="h-9 px-4 text-xs" onClick={() => setRefresh((value) => value + 1)}>
              {t('refresh')}
            </Button>
          </div>
        ) : !result?.rooms.length ? (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <svg aria-hidden="true" viewBox="0 0 48 48" fill="none" className="mb-4 h-11 w-11 text-gold/35" stroke="currentColor" strokeWidth="1.25">
              <circle cx="24" cy="24" r="9" />
              <circle cx="24" cy="7" r="2.5" />
              <circle cx="38.7" cy="15.5" r="2.5" />
              <circle cx="38.7" cy="32.5" r="2.5" />
              <circle cx="24" cy="41" r="2.5" />
              <circle cx="9.3" cy="32.5" r="2.5" />
              <circle cx="9.3" cy="15.5" r="2.5" />
            </svg>
            <p className="text-sm text-parchment/70">{t('empty')}</p>
            <p className="mt-1.5 text-xs text-parchment/40">{t('emptyHint')}</p>
          </div>
        ) : (
          <ul className={cn('divide-y divide-gold/10 transition-opacity', loading && 'opacity-60')}>
            {result.rooms.map((room) => (
              <li key={room.code}><RoomRow room={room} /></li>
            ))}
          </ul>
        )}
      </div>

      {result && result.totalPages > 1 && (
        <nav aria-label={t('pagination')} className="mt-3 flex items-center justify-between gap-2">
          <Button variant="ghost" className="h-10 px-3 text-xs" disabled={loading || result.page <= 1} onClick={() => setPage(result.page - 1)}>
            <span aria-hidden="true">‹</span> {t('previous')}
          </Button>
          <span className="text-xs tabular-nums text-parchment/45">{result.page} / {result.totalPages}</span>
          <Button variant="ghost" className="h-10 px-3 text-xs" disabled={loading || result.page >= result.totalPages} onClick={() => setPage(result.page + 1)}>
            {t('next')} <span aria-hidden="true">›</span>
          </Button>
        </nav>
      )}
    </section>
  );
}
