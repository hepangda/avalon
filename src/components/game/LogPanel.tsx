'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { useRoleText } from '@/lib/game/useRoleText';
import { seatLabel } from '@/lib/game/playerLabel';
import { VoteResultPanel } from './VoteResultPanel';
import { MissionCardReveal } from './MissionCardReveal';
import { FunctionsPanel } from './FunctionsPanel';
import type {
  ClientGameState,
  ClientLogEntry,
  ClientMissionResult,
  ClientVoteRecord,
  Role,
} from '@/lib/engine';

type Channel = 'public' | 'private';
type View = null | 'log' | 'functions';

const PLAYER_PARAMS = ['player', 'leader', 'target', 'holder'];
const VOTE_KEYS = new Set(['voteApproved', 'voteRejected']);
const MISSION_KEYS = new Set(['missionSucceeded', 'missionFailed']);

function clock(at: number): string {
  if (!at) return '';
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * The bottom strip, split into a wide "war log" button (shows the latest entry)
 * and a compact "functions" button. Tapping either opens a semi-transparent
 * floating sheet that overlays the game rather than taking layout space.
 */
export function LogPanel({ game, code }: { game: ClientGameState; code: string }) {
  const t = useTranslations();
  const roleText = useRoleText();
  const [view, setView] = useState<View>(null);
  const [tab, setTab] = useState<Channel>('public');
  const [mounted, setMounted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const nameOf = (id: string) => {
    const p = game.players.find((x) => x.id === id);
    return p ? seatLabel(p.seat, p.name) : '???';
  };

  function render(entry: ClientLogEntry): string {
    const resolved: Record<string, string | number> = {};
    const isAdmin = entry.style === 'admin';
    const decodeLineup = (encoded: string): string =>
      encoded
        .split(',')
        .filter(Boolean)
        .map((tok) => {
          const [role, n] = tok.split('*');
          const name = roleText.name(role as Role);
          return n ? `${name} ×${n}` : name;
        })
        .join('、');
    if (entry.params) {
      for (const [k, v] of Object.entries(entry.params)) {
        if (entry.key === 'lineup' && (k === 'good' || k === 'evil') && typeof v === 'string') {
          resolved[k] = decodeLineup(v);
        } else if (isAdmin && k === 'actor' && v === '__admin_someone__') {
          resolved[k] = t('admin.someone');
        } else if (isAdmin && k === 'value' && (v === 'approve' || v === 'reject')) {
          resolved[k] = v === 'approve' ? t('vote.approve') : t('vote.reject');
        } else if (isAdmin) {
          resolved[k] = v;
        } else if (PLAYER_PARAMS.includes(k) && typeof v === 'string') {
          resolved[k] = nameOf(v);
        } else if (k === 'role' && typeof v === 'string') {
          resolved[k] = roleText.name(v as Role);
        } else {
          resolved[k] = v;
        }
      }
    }
    return t(`log.${entry.key}`, resolved);
  }

  function voteRecordFor(entry: ClientLogEntry): ClientVoteRecord | undefined {
    if (!VOTE_KEYS.has(entry.key) || !entry.params) return undefined;
    const round = Number(entry.params.round) - 1;
    const proposal = Number(entry.params.proposal) - 1;
    return game.voteHistory.find((v) => v.roundIndex === round && v.proposalIndex === proposal);
  }

  function missionResultFor(entry: ClientLogEntry): ClientMissionResult | undefined {
    if (!MISSION_KEYS.has(entry.key) || !entry.params) return undefined;
    const round = Number(entry.params.round) - 1;
    return game.missionResults.find((m) => m.roundIndex === round);
  }

  const entries = game.logs.filter((l) => l.channel === tab);
  const latest = game.logs.filter((l) => l.channel === 'public').at(-1);

  useEffect(() => {
    if (view === 'log' && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [view, tab, entries.length]);

  const sheet = (
    <AnimatePresence>
      {view && (
        <motion.div
          key="sheet"
          className="fixed inset-0 z-40 flex items-end justify-center px-3 pt-3 pb-[4.5rem]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Light backdrop — the game stays visible; tap to close. */}
          <div className="absolute inset-0" onClick={() => setView(null)} />

          <motion.div
            className="relative flex h-[70vh] max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gold/30 bg-ink/85 shadow-2xl shadow-black/60 backdrop-blur-md"
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          >
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-gold/15 px-4">
              <span className="gilt flex-1 text-sm">
                {view === 'log' ? t('log.panelTitle') : t('log.tabFunctions')}
              </span>
              <button
                onClick={() => setView(null)}
                className="px-1 text-parchment/60 hover:text-parchment"
                aria-label={t('mission.close')}
              >
                ✕
              </button>
            </div>

            {view === 'functions' ? (
              <FunctionsPanel code={code} game={game} />
            ) : (
              <>
                <div className="flex shrink-0 gap-1 border-b border-gold/15 px-3 py-2">
                  {(['public', 'private'] as Channel[]).map((tb) => (
                    <button
                      key={tb}
                      onClick={() => setTab(tb)}
                      className={`rounded-full px-3 py-1 text-xs transition-colors ${
                        tab === tb ? 'bg-gold/20 text-gold' : 'text-parchment/50 hover:text-parchment'
                      }`}
                    >
                      {tb === 'public' ? t('log.tabPublic') : t('log.tabPrivate')}
                    </button>
                  ))}
                </div>

                <div ref={scrollRef} className="flex-1 space-y-1.5 overflow-y-auto px-4 py-3">
                  {entries.length > 0 ? (
                    entries.map((entry) => {
                      const voteRec = voteRecordFor(entry);
                      const missionRec = missionResultFor(entry);
                      return (
                        <div key={entry.seq} className="text-sm leading-snug">
                          <div className="flex items-baseline gap-2">
                            <span className="shrink-0 font-mono text-[11px] text-parchment/35">
                              {clock(entry.at)}
                            </span>
                            <span
                              className={
                                entry.style === 'admin'
                                  ? 'font-semibold text-crimson'
                                  : 'text-parchment/85'
                              }
                            >
                              {render(entry)}
                            </span>
                          </div>
                          {voteRec && (
                            <div className="ml-[3.2rem] mt-1.5 rounded-lg border border-gold/15 bg-ink/40 p-2.5">
                              <VoteResultPanel record={voteRec} game={game} compact />
                            </div>
                          )}
                          {missionRec && (
                            <div className="ml-[3.2rem] mt-1.5 rounded-lg border border-gold/15 bg-ink/40 p-2.5">
                              <MissionCardReveal
                                teamSize={missionRec.teamSize}
                                failCount={missionRec.failCount}
                                instant
                              />
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-center text-sm text-parchment/40">{t('log.empty')}</p>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      <div className="flex items-stretch gap-2">
        <button
          onClick={() => setView('log')}
          className="panel flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left"
        >
          <span className="gilt shrink-0 text-sm">{t('log.panelTitle')}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-parchment/45">
            {latest ? render(latest) : ''}
          </span>
          <span className="shrink-0 text-parchment/40">▴</span>
        </button>

        <button
          onClick={() => setView('functions')}
          className="panel flex shrink-0 items-center gap-1.5 px-4 py-2 text-sm text-parchment hover:border-gold/60"
        >
          <span>⚙</span>
          <span>{t('log.tabFunctions')}</span>
        </button>
      </div>

      {mounted ? createPortal(sheet, document.body) : null}
    </>
  );
}
