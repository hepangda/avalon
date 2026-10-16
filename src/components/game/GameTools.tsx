import { useState, type ReactNode } from 'react';
import { TableSheet } from './TableSheet';
import { useTranslations } from 'use-intl';
import type { ClientGameState } from '@/lib/engine';
import { FunctionsPanel } from './FunctionsPanel';
import { FullscreenControl } from './FullscreenControl';

export function GameTools({
  game,
  code,
  viewToggle,
  functionsContent,
  notesControl,
  onClearNotes,
  hasManualNotes = false,
}: {
  game: ClientGameState;
  code: string;
  viewToggle?: ReactNode;
  functionsContent?: ReactNode;
  notesControl?: ReactNode;
  onClearNotes?: () => void;
  hasManualNotes?: boolean;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  return (
    <>
      {viewToggle}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="table-tool"
        title={t('log.tabFunctions')}
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M3 6h8m4 0h2M3 14h2m4 0h8" />
          <circle cx="13" cy="6" r="2" />
          <circle cx="7" cy="14" r="2" />
        </svg>
        <span className="table-tool-label">{t('log.tabFunctions')}</span>
      </button>
      <TableSheet open={open} title={t('log.tabFunctions')} onClose={() => setOpen(false)}>
                <div className="shrink-0 px-4 pt-3">
                  <FullscreenControl />
                </div>
                {notesControl && <div className="shrink-0 px-4 pt-3">{notesControl}</div>}
                {onClearNotes && (
                  <div className="shrink-0 px-4 pt-3">
                    <button
                      type="button"
                      className="w-full rounded-lg border border-gold/20 bg-ink/30 px-3 py-2 text-left text-sm text-parchment hover:border-gold/50 disabled:cursor-default disabled:opacity-40"
                      disabled={!hasManualNotes}
                      onClick={onClearNotes}
                    >
                      {t('roleNotes.clearAll')}
                    </button>
                  </div>
                )}
                {functionsContent ?? (
                  <FunctionsPanel
                    code={code}
                    game={game}
                    onAssassinationStarted={() => setOpen(false)}
                  />
                )}
      </TableSheet>
    </>
  );
}
