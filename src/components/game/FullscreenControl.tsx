import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';

export function FullscreenControl() {
  const t = useTranslations('game');
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement));
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const hintId = useId();
  const supported = Boolean(
    document.fullscreenEnabled &&
    typeof document.documentElement.requestFullscreen === 'function' &&
    typeof document.exitFullscreen === 'function',
  );

  useEffect(() => {
    function syncFullscreen() {
      setIsFullscreen(Boolean(document.fullscreenElement));
      setFailed(false);
    }
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  async function toggleFullscreen() {
    if (!supported || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailed(false);
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        // Include body portals so dialogs and game tools remain visible.
        await document.documentElement.requestFullscreen();
      }
      setIsFullscreen(Boolean(document.fullscreenElement));
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void toggleFullscreen()}
        disabled={!supported || pending}
        aria-busy={pending}
        aria-describedby={!supported || failed ? hintId : undefined}
        className="flex w-full items-center gap-3 rounded-lg border border-gold/20 bg-ink/30 px-4 py-3 text-left transition-colors hover:border-gold/50 hover:bg-gold/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="flex w-8 shrink-0 justify-center text-gold" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d={isFullscreen
              ? 'M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6'
              : 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6'} />
          </svg>
        </span>
        <span className="min-w-0 flex-1 text-sm font-semibold text-parchment">
          {t(isFullscreen ? 'exitFullscreen' : 'enterFullscreen')}
        </span>
      </button>
      {(!supported || failed) && (
        <p id={hintId} role={failed ? 'alert' : undefined} className="px-1 text-xs text-parchment/60">
          {t(supported ? 'fullscreenFailed' : 'fullscreenUnavailable')}
        </p>
      )}
    </div>
  );
}
