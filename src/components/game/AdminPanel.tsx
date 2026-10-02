import type { ClientGameState } from '@/lib/engine';
import { adminActions } from '@/lib/socket/client';
import { useTranslations } from 'use-intl';

import { RefereeToolDialog } from './RefereeToolDialog';
import { useRefereeTools } from './useRefereeTools';

export function AdminPanel({ game }: { game: ClientGameState }) {
  const tools = useRefereeTools(game);
  const t = useTranslations();
  const { authed, setActiveTool, setSkipTarget, speakerId, busy, error, setError, setVoteTarget, setProposeSel, entries, selectedEntry, run } = tools;

  return (
    <>
      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          disabled={busy || entry.disabled}
          onClick={() => {
            if (entry.id === 'pauseTimer' || entry.id === 'resumeTimer') {
              void run(() => adminActions.setTimersPaused(entry.id === 'pauseTimer'));
              return;
            }
            setError(null);
            setVoteTarget('');
            setProposeSel([]);
            setSkipTarget(speakerId ?? null);
            setActiveTool(entry.id);
          }}
          className="flex w-full items-center gap-3 rounded-lg border border-crimson/30 bg-ink/30 px-4 py-3 text-left transition-colors hover:border-crimson/60 hover:bg-crimson/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span
            aria-hidden="true"
            className="flex w-8 shrink-0 justify-center text-2xl text-crimson"
          >
            {entry.icon}
          </span>
          <span className="min-w-0 flex-1 text-sm font-semibold text-parchment">{entry.title}</span>
          {authed && entry.id !== 'disable' && (
            <span className="shrink-0 text-xs text-crimson">{t('admin.badge')}</span>
          )}
          <span aria-hidden="true" className="text-parchment/40">
            ›
          </span>
        </button>
      ))}
      {error && !selectedEntry && <p role="alert" className="rounded-lg border border-crimson/50 bg-crimson/20 px-3 py-2 text-sm text-parchment">{error}</p>}
      <RefereeToolDialog tools={tools} game={game} />
    </>
  );
}
