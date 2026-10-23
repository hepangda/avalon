import { useState, type ReactNode } from 'react';
import { TableSheet } from './TableSheet';
import { useTranslations } from 'use-intl';
import type { ClientGameState } from '@/lib/engine';
import { FunctionsPanel } from './FunctionsPanel';
import { SoundSettings } from '@/components/SoundSettings';
import { TableInstruments } from './TableInstruments';

export function GameTools({
  game,
  code,
  viewToggle,
  functionsContent,
  notesEnabled,
  onNotesChange,
  notesSaveFailed,
  onClearNotes,
  hasManualNotes = false,
}: {
  game: ClientGameState;
  code: string;
  viewToggle?: ReactNode;
  functionsContent?: ReactNode;
  notesEnabled?: boolean;
  onNotesChange?: (value: boolean) => void;
  notesSaveFailed?: boolean;
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
      <TableSheet open={open} title={t('log.tabFunctions')} onClose={() => setOpen(false)} className="fx-sheet">
        <TableInstruments notesEnabled={notesEnabled} onNotesChange={onNotesChange} notesSaveFailed={notesSaveFailed}
          onClearNotes={onClearNotes} hasManualNotes={hasManualNotes} />
        <SoundSettings />
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
