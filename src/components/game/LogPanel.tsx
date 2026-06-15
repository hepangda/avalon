'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRoleText } from '@/lib/game/useRoleText';
import { seatLabel } from '@/lib/game/playerLabel';
import { VoteResultPanel } from './VoteResultPanel';
import { MissionCardReveal } from './MissionCardReveal';
import type {
  ClientGameState,
  ClientLogEntry,
  ClientMissionResult,
  ClientVoteRecord,
  Role,
} from '@/lib/engine';

type Channel = 'public' | 'private';
type Mode = 'collapsed' | 'inline' | 'full';

// Param keys whose value is a playerId → resolve to the player's name.
const PLAYER_PARAMS = ['player', 'leader', 'target', 'holder'];
// Log keys that carry an inline vote breakdown.
const VOTE_KEYS = new Set(['voteApproved', 'voteRejected']);
// Log keys that carry an inline mission-card display.
const MISSION_KEYS = new Set(['missionSucceeded', 'missionFailed']);

/** Format an epoch-ms timestamp as HH:MM:SS in local time. */
function clock(at: number): string {
  if (!at) return '';
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Bottom system-log panel ("war log"). Two channels: public (what happened in
 * the game) and private (what happened to you). Three display modes:
 *   - collapsed: a single-row bar showing the latest public entry;
 *   - inline (default): expands within the page layout below the game content;
 *   - full: a fixed fullscreen overlay (handy on small screens).
 *
 * Vote-result entries show every player's vote inline by default.
 */
export function LogPanel({ game }: { game: ClientGameState }) {
  const t = useTranslations();
  const roleText = useRoleText();
  const [mode, setMode] = useState<Mode>('inline');
  const [channel, setChannel] = useState<Channel>('public');
  const scrollRef = useRef<HTMLDivElement>(null);
  const open = mode !== 'collapsed';

  const nameOf = (id: string) => {
    const p = game.players.find((x) => x.id === id);
    return p ? seatLabel(p.seat, p.name) : '???';
  };

  function render(entry: ClientLogEntry): string {
    const resolved: Record<string, string | number> = {};
    const isAdmin = entry.style === 'admin';
    // Lineup entries carry encoded role lists ("Merlin,LoyalServant*3") in the
    // good/evil params; decode each into localized role names joined for display.
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
          // Admin operator who holds no seat → localized "someone".
          resolved[k] = t('admin.someone');
        } else if (isAdmin && k === 'value' && (v === 'approve' || v === 'reject')) {
          // Admin vote value → localized approve/reject label.
          resolved[k] = v === 'approve' ? t('vote.approve') : t('vote.reject');
        } else if (isAdmin) {
          // Admin entries arrive with names already resolved server-side; pass
          // every param through verbatim (never run a name through nameOf).
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

  // Find the vote record a vote-log entry refers to (via round + proposal).
  function voteRecordFor(entry: ClientLogEntry): ClientVoteRecord | undefined {
    if (!VOTE_KEYS.has(entry.key) || !entry.params) return undefined;
    const round = Number(entry.params.round) - 1;
    const proposal = Number(entry.params.proposal) - 1;
    return game.voteHistory.find(
      (v) => v.roundIndex === round && v.proposalIndex === proposal,
    );
  }

  // Find the mission result a mission-log entry refers to (via round).
  function missionResultFor(entry: ClientLogEntry): ClientMissionResult | undefined {
    if (!MISSION_KEYS.has(entry.key) || !entry.params) return undefined;
    const round = Number(entry.params.round) - 1;
    return game.missionResults.find((m) => m.roundIndex === round);
  }

  const entries = game.logs.filter((l) => l.channel === channel);
  const latest = game.logs.filter((l) => l.channel === 'public').at(-1);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, channel, entries.length]);

  const header = (
    <div className="flex h-12 shrink-0 items-center gap-2 px-4">
      {/* Title + collapsed preview toggles collapsed/inline. */}
      <button
        onClick={() => setMode((m) => (m === 'collapsed' ? 'inline' : 'collapsed'))}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span className="gilt text-sm">{t('log.panelTitle')}</span>
        {!open && latest && (
          <span className="min-w-0 flex-1 truncate text-xs text-parchment/60">{render(latest)}</span>
        )}
      </button>
      {/* Fullscreen toggle (only while expanded). */}
      {open && (
        <button
          onClick={() => setMode((m) => (m === 'full' ? 'inline' : 'full'))}
          className="shrink-0 px-1 text-parchment/50 hover:text-parchment"
          aria-label={mode === 'full' ? t('log.exitFullscreen') : t('log.fullscreen')}
          title={mode === 'full' ? t('log.exitFullscreen') : t('log.fullscreen')}
        >
          {mode === 'full' ? '🗗' : '⛶'}
        </button>
      )}
      {/* Collapse/expand chevron. */}
      <button
        onClick={() => setMode((m) => (m === 'collapsed' ? 'inline' : 'collapsed'))}
        className="shrink-0 text-parchment/50 hover:text-parchment"
        aria-label={open ? t('log.collapse') : t('log.expand')}
      >
        {open ? '▾' : '▴'}
      </button>
    </div>
  );

  const body = (
    <>
      {/* Channel tabs */}
      <div className="flex shrink-0 gap-1 border-b border-gold/15 px-3 pb-2">
        {(['public', 'private'] as Channel[]).map((ch) => (
          <button
            key={ch}
            onClick={() => setChannel(ch)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              channel === ch
                ? 'bg-gold/20 text-gold'
                : 'text-parchment/50 hover:text-parchment'
            }`}
          >
            {ch === 'public' ? t('log.tabPublic') : t('log.tabPrivate')}
          </button>
        ))}
      </div>

      {/* Entries */}
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
                {/* Vote-result entries show every player's vote by default. */}
                {voteRec && (
                  <div className="ml-[3.2rem] mt-1.5 rounded-lg border border-gold/15 bg-ink/30 p-2.5">
                    <VoteResultPanel record={voteRec} game={game} compact />
                  </div>
                )}
                {/* Mission-result entries show the cards (static, fixed order). */}
                {missionRec && (
                  <div className="ml-[3.2rem] mt-1.5 rounded-lg border border-gold/15 bg-ink/30 p-2.5">
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
  );

  // Fullscreen: a fixed overlay covering the viewport (good for small screens).
  if (mode === 'full') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-ink-deep">
        {header}
        {body}
      </div>
    );
  }

  return (
    <div
      className={`panel flex min-h-0 flex-col overflow-hidden transition-[flex-grow] ${
        open ? 'flex-1' : 'h-12 flex-none'
      }`}
    >
      {header}
      {open && body}
    </div>
  );
}
