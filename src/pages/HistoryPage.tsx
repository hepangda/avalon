import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useFormatter, useTranslations } from 'use-intl';
import { Link } from '@/i18n/navigation';
import { AccountAvatar } from '@/components/AccountSettings';
import { GameIcon, RolePortrait } from '@/components/game/GameArt';
import { PreferencesButton } from '@/components/PreferencesButton';
import { accountDisplayName } from '@/lib/auth/types';
import { useAuthIdentity } from '@/lib/auth/useAuthIdentity';
import type { HistoryGame, HistoryGamesPage, HistoryProfile, HistoryScope, TeamRecord } from '@/lib/game/historyTypes';
import { teamOf } from '@/lib/engine';
import { outcomeReasonKey } from '@/lib/game/outcomeText';
import { useRoleText } from '@/lib/game/useRoleText';
import '@/styles/history.css';

const percent = ({ games, wins }: TeamRecord) => (games ? Math.round((wins / games) * 100) : 0);

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<T>;
}

export default function HistoryPage() {
  const t = useTranslations();
  const [profile, setProfile] = useState<HistoryProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    getJson<HistoryProfile>('/api/history', controller.signal)
      .then(setProfile)
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [attempt]);

  return (
    <main className="table-screen history-screen">
      <header className="table-header">
        <div className="table-title">
          <Link href="/" className="table-tool -ml-2.5 shrink-0" aria-label={t('common.backHome')} title={t('common.backHome')}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 5-7 7 7 7M5 12h14" />
            </svg>
          </Link>
          <h1 className="table-title-name">{t('history.title')}</h1>
        </div>
        <PreferencesButton />
      </header>
      <div className="history-workspace">
        <Dossier profile={profile} failed={failed} onRetry={() => setAttempt((n) => n + 1)} />
        <Chronicle />
      </div>
    </main>
  );
}

/** The player's plate: score medallion, sides, the roles they have held, and recent form. */
function Dossier({ profile, failed, onRetry }: { profile: HistoryProfile | null; failed: boolean; onRetry: () => void }) {
  const t = useTranslations();
  const roleText = useRoleText();
  const { user } = useAuthIdentity();
  // Sides and roles read as wins over games, or as a win rate; tapping any of them flips all.
  const [asRate, setAsRate] = useState(false);
  const toggleRate = () => setAsRate((value) => !value);
  return (
    <section className="history-dossier" aria-label={t('history.dossier')} aria-busy={!profile && !failed}>
      <div className="history-plate">
        <div className="history-medal" data-title={profile?.rating.title}>
          <GameIcon name="crest" className="history-medal-crest" />
          {profile && <ScoreTrend scores={profile.trend} />}
          <strong className="history-score tabular-nums">{profile ? profile.rating.score : '—'}</strong>
        </div>
        <div className="history-identity">
          {user && (
            <p className="history-name">
              <AccountAvatar user={user} className="history-avatar" />
              <span className="truncate">{accountDisplayName(user)}</span>
            </p>
          )}
          {profile && <>
            <p className="history-title">{t(`history.titles.${profile.rating.title}`)}</p>
            <p className="history-confidence">
              {t(`history.confidence.${profile.rating.confidence}`)} · {t('history.ratedGames', { count: profile.rating.ratedGames })}
            </p>
          </>}
          {failed && (
            <p role="alert" className="history-error">
              {t('history.loadFailed')}
              <button type="button" onClick={onRetry}>{t('history.retry')}</button>
            </p>
          )}
        </div>
      </div>

      {profile && <>
        <dl className="history-record">
          <div>
            <dt>{t('history.games')}</dt>
            <dd className="tabular-nums">{profile.total.games + (profile.unresolvedGames ?? 0)}</dd>
          </div>
          <div>
            <dt>{t('history.wins')}</dt>
            <dd className="tabular-nums">{profile.total.wins}</dd>
          </div>
          <div>
            <dt>{t('history.winRate')}</dt>
            <dd className="tabular-nums">{profile.unresolvedGames && !profile.total.games ? '—' : <>{percent(profile.total)}<small>%</small></>}</dd>
          </div>
        </dl>

        {!!profile.unresolvedGames && <p className="text-xs text-parchment/60">{t('history.unresolved', { count: profile.unresolvedGames })}</p>}
        <div className="history-sides">
          {(['good', 'evil'] as const).map((team) => {
            const record = profile.teams[team];
            return (
              <button key={team} type="button" className="history-side" data-team={team}
                style={{ '--rate': `${percent(record)}%` } as CSSProperties}
                aria-pressed={asRate} onClick={toggleRate}
                aria-label={t('history.sideRecord', { team: roleText.teamShort(team), wins: record.wins, games: record.games })}>
                <GameIcon name={team === 'good' ? 'crestGood' : 'crest'} className="history-side-crest" />
                <span className="history-side-name">{roleText.teamShort(team)}</span>
                <RecordCount record={record} asRate={asRate} className="history-side-count" />
                <span className="history-side-bar" aria-hidden="true" />
              </button>
            );
          })}
        </div>

        {profile.roles.length > 0 && (
          <ol className="history-roles" aria-label={t('history.roles')}>
            {profile.roles.map(({ role, games, wins }) => (
              <li key={role}>
                <button type="button" className="history-role" data-team={teamOf(role)}
                  aria-pressed={asRate} onClick={toggleRate}
                  title={`${roleText.name(role)} · ${t('history.winsOf', { wins, games })}`}>
                  <RolePortrait role={role} className="history-role-art" />
                  <span className="history-role-name">{roleText.shortName(role)}</span>
                  <RecordCount record={{ games, wins }} asRate={asRate} className="history-role-count" />
                </button>
              </li>
            ))}
          </ol>
        )}

        {profile.form.length > 0 && (
          <ol className="history-form" aria-label={t('history.form')}>
            {profile.form.map((won, i) => (
              <li key={i} className="history-seal" data-result={won ? 'won' : 'lost'} title={t(won ? 'history.win' : 'history.loss')}>
                <GameIcon name={won ? 'missionSuccess' : 'missionFail'} alt={t(won ? 'history.win' : 'history.loss')} />
              </li>
            ))}
          </ol>
        )}
      </>}
    </section>
  );
}

/** Wins over games, or the win rate; remounts on each flip so the new reading fades in. */
function RecordCount({ record, asRate, className }: { record: TeamRecord; asRate: boolean; className: string }) {
  return (
    <span key={String(asRate)} className={`${className} history-flip tabular-nums`} aria-hidden="true">
      {asRate
        ? record.games ? <>{percent(record)}<small>%</small></> : '—'
        : <>{record.wins}<i>/</i>{record.games}</>}
    </span>
  );
}

type Point = readonly [x: number, y: number];

/** A monotone cubic through the points, so the curve never swings past a score it did not reach. */
function smoothPath(points: Point[]) {
  const slope = (i: number) => (points[i + 1]![1] - points[i]![1]) / (points[i + 1]![0] - points[i]![0]);
  const tangents = points.map((_, i) => {
    if (i === 0) return slope(0);
    if (i === points.length - 1) return slope(i - 1);
    const [a, b] = [slope(i - 1), slope(i)];
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  });
  return points.reduce((path, [x, y], i) => {
    if (i === 0) return `M${x} ${y}`;
    const [px, py] = points[i - 1]!;
    const dx = (x - px) / 3;
    return `${path} C${px + dx} ${py + tangents[i - 1]! * dx} ${x - dx} ${y - tangents[i]! * dx} ${x} ${y}`;
  }, '');
}

/** The score's recent path as a gilt ridge behind the number, rising to the latest game on the right. */
function ScoreTrend({ scores }: { scores: number[] }) {
  const id = `trend${useId().replace(/\W/g, '')}`;
  if (scores.length < 2) return null;
  const low = Math.min(...scores);
  const high = Math.max(...scores);
  // A few points of drift should not read as a cliff.
  const pad = Math.max(0, 60 - (high - low)) / 2;
  const line = smoothPath(scores.map((score, i): Point => [
    -4 + (i / (scores.length - 1)) * 108,
    82 - ((score - low + pad) / (high - low + 2 * pad)) * 44,
  ]));
  return (
    <svg className="history-trend" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.35" stopColor="#d9b54a" stopOpacity="0.32" />
          <stop offset="1" stopColor="#d9b54a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="history-trend-area" d={`${line} L104 100 L-4 100 Z`} fill={`url(#${id})`} />
      <path className="history-trend-line" d={line} />
    </svg>
  );
}

/** Every game, newest first. */
function Chronicle() {
  const t = useTranslations();
  const [scope, setScope] = useState<HistoryScope>('mine');
  return (
    <section className="history-chronicle" aria-label={t('history.chronicle')}>
      <div role="tablist" aria-label={t('history.scope')} className="history-scope">
        {(['mine', 'all'] as const).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={scope === value}
            className="history-scope-tab" onClick={() => setScope(value)}>
            {t(`history.scopes.${value}`)}
          </button>
        ))}
      </div>
      <GameList key={scope} scope={scope} />
    </section>
  );
}

/** Loads on as its end scrolls into view. */
function GameList({ scope }: { scope: HistoryScope }) {
  const t = useTranslations();
  const [games, setGames] = useState<HistoryGame[]>([]);
  const [offset, setOffset] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const [status, setStatus] = useState<'loading' | 'idle' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const end = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    getJson<HistoryGamesPage>(`/api/history/games?scope=${scope}&offset=${offset}`, controller.signal)
      .then((page) => {
        setGames((current) => [...current, ...page.games]);
        setNext(page.next);
        setStatus('idle');
      })
      .catch(() => { if (!controller.signal.aborted) setStatus('failed'); });
    return () => controller.abort();
  }, [scope, offset, attempt]);

  useEffect(() => {
    const target = end.current;
    if (!target || status !== 'idle' || next === null) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setOffset(next);
    }, { rootMargin: '240px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [status, next]);

  return (
    <ol className="history-games" aria-busy={status === 'loading'}>
      {games.map((game) => <GameRow key={game.gameId} game={game} />)}
      <li ref={end} className="history-games-end">
        {status === 'failed' ? (
          <p role="alert">
            {t('history.loadFailed')}
            <button type="button" onClick={() => setAttempt((n) => n + 1)}>{t('history.retry')}</button>
          </p>
        ) : status === 'loading' ? (
          <span className="history-loading" role="status" aria-label={t('history.loading')} />
        ) : games.length === 0 ? (
          <p className="history-empty">
            <GameIcon name="crest" className="history-empty-crest" />
            {t('history.empty')}
          </p>
        ) : null}
      </li>
    </ol>
  );
}

function GameRow({ game }: { game: HistoryGame }) {
  const t = useTranslations();
  const format = useFormatter();
  const roleText = useRoleText();
  const { seat } = game;
  const verdict = seat ? t(seat.won ? 'history.win' : 'history.loss')
    : t(game.winner === 'good' ? 'gameOver.goodTriumphs' : 'gameOver.evilPrevails');
  return (
    <li>
      <Link href={`/replay/${encodeURIComponent(game.gameId)}`} className="history-game"
        data-result={seat ? (seat.won ? 'win' : 'loss') : undefined} data-winner={game.winner}>
        <span className="history-game-face" data-team={seat ? teamOf(seat.role) : game.winner}>
          {seat
            ? <RolePortrait role={seat.role} variant={seat.variant} alt={roleText.name(seat.role)} className="history-game-art" />
            : <GameIcon name={game.winner === 'good' ? 'crestGood' : 'crest'} className="history-game-art is-crest" />}
        </span>
        <span className="history-game-main">
          <strong className="history-game-verdict">{verdict}</strong>
          <span className="history-game-meta">
            {game.endedAt ? format.dateTime(new Date(game.endedAt), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null}
            <span>{t('history.players', { count: game.playerCount })}</span>
            {seat && <span>{roleText.shortName(seat.role)}</span>}
            {game.participationOnly && <span>{t('history.participationOnly')}</span>}
          </span>
        </span>
        <span className="history-game-quests" aria-label={t(`gameOver.${outcomeReasonKey(game)}`)}>
          {game.missions.map((success, i) => (
            <span key={i} className="history-seal" data-result={success ? 'success' : 'fail'}>
              <GameIcon name={success ? 'missionSuccess' : 'missionFail'} />
            </span>
          ))}
          {(game.reason === 'assassinated_merlin' || game.reason === 'assassin_missed') && (
            <span className="history-seal" data-result={game.reason === 'assassinated_merlin' ? 'strike' : 'parried'}>
              <GameIcon name="assassinate" />
            </span>
          )}
        </span>
        {seat && (
          <span className="history-game-score">
            {seat.delta !== null
              ? <b className="tabular-nums" data-sign={Math.sign(seat.delta)}>{seat.delta > 0 ? `+${seat.delta}` : seat.delta}</b>
              : <small>{t(`history.unrated.${game.unrated ?? 'legacy'}`)}</small>}
          </span>
        )}
      </Link>
    </li>
  );
}
