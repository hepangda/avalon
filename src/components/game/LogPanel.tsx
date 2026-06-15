'use client';

import { useEffect, useRef, useState } from 'react';
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
type Tab = Channel | 'functions';
type Mode = 'inline' | 'tall';

const PLAYER_PARAMS = ['player', 'leader', 'target', 'holder'];
const VOTE_KEYS = new Set(['voteApproved', 'voteRejected']);
const MISSION_KEYS = new Set(['missionSucceeded', 'missionFailed']);

function clock(at: number): string {
  if (!at) return '';
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function LogPanel({ game, code }: { game: ClientGameState; code: string }) {
  const t = useTranslations();
  const roleText = useRoleText();
  const [mode, setMode] = useState<Mode>('inline');
  const [tab, setTab] = useState<Tab>('public');
  const scrollRef = useRef<HTMLDivElement>(null);

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
    return game.voteHistory.find(
      (v) => v.roundIndex === round && v.proposalIndex === proposal,
    );
  }

  function missionResultFor(entry: ClientLogEntry): ClientMissionResult | undefined {
    if (!MISSION_KEYS.has(entry.key) || !entry.params) return undefined;
    const round = Number(entry.params.round) - 1;
    return game.missionResults.find((m) => m.roundIndex === round);
  }

  const entries = tab === 'functions' ? [] : game.logs.filter((l) => l.channel === tab);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [tab, entries.length]);

  const body = (
    <>
      <div className="flex shrink-0 gap-1 border-b border-gold/15 px-3 pb-2">
        {(['public', 'private', 'functions'] as Tab[]).map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              tab === tb ? 'bg-gold/20 text-gold' : 'text-parchment/50 hover:text-parchment'
            }`}
          >
            {tb === 'public'
              ? t('log.tabPublic')
              : tb === 'private'
                ? t('log.tabPrivate')
                : t('log.tabFunctions')}
          </button>
        ))}
      </div>

      {tab === 'functions' ? (
        <FunctionsPanel code={code} game={game} />
      ) : (
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
                    <div className="ml-[3.2rem] mt-1.5 rounded-lg border border-gold/15 bg-ink/30 p-2.5">
                      <VoteResultPanel record={voteRec} game={game} compact />
                    </div>
                  )}
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
      )}
    </>
  );

  return (
    <div
      className={`panel flex min-h-0 flex-col overflow-hidden ${
        mode === 'tall' ? 'fixed inset-x-4 bottom-4 top-4 z-40 mx-auto max-w-2xl' : 'flex-1'
      }`}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 px-4">
        <span className="gilt min-w-0 flex-1 text-sm">{t('log.panelTitle')}</span>
        <button
          onClick={() => setMode((m) => (m === 'tall' ? 'inline' : 'tall'))}
          className="shrink-0 px-1 text-parchment/50 hover:text-parchment"
          aria-label={mode === 'tall' ? t('log.exitTall') : t('log.tall')}
          title={mode === 'tall' ? t('log.exitTall') : t('log.tall')}
        >
          {mode === 'tall' ? '▾' : '▴'}
        </button>
      </div>
      {body}
    </div>
  );
}