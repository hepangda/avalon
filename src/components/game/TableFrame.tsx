import { useInviteLink } from '@/lib/game/useInviteLink';
import { useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { PreferencesButton } from '@/components/PreferencesButton';
import { GameIcon } from './GameArt';
import { formatLatency, latencyTextClass } from '@/lib/utils/latency';

export function TableFrame({
  code,
  title,
  connected,
  latency,
  headerAction,
  progress,
  children,
  footer,
  report,
  onOpenReport,
  tools,
  dockStart,
  error,
  onDismissError,
}: {
  code: string;
  /** The room's name; the brand stands in for an unnamed room. */
  title?: string;
  connected: boolean;
  latency: number | null;
  headerAction?: (openReport: () => void) => ReactNode;
  progress?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  report: ReactNode;
  onOpenReport?: () => void;
  tools: (viewToggle: ReactNode) => ReactNode;
  /** Opens the dock, beside the actions: the player's own face-down card. */
  dockStart?: ReactNode;
  error?: string | null;
  onDismissError?: () => void;
}) {
  const t = useTranslations();
  const { copied, copyInvite } = useInviteLink(code);
  const [tab, setTab] = useState<'table' | 'report'>('table');
  const viewToggleRef = useRef<HTMLButtonElement>(null);
  const tabsId = useId();
  // The report covers the whole table on narrow screens; its own close button returns here.
  const viewToggle = (
    <button
      ref={viewToggleRef}
      type="button"
      className="table-tool table-view-toggle"
      aria-controls={`${tabsId}-report`}
      title={t('log.panelTitle')}
      onClick={() => {
        onOpenReport?.();
        setTab('report');
      }}
    >
      <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 3.5h9.5a2 2 0 0 1 2 2V15a1.5 1.5 0 0 1-3 0V5.5M5 3.5a1.5 1.5 0 0 0-1.5 1.5v1.5H6V5a1.5 1.5 0 0 0-1-1.5ZM13.5 16.5H7A1.5 1.5 0 0 1 5.5 15V6.5M8.5 8h4M8.5 11h4" />
      </svg>
      <span className="table-tool-label">{t('log.panelTitle')}</span>
    </button>
  );
  return (
    <main className="table-screen">
      <header className="table-header">
        <div className="table-title">
          <GameIcon name="crest" className="table-title-crest" />
          <span className={`table-title-name${title ? '' : ' is-brand'}`}>{title || 'AVALON'}</span>
          <button
            type="button"
            onClick={() => void copyInvite()}
            className="table-code-chip"
            aria-label={`${t('lobby.inviteLink')} · ${code}`}
            aria-live="polite"
          >
            {copied ? (
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m4.5 10.5 3.5 3.5 7.5-8" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1" />
              </svg>
            )}
            <span className="room-code">{copied ? t('lobby.copied') : code}</span>
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`table-latency ${connected ? latencyTextClass(latency) : 'text-amber-300'}`}
          >
            {connected ? `● ${formatLatency(latency)}` : t('game.reconnecting')}
          </span>
          {headerAction?.(() => setTab('report'))}
          <PreferencesButton />
        </div>
      </header>
      <div className="table-workspace" data-view={tab}>
        <div
          className="table-play"
          role="region"
          id={`${tabsId}-table`}
          aria-label={t('table.tabTable')}
        >
          {progress && <div className="table-progress">{progress}</div>}
          <div className="table-stage">{children}</div>
          <footer className="table-footer table-dock">
            {dockStart && <div className="table-dock-start">{dockStart}</div>}
            <div className="table-dock-main">{footer}</div>
            <div className="table-dock-end">{tools(viewToggle)}</div>
          </footer>
        </div>
        <aside
          className="table-report"
          role="region"
          id={`${tabsId}-report`}
          aria-label={t('log.panelTitle')}
        >
          {report}
          <button
            type="button"
            className="table-report-close"
            aria-label={t('table.returnToTable')}
            title={t('table.returnToTable')}
            aria-controls={`${tabsId}-table`}
            onClick={() => {
              setTab('table');
              // The toggle is hidden with the table until this render lands.
              requestAnimationFrame(() => viewToggleRef.current?.focus());
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </aside>
      </div>
      {error && (
        <div role="alert" className="table-error">
          <span>{error}</span>
          {onDismissError && (
            <button
              type="button"
              onClick={onDismissError}
              aria-label={t('mission.close')}
            >
              ✕
            </button>
          )}
        </div>
      )}
    </main>
  );
}
