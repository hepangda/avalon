import { rejectionLimit, type ClientGameState, type ClientLogEntry, type GamePhase } from '@/lib/engine';
import { chronicle, type ProposalChapter } from '@/lib/game/foldLog';
import type { GameIconName } from '@/lib/game/gameIcons';
import { formatGameLog } from '@/lib/game/formatGameLog';
import { useRoleText } from '@/lib/game/useRoleText';
import { useEffect,useId,useLayoutEffect,useRef } from 'react';
import { useTranslations } from 'use-intl';
import { GameIcon } from './GameArt';
import { ProposalRecord } from './ProposalRecord';

const CHANNELS = ['public', 'private', 'rules'] as const;
export type LogChannel = (typeof CHANNELS)[number];
const CHANNEL_LABELS = {
  public: 'log.tabPublic',
  private: 'log.tabPrivate',
  rules: 'table.rules',
} as const;

/** Phases in which the latest nomination is still being played out. */
const LIVE_PHASES = new Set<GamePhase>(['TeamBuilding', 'TeamAnnouncement', 'Discussion', 'TeamFinalizing', 'Voting', 'MissionVote']);

/** The emblem each kind of entry carries in place of a timestamp; the time stays on hover. */
function glyphOf(key: string): GameIconName {
  if (/^(proposalBegins|teamAnnounced|teamFinalized|discussionFinished|admin\.leaderRerolled|admin\.proposedFor)$/.test(key)) return 'leader';
  if (/^(voteApproved|youApproved)$/.test(key)) return 'approve';
  if (/^(voteRejected|youRejected|hammerEvilWins|admin\.votesRetracted|admin\.proposalRetracted)$/.test(key)) return 'reject';
  if (/^(missionSucceeded|youPlayedSuccess|goodWins)/.test(key)) return 'missionSuccess';
  if (/^(missionFailed|youPlayedFail|evilWinsMissions)$/.test(key)) return 'missionFail';
  if (/^(lady|ladyResult)/.test(key)) return 'lady';
  if (/^(assassin|earlyAssassination|admin\.assassinationStarted)/.test(key)) return 'assassinate';
  return 'crest';
}

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
  focus = null,
}: {
  game: ClientGameState;
  channel: LogChannel;
  onChannelChange: (channel: LogChannel) => void;
  /** A quest chosen on the quest board (0-based round); the public log opens at its chapter. */
  focus?: { round: number; at: number } | null;
}) {
  const t = useTranslations();
  const roleText = useRoleText();
  const channelId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  const entries = game.logs.filter((l) => l.channel === tab);
  const items = chronicle(entries);
  const format = (entry: ClientLogEntry) => formatGameLog(entry, game, t, roleText.name);
  const limit = rejectionLimit(game.config.maxRejections);
  const lastChapter = items.filter((i): i is ProposalChapter => i.kind === 'proposal').at(-1);
  const liveChapter = lastChapter && lastChapter.round === game.roundIndex + 1 && !lastChapter.mission ? lastChapter : null;
  const currentLeader = game.players.find((p) => p.seat === game.leaderIndex)?.id;
  const records = game.voteHistory.length + game.missionResults.length;
  // A quest picked on the board places the log on its chapter; nothing may pull it back to the end.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!focus || !el) return;
    const chapter = el.querySelector<HTMLElement>(`.war-log-chapter[data-round="${focus.round + 1}"]`);
    if (!chapter) {
      following.current = true;
      el.scrollTop = el.scrollHeight;
      return;
    }
    following.current = false;
    el.scrollTop += chapter.getBoundingClientRect().top - el.getBoundingClientRect().top;
    chapter.dataset.flash = '';
    const timer = setTimeout(() => delete chapter.dataset.flash, 1400);
    return () => clearTimeout(timer);
  }, [focus]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (tab === 'rules') el.scrollTop = 0;
    else if (following.current) el.scrollTop = el.scrollHeight;
  }, [tab, entries.length, records]);

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
          items.map((item) => {
            if (item.kind === 'proposal') {
              const live = item === liveChapter;
              const record = game.voteHistory
                .filter((v) => v.roundIndex === item.round - 1 && v.proposalIndex === item.proposal - 1)
                .at(-1);
              return (
                <ProposalRecord key={item.key} chapter={item} game={game} limit={limit}
                  record={item.vote ? record : undefined}
                  mission={item.mission ? game.missionResults.find((m) => m.roundIndex === item.round - 1) : undefined}
                  leader={record && item.vote ? record.leaderId : live ? (currentLeader ?? item.leader) : item.leader}
                  status={live && LIVE_PHASES.has(game.phase) ? t(`phase.${game.phase}`) : null}
                  format={format} clock={clock} />
              );
            }
            const entry = item.entry;
            const text = format(entry);
            // Each quest opens a new chapter: its number, how many go, and how it ended.
            if (item.kind === 'round') {
              const round = Number(entry.params?.round);
              const result = game.missionResults.find((m) => m.roundIndex === round - 1);
              const size = game.config.missionSizes[round - 1];
              return (
                <div key={entry.seq} className="war-log-chapter" data-round={round} title={clock(entry.at)}
                  data-result={result ? (result.success ? 'success' : 'fail') : undefined}>
                  <span className="war-log-chapter-medal" aria-hidden="true">
                    {result && <GameIcon name={result.success ? 'missionSuccess' : 'missionFail'} className="h-full w-full" />}
                  </span>
                  <span className="war-log-chapter-name">{t('lobby.missionNumber', { n: round })}</span>
                  {size !== undefined && (
                    <span className="war-log-chapter-size tabular-nums" aria-label={t('replay.missionSize', { size })}>{size}</span>
                  )}
                  {game.config.requiredFails[round - 1] === 2 && (
                    <span className="war-log-chapter-shield" role="img" aria-label={t('table.twoFails')} title={t('table.twoFails')}>
                      <svg viewBox="0 0 16 18" aria-hidden="true">
                        <path d="M8 1.5 14 4v4.5c0 3.5-2.5 6-6 8-3.5-2-6-4.5-6-8V4l6-2.5Z" />
                      </svg>
                    </span>
                  )}
                  {result && <span className="sr-only">{t(result.success ? 'cue.missionSuccess' : 'cue.missionFail')}</span>}
                </div>
              );
            }
            return (
              <div key={entry.seq} className="war-log-entry war-log-line" data-admin={entry.style === 'admin' || undefined}>
                <span className="war-log-glyph" title={clock(entry.at)} aria-hidden="true">
                  <GameIcon name={glyphOf(entry.key)} className="h-full w-full" />
                </span>
                <span className="war-log-text">{text}</span>
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
