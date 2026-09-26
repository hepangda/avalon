'use client';

import { useEffect, useId, useRef } from 'react';
import { useTranslations } from 'use-intl';
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

const CHANNELS = ['public', 'private', 'rules'] as const;
export type LogChannel = (typeof CHANNELS)[number];
const CHANNEL_LABELS = {
  public: 'log.tabPublic',
  private: 'log.tabPrivate',
  rules: 'table.rules',
} as const;

const PLAYER_PARAMS = ['player', 'leader', 'target', 'holder'];
const VOTE_KEYS = new Set(['voteApproved', 'voteRejected']);
const MISSION_KEYS = new Set(['missionSucceeded', 'missionFailed']);

function clock(at: number): string {
  if (!at) return '';
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Shared war log, displayed as a page on small tables and a sidebar on wide ones. */
export function LogPanel({
  game,
  channel: tab,
  onChannelChange: setTab,
}: {
  game: ClientGameState;
  channel: LogChannel;
  onChannelChange: (channel: LogChannel) => void;
}) {
  const t = useTranslations();
  const roleText = useRoleText();
  const channelId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);

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
        if (
          entry.key === 'lineup' &&
          (k === 'good' || k === 'evil') &&
          typeof v === 'string'
        ) {
          resolved[k] = decodeLineup(v);
        } else if (isAdmin && k === 'actor' && v === '__admin_someone__') {
          resolved[k] = t('admin.someone');
        } else if (
          isAdmin &&
          k === 'value' &&
          (v === 'approve' || v === 'reject')
        ) {
          resolved[k] = v === 'approve' ? t('vote.approve') : t('vote.reject');
        } else if (isAdmin && k === 'phase') {
          resolved[k] = t(`phase.${v}`);
        } else if (entry.key === 'admin.speechSkipped' && k === 'player' && typeof v === 'string') {
          resolved[k] = nameOf(v);
        } else if (isAdmin) {
          resolved[k] = v;
        } else if (PLAYER_PARAMS.includes(k) && typeof v === 'string') {
          resolved[k] = nameOf(v);
        } else if (k === 'team' && typeof v === 'string') {
          resolved[k] = v.split(',').map(nameOf).join('、');
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
    return game.voteHistory.find(
      (v) => v.roundIndex === round && v.proposalIndex === proposal,
    );
  }

  function missionResultFor(
    entry: ClientLogEntry,
  ): ClientMissionResult | undefined {
    if (!MISSION_KEYS.has(entry.key) || !entry.params) return undefined;
    const round = Number(entry.params.round) - 1;
    return game.missionResults.find((m) => m.roundIndex === round);
  }

  const entries = game.logs.filter((l) => l.channel === tab);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (tab === 'rules') el.scrollTop = 0;
    else if (following.current) el.scrollTop = el.scrollHeight;
  }, [tab, entries.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || tab === 'rules') return;
    const observer = new ResizeObserver(() => {
      if (el.clientHeight > 0 && following.current)
        el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [tab]);

  return (
    <section className="war-log" aria-label={t('log.panelTitle')}>
      <h2 className="war-log-title">{t('log.panelTitle')}</h2>
      <div
        role="tablist"
        aria-label={t('log.channels')}
        className="war-log-channels"
      >
        {CHANNELS.map((tb) => (
          <button
            key={tb}
            type="button"
            role="tab"
            id={`${channelId}-${tb}`}
            aria-controls={`${channelId}-entries`}
            aria-selected={tab === tb}
            tabIndex={tab === tb ? 0 : -1}
            onClick={() => {
              following.current = true;
              setTab(tb);
            }}
            onKeyDown={(event) => {
              if (
                !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 'public'
                  : event.key === 'End'
                    ? 'rules'
                    : (CHANNELS[
                        (CHANNELS.indexOf(tb) +
                          (event.key === 'ArrowRight' ? 1 : -1) +
                          CHANNELS.length) %
                          CHANNELS.length
                      ] ?? CHANNELS[0]);
              following.current = true;
              setTab(next);
              document.getElementById(`${channelId}-${next}`)?.focus();
            }}
            className="war-log-channel"
          >
            {t(CHANNEL_LABELS[tb])}
          </button>
        ))}
      </div>

      <div
        ref={scrollRef}
        role="tabpanel"
        id={`${channelId}-entries`}
        aria-labelledby={`${channelId}-${tab}`}
        tabIndex={0}
        className="war-log-entries"
        onScroll={(event) => {
          const el = event.currentTarget;
          if (el.clientHeight > 0)
            following.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {tab === 'rules' ? (
          <div className="space-y-4 pt-3 text-sm">
            <p>{t('lobby.rolesInPlay', { count: game.players.length })}</p>
            <div className="flex flex-wrap gap-2">
              {game.config.rolesInPlay.map((role, i) => (
                <span className="table-team-chip" key={`${role}-${i}`}>
                  {roleText.shortName(role)}
                </span>
              ))}
            </div>
            <div className="space-y-2 text-parchment/70">
              {game.config.missionSizes.map((size, i) => (
                <p key={i}>
                  {t('table.missionRule', {
                    round: i + 1,
                    players: size,
                    fails: game.config.requiredFails[i],
                  })}
                </p>
              ))}
            </div>
          </div>
        ) : entries.length > 0 ? (
          entries.map((entry) => {
            const voteRec = voteRecordFor(entry);
            const missionRec = missionResultFor(entry);
            return (
              <div key={entry.seq} className="war-log-entry">
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
                  <div className="mt-2 rounded-lg border border-gold/15 bg-ink/40 p-2.5">
                    <VoteResultPanel record={voteRec} game={game} compact />
                  </div>
                )}
                {missionRec && (
                  <div className="mt-2 rounded-lg border border-gold/15 bg-ink/40 p-2.5">
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
          <p className="text-center text-sm text-parchment/40">
            {t('log.empty')}
          </p>
        )}
      </div>
    </section>
  );
}
