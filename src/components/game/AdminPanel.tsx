import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { ClientGameState } from '@/lib/engine';
import { adminActions } from '@/lib/socket/client';
import { useTranslations } from 'use-intl';
import { Popconfirm, type PopconfirmTrigger } from '@/components/ui/Popconfirm';
import { seatLabel } from '@/lib/game/playerLabel';

import { RefereeToolDialog } from './RefereeToolDialog';
import { ToolIcon } from './ToolIcons';
import { useRefereeTools } from './useRefereeTools';

const EASE_OUT = [0.2, 0.8, 0.25, 1] as const;
const EASE_IN = [0.5, 0, 0.75, 0] as const;
/** The closed seal's height; the bench unfolds from it and folds back to it. */
const SEAL_HEIGHT = 58;

/** Closed: one seal to break. Open: the referee's bench, every tool a tile unfolding from the seal. */
export function AdminPanel({ game }: { game: ClientGameState }) {
  const tools = useRefereeTools(game);
  const t = useTranslations();
  const still = useReducedMotion();
  const { authed, setActiveTool, setSkipTarget, speakerId, busy, error, setError, setVoteTarget, setProposeSel, entries, selectedEntry, run, handleAuth, handleDisable } = tools;
  const speaker = game.players.find((p) => p.id === speakerId);
  const tiles = entries.filter((entry) => entry.id !== 'disable');

  function open(id: (typeof entries)[number]['id']) {
    setError(null);
    setVoteTarget('');
    setProposeSel([]);
    setSkipTarget(speakerId ?? null);
    setActiveTool(id);
  }

  type Entry = (typeof entries)[number];
  /** Yes/no tools ask right on their tile; the rest open a picker. */
  function ask(id: Entry['id']): { title: string; act: () => unknown } | null {
    switch (id) {
      case 'pauseTimer': return { title: t('admin.ask.pauseTimer'), act: () => run(() => adminActions.setTimersPaused(true)) };
      case 'resumeTimer': return { title: t('admin.ask.resumeTimer'), act: () => run(() => adminActions.setTimersPaused(false)) };
      case 'skipSpeech':
        return speaker ? { title: t('admin.ask.skipSpeech', { name: seatLabel(speaker.seat, speaker.name) }), act: () => run(() => adminActions.skipSpeech(speaker.id)) } : null;
      case 'rerollLeader': return { title: t('admin.ask.rerollLeader'), act: () => run(adminActions.rerollLeader) };
      case 'rerollRoles': return { title: t('admin.ask.rerollRoles'), act: () => run(adminActions.rerollRoles) };
      case 'assassination': return { title: t('admin.ask.assassination'), act: () => run(adminActions.startAssassination) };
      case 'previous':
        return game.previousPhase ? { title: t('admin.ask.previous', { phase: t(`phase.${game.previousPhase}`) }), act: () => run(adminActions.previousPhase) } : null;
      case 'retractVotes': return { title: t('admin.ask.retractVotes'), act: () => run(adminActions.retractVotes) };
      case 'retractProposal': return { title: t('admin.ask.retractProposal'), act: () => run(adminActions.retractProposal) };
      default: return null;
    }
  }

  const bench = {
    folded: { height: SEAL_HEIGHT },
    open: { height: 'auto', transition: { duration: still ? 0 : 0.32, ease: EASE_OUT } },
    gone: { height: SEAL_HEIGHT, opacity: 0, transition: { delay: still ? 0 : 0.12, duration: still ? 0 : 0.24, ease: EASE_IN } },
  };
  const tile = {
    folded: { opacity: 0, scale: 0.7, x: -12, y: -14 },
    open: (i: number) => ({ opacity: 1, scale: 1, x: 0, y: 0, transition: { delay: 0.08 + i * 0.03, duration: 0.26, ease: EASE_OUT } }),
    gone: (i: number) => ({ opacity: 0, scale: 0.7, x: -12, y: -14, transition: { delay: (tiles.length - 1 - i) * 0.02, duration: 0.16, ease: EASE_IN } }),
  };

  return (
    <>
      <AnimatePresence initial={false} mode="wait">
        {!authed ? (
          <motion.button key="seal" type="button" className="fx-seal" data-sheet-origin="referee" disabled={busy}
            onClick={() => void handleAuth()} aria-busy={busy}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: still ? 0 : 0.14 }}>
            <span className="fx-seal-wax"><ToolIcon art={{ glyph: 'referee' }} /></span>
            <span className="fx-seal-title">{t('admin.open')}</span>
            <span className="fx-chevron" aria-hidden="true">›</span>
          </motion.button>
        ) : (
          <motion.section key="bench" className="fx-bench" aria-label={t('admin.title')}
            variants={bench} initial="folded" animate="open" exit="gone">
            <header className="fx-bench-head">
              <span className="fx-seal-wax is-small" data-sheet-origin="referee"><ToolIcon art={{ glyph: 'referee' }} /></span>
              <h3>{t('admin.badge')}</h3>
              <button type="button" className="fx-bench-off" disabled={busy} aria-label={t('admin.close')}
                onClick={() => void handleDisable()}>
                {t('admin.closeShort')}
              </button>
            </header>
            <div className="fx-tiles">
              {tiles.map((entry, i) => {
                const question = ask(entry.id);
                const face = (trigger?: PopconfirmTrigger) => (
                  <motion.button key={entry.id} {...trigger} type="button" className="fx-tile" disabled={busy || entry.disabled}
                    onClick={trigger?.onClick ?? (() => open(entry.id))}
                    custom={i} variants={still ? undefined : tile}>
                    <ToolIcon art={entry.art} />
                    <span>{entry.title}</span>
                  </motion.button>
                );
                // A new phase or speaker withdraws an open question rather than retargeting it.
                return question ? (
                  <Popconfirm key={`${entry.id}:${game.phaseRevision}:${speakerId ?? ''}`} title={question.title}
                    confirmLabel={t('common.confirm')} onConfirm={question.act} disabled={busy || entry.disabled}>
                    {face}
                  </Popconfirm>
                ) : face();
              })}
            </div>
          </motion.section>
        )}
      </AnimatePresence>
      {error && !selectedEntry && <p role="alert" className="fx-alert">{error}</p>}
      <RefereeToolDialog tools={tools} game={game} />
    </>
  );
}
