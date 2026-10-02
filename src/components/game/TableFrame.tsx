import { useInviteLink } from '@/lib/game/useInviteLink';
import { useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { PreferencesButton } from '@/components/PreferencesButton';
import { formatLatency, latencyTextClass } from '@/lib/utils/latency';

export function TableFrame({
  code,
  connected,
  latency,
  headerAction,
  progress,
  children,
  footer,
  report,
  onOpenReport,
  tools,
  error,
  onDismissError,
}: {
  code: string;
  connected: boolean;
  latency: number | null;
  headerAction?: (openReport: () => void) => ReactNode;
  progress?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  report: ReactNode;
  onOpenReport?: () => void;
  tools: (viewToggle: ReactNode) => ReactNode;
  error?: string | null;
  onDismissError?: () => void;
}) {
  const t = useTranslations();
  const { copied, copyInvite } = useInviteLink(code);
  const [tab, setTab] = useState<'table' | 'report'>('table');
  const viewToggleRef = useRef<HTMLButtonElement>(null);
  const tabsId = useId();
  return (
    <main className="table-screen">
      <header className="table-header">
        <button
          type="button"
          onClick={() => void copyInvite()}
          className="table-brand"
          aria-label={t('lobby.inviteLink')}
        >
          <span>AVALON</span>
          <span className="text-parchment/35">·</span>
          <span className="room-code">{copied ? t('lobby.copied') : code}</span>
        </button>
        <div className="flex min-w-0 items-center gap-2">
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
          <footer className="table-footer">{footer}</footer>
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
              viewToggleRef.current?.focus();
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </aside>
        <div className="table-bottom-tools">
          {tools(
            <button
              ref={viewToggleRef}
              type="button"
              className="table-tool table-view-toggle"
              aria-controls={`${tabsId}-${tab === 'table' ? 'report' : 'table'}`}
              onClick={() => {
                if (tab === 'table') onOpenReport?.();
                setTab(tab === 'table' ? 'report' : 'table');
              }}
            >
              <span aria-hidden="true">{tab === 'table' ? '▤' : '◉'}</span>
              <span>
                {tab === 'table' ? t('log.panelTitle') : t('table.tabTable')}
              </span>
            </button>,
          )}
        </div>
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
