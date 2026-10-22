import type {
ClientGameState,
ClientLogEntry,
ClientMissionResult,
ClientVoteRecord
} from '@/lib/engine';
import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { foldLog } from '@/lib/game/foldLog';
import type { GameIconName } from '@/lib/game/gameIcons';
import { formatGameLog } from '@/lib/game/formatGameLog';
import { useRoleText } from '@/lib/game/useRoleText';
import { useEffect,useId,useLayoutEffect,useRef } from 'react';
import { useTranslations } from 'use-intl';
import { GameIcon } from './GameArt';
import { MissionCardReveal } from './MissionCardReveal';
import { VoteMatrix } from './VoteMatrix';
import { LogFace, VoteResultPanel } from './VoteResultPanel';

const CHANNELS = ['public', 'votes', 'private', 'rules'] as const;
export type LogChannel = (typeof CHANNELS)[number];
const CHANNEL_LABELS = {
  public: 'log.tabPublic',
  votes: 'log.tabVotes',
  private: 'log.tabPrivate',
  rules: 'table.rules',
} as const;

const VOTE_KEYS = new Set(['voteApproved', 'voteRejected']);
const MISSION_KEYS = new Set(['missionSucceeded', 'missionFailed']);
const PROPOSAL_KEYS = new Set(['proposalBegins', 'teamAnnounced', 'teamFinalized']);

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
  myPlayerId = null,
  channel: tab,
  onChannelChange: setTab,
  matrixFocus = null,
}: {
  game: ClientGameState;
  myPlayerId?: string | null;
  channel: LogChannel;
  onChannelChange: (channel: LogChannel) => void;
  /** A mission to open the vote sheet at, chosen from the quest board. */
  matrixFocus?: { round: number; at: number } | null;
}) {
  const t = useTranslations();
  const roleText = useRoleText();
  const channelId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);

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
  const matrixRows = game.voteHistory.length + game.missionResults.length;
  // The sheet places itself on the chosen mission; nothing may pull it back to the end.
  useLayoutEffect(() => {
    if (matrixFocus) following.current = false;
  }, [matrixFocus]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (tab === 'rules') el.scrollTop = 0;
    else if (following.current) el.scrollTop = el.scrollHeight;
  }, [tab, entries.length, matrixRows]);

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
        {tab === 'votes' ? (
          <VoteMatrix game={game} myPlayerId={myPlayerId} focus={matrixFocus} />
        ) : tab === 'rules' ? (
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
          foldLog(entries).map((item) => {
            if (item.kind === 'speeches') {
              const speakers = item.entries.map((e) => game.players.find((p) => p.id === e.params?.player));
              return (
                <details key={`speeches-${item.key}`} className="war-log-entry war-log-fold">
                  <summary className="war-log-line">
                    <span className="war-log-glyph is-speech" title={clock(item.entries[0]!.at)} aria-hidden="true">
                      <svg viewBox="0 0 20 20"><path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v6.5A1.5 1.5 0 0 1 16 14H9l-3.5 3v-3H4A1.5 1.5 0 0 1 2.5 12.5V6A1.5 1.5 0 0 1 4 4.5Z" /></svg>
                    </span>
                    <span className="sr-only">{t('log.speeches')}</span>
                    <span className="war-log-speakers" aria-hidden="true">
                      {speakers.map((p, i) => p && (
                        <PlayerAvatar key={`${p.id}-${i}`} playerId={p.id} avatarUrl={p.claimed === false ? undefined : p.avatarUrl}
                          name={p.name} className="war-log-speaker"
                        >
                          <b>{p.seat + 1}</b>
                        </PlayerAvatar>
                      ))}
                    </span>
                  </summary>
                  {item.entries.map((entry) => (
                    <div key={entry.seq} className="flex items-baseline gap-2 pt-1.5 pl-8">
                      <span className="shrink-0 font-mono text-[11px] text-parchment/35">{clock(entry.at)}</span>
                      <span className={entry.style === 'admin' ? 'font-semibold text-crimson' : 'text-parchment/70'}>
                        {formatGameLog(entry, game, t, roleText.name)}
                      </span>
                    </div>
                  ))}
                </details>
              );
            }
            const entry = item.entry;
            const text = formatGameLog(entry, game, t, roleText.name);
            // Each quest opens a new chapter of the log.
            if (entry.key === 'roundBegins')
              return (
                <div key={entry.seq} className="war-log-chapter" title={clock(entry.at)}>
                  <span className="war-log-chapter-medal" aria-hidden="true">{entry.params?.round}</span>
                  <span className="sr-only">{text}</span>
                </div>
              );
            const voteRec = voteRecordFor(entry);
            const missionRec = missionResultFor(entry);
            const team = typeof entry.params?.team === 'string' ? entry.params.team.split(',').filter(Boolean) : [];
            return (
              <div key={entry.seq} className="war-log-entry war-log-line" data-admin={entry.style === 'admin' || undefined}>
                <span className="war-log-glyph" title={clock(entry.at)} aria-hidden="true">
                  <GameIcon name={glyphOf(entry.key)} className="h-full w-full" />
                </span>
                <div className="war-log-body">
                  {voteRec ? (
                    <>
                      <span className="sr-only">{text}</span>
                      <VoteResultPanel record={voteRec} game={game} />
                    </>
                  ) : missionRec ? (
                    <>
                      <span className="sr-only">{text}</span>
                      <MissionCardReveal teamSize={missionRec.teamSize} failCount={missionRec.failCount} />
                    </>
                  ) : PROPOSAL_KEYS.has(entry.key) && typeof entry.params?.leader === 'string' ? (
                    // Who leads, which attempt it is, and whom they named: told with faces and pips.
                    <span className="war-log-faces">
                      <span className="sr-only">{text}</span>
                      <LogFace game={game} id={entry.params.leader} className="is-leader">
                        <GameIcon name="leader" className="log-face-crown" />
                      </LogFace>
                      {entry.key === 'proposalBegins' ? (
                        <span className="war-log-pips" aria-hidden="true">
                          {Array.from({ length: 5 }, (_, i) => (
                            <i key={i} data-on={i < Number(entry.params?.proposal) || undefined} data-last={i === 4 || undefined} />
                          ))}
                        </span>
                      ) : (
                        <>
                          <span className="war-log-tag" aria-hidden="true">{t(`log.short.${entry.key}`)}</span>
                          {team.map((id) => <LogFace key={id} game={game} id={id} className="is-team" />)}
                        </>
                      )}
                    </span>
                  ) : (
                    <span className={entry.style === 'admin' ? 'font-semibold text-crimson' : 'text-parchment/85'}>{text}</span>
                  )}
                </div>
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
