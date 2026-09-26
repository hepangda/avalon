import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslations } from 'use-intl';
import type { ClientGameState } from '@/lib/engine';
import { FunctionsPanel } from './FunctionsPanel';

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
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              className="fixed inset-0 z-40 flex items-end justify-center px-3 pt-3 pb-[4.5rem]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div
                className="absolute inset-0"
                onClick={() => setOpen(false)}
              />
              <motion.div
                className="relative flex h-[70vh] max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gold/30 bg-ink/85 shadow-2xl shadow-black/60 backdrop-blur-md"
                initial={{ y: '100%', opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: '100%', opacity: 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              >
                <div className="flex h-11 shrink-0 items-center gap-2 border-b border-gold/15 px-4">
                  <span className="gilt flex-1 text-sm">
                    {t('log.tabFunctions')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="table-tool"
                    aria-label={t('mission.close')}
                  >
                    ✕
                  </button>
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
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
