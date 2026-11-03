import { useTranslations } from 'use-intl';
import { bySeat, seatLabel } from '@/lib/game/playerLabel';
import type { ClientGameState, ClientLogEntry, ClientMissionResult, VoteValue } from '@/lib/engine';
import type { ProposalChapter, QuestChapter } from '@/lib/game/foldLog';
import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { GameIcon } from './GameArt';

type Seated = Pick<ClientGameState, 'players'>;

/** A seat as the log names it: its number on a coin, the name on hover. */
export function LogCoin({ game, id, tone = 'gold', crowned = false }: {
  game: Seated; id: string; tone?: 'gold' | 'ring' | 'spoken' | 'speaking' | 'waiting' | 'dropped'; crowned?: boolean;
}) {
  const p = game.players.find((player) => player.id === id);
  if (!p) return null;
  return (
    <span className="log-coin tabular-nums" data-tone={tone} title={seatLabel(p.seat, p.name)}>
      {p.seat + 1}
      {crowned && <GameIcon name="leader" className="log-coin-crown" />}
    </span>
  );
}

/** A ballot as a marble: white for yes, black for no, with the voter's seat on it. */
export function LogStone({ game, id, vote, bare = false }: { game: Seated; id: string; vote: VoteValue; bare?: boolean }) {
  const p = game.players.find((player) => player.id === id);
  if (!p) return null;
  return (
    <span className="log-stone" data-vote={vote} title={seatLabel(p.seat, p.name)}>
      <GameIcon name={vote} className="log-stone-art" />
      {!bare && <b className="tabular-nums">{p.seat + 1}</b>}
    </span>
  );
}

/** A quest's medal: its outcome once decided, otherwise how many go. */
export function QuestMedal({ result, size, live = false }: { result?: ClientMissionResult; size?: number; live?: boolean }) {
  return (
    <span className="log-medal tabular-nums" data-result={result ? (result.success ? 'success' : 'fail') : undefined}
      data-live={live || undefined} aria-hidden="true">
      {result ? <GameIcon name={result.success ? 'missionSuccess' : 'missionFail'} className="h-full w-full" /> : size}
    </span>
  );
}

/** The cards a quest drew, fails last. */
export function QuestCards({ result }: { result: ClientMissionResult }) {
  const t = useTranslations();
  return (
    <span className="log-quest-cards" role="img"
      aria-label={`${t('cue.missionCardsTitle')}：${result.teamSize - result.failCount} ${t('cue.cardSuccess')} · ${result.failCount} ${t('cue.cardFail')}`}>
      {Array.from({ length: result.teamSize }, (_, i) => {
        const fail = i >= result.teamSize - result.failCount;
        return (
          <span key={i} className="log-quest-card" data-fail={fail || undefined}>
            <GameIcon name={fail ? 'missionFail' : 'missionSuccess'} className="h-full w-full" />
          </span>
        );
      })}
    </span>
  );
}

/** How a quest stands, for its card and its band on the vote sheet. */
export function questStanding(game: ClientGameState, round: number, live: boolean) {
  const result = game.missionResults.find((m) => m.roundIndex === round - 1);
  return {
    result,
    size: game.config.missionSizes[round - 1],
    twoFails: game.config.requiredFails[round - 1] === 2,
    // A quest is in play while the table is still forming or running its team.
    current: !result && live,
  };
}

/** The head of a quest: medal, name and outcome, then the cards it drew or what it needs. */
export function QuestHead({ game, round, live }: { game: ClientGameState; round: number; live: boolean }) {
  const t = useTranslations();
  const { result, size, twoFails, current } = questStanding(game, round, live);
  return (
    <header className="log-quest-head">
      <QuestMedal result={result} size={size} live={current} />
      <span className="log-quest-name">{t('lobby.missionNumber', { n: round })}</span>
      {result ? (
        <span className="log-quest-outcome" data-result={result.success ? 'success' : 'fail'}>
          {t(result.success ? 'log.result.success' : 'log.result.fail')}
        </span>
      ) : current ? <span className="log-quest-outcome" data-result="live">{t('log.result.live')}</span> : null}
      {result ? <QuestCards result={result} /> : size !== undefined && (
        <span className="log-quest-needs">
          {t('replay.missionSize', { size })}{twoFails && ` · ${t('log.needsTwoFails')}`}
        </span>
      )}
    </header>
  );
}

/**
 * One quest as a card: how it ended and the crew that went, then each
 * nomination that led there, with the lines a referee told between them.
 */
export function QuestRecord({
  quest,
  game,
  limit,
  status,
  live,
  format,
  clock,
}: {
  quest: QuestChapter;
  game: ClientGameState;
  limit: number;
  /** What the table is doing now, for the nomination in play. */
  status: (chapter: ProposalChapter) => string | null;
  /** Whether this is the quest the table is playing. */
  live: boolean;
  format: (entry: ClientLogEntry) => string;
  clock: (at: number) => string;
}) {
  const t = useTranslations();
  const { result, current } = questStanding(game, quest.round, live);
  const proposals = quest.body.filter((item): item is ProposalChapter => item.kind === 'proposal');
  // The crew that went, or the one now before the table.
  const sent = proposals.filter((p) => p.record?.approved).at(-1) ?? proposals.find((p) => p.live && p.team.length > 0);
  return (
    <article className="war-log-chapter log-quest" data-round={quest.round}
      data-result={result ? (result.success ? 'success' : 'fail') : current ? 'live' : undefined}
      title={quest.heading ? clock(quest.heading.at) : undefined}>
      <QuestHead game={game} round={quest.round} live={live} />
      {sent && (
        <div className="log-crew" aria-label={`${t('log.label.team')}：${bySeat(game, sent.team).map((id) => {
          const p = game.players.find((x) => x.id === id);
          return p ? seatLabel(p.seat, p.name) : '';
        }).join('、')}`}>
          {bySeat(game, sent.team).map((id) => {
            const p = game.players.find((x) => x.id === id);
            if (!p) return null;
            const leads = id === sent.leader;
            return (
              <span key={id} className="log-crew-seat" data-leader={leads || undefined} aria-hidden="true">
                {leads && <GameIcon name="leader" className="log-crew-crown" />}
                <PlayerAvatar playerId={p.id} avatarUrl={p.claimed === false ? undefined : p.avatarUrl} name={p.name}
                  className="log-crew-face" />
                <span className="log-crew-n tabular-nums">{p.seat + 1}</span>
                <span className="log-crew-name">{p.name}</span>
              </span>
            );
          })}
        </div>
      )}
      {quest.body.length > 0 && (
        <div className="log-quest-body">
          {quest.body.map((item) => item.kind === 'proposal' ? (
            <ProposalRecord key={item.key} chapter={item} game={game} limit={limit} status={status(item)}
              format={format} clock={clock} />
          ) : (
            <p key={item.entry.seq} className="log-quest-line" data-admin={item.entry.style === 'admin' || undefined}>
              {format(item.entry)}
            </p>
          ))}
        </div>
      )}
    </article>
  );
}

/**
 * One nomination: who led and whom they sent, then how each seat voted,
 * yes and no on their own rows; while it is in play, who has spoken.
 */
export function ProposalRecord({
  chapter,
  game,
  limit,
  status,
  format,
  clock,
}: {
  chapter: ProposalChapter;
  game: ClientGameState;
  limit: number;
  /** What the table is doing now, on the nomination still in play. */
  status: string | null;
  format: (entry: ClientLogEntry) => string;
  clock: (at: number) => string;
}) {
  const t = useTranslations();
  const { record, leader } = chapter;
  const team = bySeat(game, chapter.team);
  const sides = (['approve', 'reject'] as const).map((vote) => ({
    vote,
    ids: bySeat(game, (record?.votes ?? []).filter((b) => b.vote === vote).map((b) => b.playerId)),
  }));
  const [approves, rejects] = sides.map((s) => s.ids.length) as [number, number];
  const verdict = record ? (record.approved ? 'approved' : 'rejected') : 'open';
  // While the table talks, every seat in the speaking order shows whether it has had its turn.
  const discussion = chapter.live && game.phase === 'Discussion' ? game.discussion : null;
  const spoken = chapter.speeches.flatMap((e) => typeof e.params?.player === 'string' ? [e.params.player] : []);
  const speakers = bySeat(game, discussion ? discussion.order : [...new Set(spoken)]);
  const toneOf = (id: string) => {
    if (!discussion) return 'ring' as const;
    const turn = discussion.order.indexOf(id);
    return turn < discussion.speakerIndex ? 'spoken' as const : turn === discussion.speakerIndex ? 'speaking' as const : 'waiting' as const;
  };

  return (
    <section className="log-nomination" data-verdict={verdict} data-live={status ? true : undefined}
      aria-label={t('log.proposalOf', { n: chapter.proposal, limit })}>
      <div className="log-nomination-line">
        <span className="log-nomination-n tabular-nums" data-last={chapter.proposal >= limit || undefined}
          title={`${t('log.proposalOf', { n: chapter.proposal, limit })} · ${clock(chapter.at)}`}>
          #{chapter.proposal}
        </span>
        <LogCoin game={game} id={leader} tone="ring" crowned />
        {team.length > 0 && <span className="log-nomination-arrow" aria-hidden="true">→</span>}
        {team.map((id) => <LogCoin key={id} game={game} id={id} />)}
        {record ? (
          <span className="log-verdict" data-verdict={verdict} role="img"
            aria-label={`${record.approved ? t('vote.approved') : t('vote.rejectedResult')} · ${t('vote.tally', { approves, rejects })}`}>
            {record.approved ? t('vote.approved') : t('log.verdictRejected')}
            <span className="tabular-nums" aria-hidden="true">{approves}:{rejects}</span>
          </span>
        ) : status ? <span className="log-verdict" data-verdict="open">{status}</span> : null}
      </div>

      {chapter.draft && (
        <div className="log-nomination-row">
          <span className="log-nomination-label">{t('log.label.draft')}</span>
          {bySeat(game, chapter.draft).map((id) => (
            <LogCoin key={id} game={game} id={id} tone={chapter.team.includes(id) ? 'ring' : 'dropped'} />
          ))}
        </div>
      )}

      {record && sides.map(({ vote, ids }) => (
        <div key={vote} className="log-nomination-row" data-vote={vote}>
          <span className="log-nomination-label">{t(`log.label.${vote}`)}</span>
          {ids.length ? ids.map((id) => <LogStone key={id} game={game} id={id} vote={vote} />)
            : <span className="log-nomination-none" aria-hidden="true">—</span>}
        </div>
      ))}

      {discussion ? (
        <div className="log-nomination-row">
          <span className="log-nomination-label">{t('log.label.speeches')}</span>
          {speakers.map((id) => <LogCoin key={id} game={game} id={id} tone={toneOf(id)} />)}
        </div>
      ) : speakers.length > 0 && (
        <details className="log-speeches">
          <summary className="log-nomination-row">
            <span className="log-nomination-label">{t('log.label.speeches')}</span>
            {speakers.map((id) => <LogCoin key={id} game={game} id={id} tone={toneOf(id)} />)}
          </summary>
          {chapter.speeches.length > 0 && (
            <ol className="log-speech-lines">
              {chapter.speeches.map((entry) => (
                <li key={entry.seq} data-admin={entry.style === 'admin' || undefined}>
                  <span className="tabular-nums">{clock(entry.at)}</span>
                  {format(entry)}
                </li>
              ))}
            </ol>
          )}
        </details>
      )}
    </section>
  );
}
