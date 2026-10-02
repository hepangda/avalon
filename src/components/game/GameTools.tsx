import { useState, type ReactNode } from 'react';
import { TableSheet } from './TableSheet';
import { useTranslations } from 'use-intl';
import type { ClientGameState } from '@/lib/engine';
import { FunctionsPanel } from './FunctionsPanel';
import { FullscreenControl } from './FullscreenControl';

export function GameTools({
  game,
  code,
  identity,
  viewToggle,
  functionsContent,
  notesControl,
  onClearNotes,
  hasManualNotes = false,
}: {
  game: ClientGameState;
  code: string;
  identity: ReactNode;
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
      <div className="table-tools">
        {identity}
        {viewToggle}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="table-tool"
        >
          <span aria-hidden="true">⚙</span>
          <span>{t('log.tabFunctions')}</span>
        </button>
      </div>
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
