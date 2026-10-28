import { rejectionLimit, type ClientGameState, type ClientLogEntry, type GamePhase } from '@/lib/engine';
import { byQuest, chronicle, type ProposalChapter } from '@/lib/game/foldLog';
import type { GameIconName } from '@/lib/game/gameIcons';
import { formatGameLog } from '@/lib/game/formatGameLog';
import { useRoleText } from '@/lib/game/useRoleText';
import { useEffect,useId,useLayoutEffect,useRef } from 'react';
import { useTranslations } from 'use-intl';
import { GameIcon } from './GameArt';
import { QuestMedal, QuestRecord } from './ProposalRecord';
import { VoteSheet } from './VoteSheet';

const CHANNELS = ['public', 'votes', 'private', 'rules'] as const;
export type LogChannel = (typeof CHANNELS)[number];
const CHANNEL_LABELS = {
  public: 'log.tabPublic',
  votes: 'log.tabVotes',
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

/** A line of its own in the log, its emblem standing in for the time, which shows on hover. */
function LogLine({ entry, text }: { entry: ClientLogEntry; text: string }) {
  return (
    <div className="war-log-entry war-log-line" data-admin={entry.style === 'admin' || undefined}>
      <span className="war-log-glyph" title={clock(entry.at)} aria-hidden="true">
        <GameIcon name={glyphOf(entry.key)} className="h-full w-full" />
      </span>
      <span className="war-log-text">{text}</span>
    </div>
  );
}

/** The quests at a glance, held above the log: each one's outcome, and a pip per nomination voted on. */
function QuestTrack({ game, live, onPick }: { game: ClientGameState; live: number | null; onPick: (round: number) => void }) {
  const t = useTranslations();
  return (
    <nav className="log-track" aria-label={t('log.questTrack')}>
      {game.config.missionSizes.map((size, i) => {
        const result = game.missionResults.find((m) => m.roundIndex === i);
        const votes = game.voteHistory.filter((r) => r.roundIndex === i);
        const reached = i <= game.roundIndex;
        return (
          <button key={i} type="button" className="log-track-quest" disabled={!reached} onClick={() => onPick(i + 1)}
            aria-label={t('lobby.missionNumber', { n: i + 1 })}>
            <QuestMedal result={result} size={size} live={live === i + 1 && !result} />
            <span className="log-track-pips" aria-hidden="true">
              {votes.map((r) => <i key={r.proposalIndex} data-approved={r.approved || undefined} />)}
            </span>
          </button>
        );
      })}
    </nav>
  );
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

  // The vote sheet reads the public log, as the chronicle does.
  const entries = game.logs.filter((l) => l.channel === (tab === 'votes' ? 'public' : tab));
  const items = chronicle(entries, game);
  const quests = tab === 'private' ? [] : byQuest(items);
  // The quest the table is playing, if a nomination or its team is under way.
  const liveRound = LIVE_PHASES.has(game.phase) ? game.roundIndex + 1 : null;
  const status = (chapter: ProposalChapter) => {
    // The nomination being played: still forming, or its approved team out on the quest.
    const playing = chapter.live || (chapter.record?.approved && !chapter.mission && chapter.round === game.roundIndex + 1);
    return playing && liveRound ? t(`phase.${game.phase}`) : null;
  };
  const format = (entry: ClientLogEntry) => formatGameLog(entry, game, t, roleText.name);
  const limit = rejectionLimit(game.config.maxRejections);
  const records = game.voteHistory.length + game.missionResults.length;
  const flash = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Places the log on a quest's card, below the quest track; nothing may pull it back to the end. */
  const showQuest = (round: number) => {
    const el = scrollRef.current;
    if (!el) return;
    // A quest a referee rewound into is headed again; the latest heading is the one in play.
    const chapter = [...el.querySelectorAll<HTMLElement>(`.war-log-chapter[data-round="${round}"]`)].at(-1);
    if (!chapter) {
      following.current = true;
      el.scrollTop = el.scrollHeight;
      return;
    }
    following.current = false;
    const track = el.querySelector<HTMLElement>('.log-track')?.offsetHeight ?? 0;
    el.scrollTop += chapter.getBoundingClientRect().top - el.getBoundingClientRect().top - track;
    chapter.dataset.flash = '';
    clearTimeout(flash.current);
    flash.current = setTimeout(() => delete chapter.dataset.flash, 1400);
  };
  // A quest picked on the board opens the log at its card.
  useLayoutEffect(() => {
    if (focus) showQuest(focus.round + 1);
  }, [focus]);
  useEffect(() => () => clearTimeout(flash.current), []);
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
        ) : entries.length === 0 ? null : tab === 'votes' ? (
          <VoteSheet quests={quests} game={game} live={liveRound} format={format} />
        ) : tab === 'public' ? (
          <>
            <QuestTrack game={game} live={liveRound} onPick={showQuest} />
            {quests.map((item) => item.kind === 'quest' ? (
              <QuestRecord key={`${item.round}-${item.heading?.seq ?? 0}`} quest={item} game={game} limit={limit}
                live={item.round === liveRound} status={status} format={format} clock={clock} />
            ) : (
              <LogLine key={item.entry.seq} entry={item.entry} text={format(item.entry)} />
            ))}
          </>
        ) : (
          items.map((item) => item.kind === 'proposal' ? null : (
            <LogLine key={item.entry.seq} entry={item.entry} text={format(item.entry)} />
          ))
        )}
        {tab !== 'rules' && entries.length === 0 && (
          <p className="text-center text-sm text-parchment/40">
            {t('log.empty')}
          </p>
        )}
      </div>
    </section>
  );
}
