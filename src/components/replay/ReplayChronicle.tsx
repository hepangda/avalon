import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { GameIcon } from '@/components/game/GameArt';
import type { ClientGameState, ClientLogEntry } from '@/lib/engine';
import { formatGameLog } from '@/lib/game/formatGameLog';
import { seatLabel } from '@/lib/game/playerLabel';
import type { ReplayMissionView, ReplayModel, ReplayProposalView } from '@/lib/game/replayModel';
import { useRoleText } from '@/lib/game/useRoleText';
import { cn } from '@/lib/utils/cn';
import { MissionVerdict, TwoFailShield } from './ReplayLedger';
import { SeatChip, SeatNumber, SeatPortrait } from './ReplayMarks';

/** Scroll only this pane; scrollIntoView would also move the fixed screen around it. */
export function scrollWithin(container: HTMLElement, target: HTMLElement | null, offset = 8) {
  if (!target) return;
  const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - offset;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  container.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
}

function clock(at: number | null) {
  if (!at) return null;
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Round-by-round account of every nomination, mission, inspection and the final strike. */
export function ReplayChronicle({
  model,
  focusKey,
  focusNonce,
  onSelectPlayer,
}: {
  model: ReplayModel;
  focusKey: string | null;
  focusNonce: number;
  onSelectPlayer: (id: string) => void;
}) {
  const t = useTranslations();
  const roleText = useRoleText();
  const scrollRef = useRef<HTMLDivElement>(null);
  const missions = model.missions.filter((m) => m.proposals.length > 0);
  const logGame = { players: model.players } as unknown as Pick<ClientGameState, 'players'>;
  const logLine = (entry: ClientLogEntry) => (
    <p key={entry.seq} className={cn('replay-log-line', entry.style === 'admin' && 'is-referee')}>
      {formatGameLog(entry, logGame, t, roleText.name)}
    </p>
  );

  useEffect(() => {
    const container = scrollRef.current;
    const target = focusKey ? container?.querySelector<HTMLElement>(`[data-key="${focusKey}"]`) : null;
    if (!container || !target) return;
    // Entries sit under their chapter's sticky heading.
    const heading = target.classList.contains('replay-chapter')
      ? 0
      : target.closest('.replay-chapter')?.querySelector('.replay-chapter-head')?.getBoundingClientRect().height ?? 0;
    scrollWithin(container, target, heading + 8);
  }, [focusKey, focusNonce]);

  const seats = (list: string[], muted = false) =>
    list.map((id) => {
      const player = model.byId.get(id);
      return player ? <SeatChip key={id} player={player} onSelect={onSelectPlayer} muted={muted} /> : null;
    });
  const numbers = (list: string[]) =>
    list.map((id) => {
      const player = model.byId.get(id);
      return player ? <li key={id}><SeatNumber player={player} /></li> : null;
    });

  return (
    <div ref={scrollRef} className="replay-chronicle">
      {missions.map((mission) => (
        <section key={mission.roundIndex} className="replay-chapter" data-key={`m${mission.roundIndex}`}>
          <header className="replay-chapter-head">
            <GameIcon
              name={mission.success === null ? 'crest' : mission.success ? 'missionSuccess' : 'missionFail'}
              className="replay-chapter-icon"
            />
            <h3 className="font-serif text-lg text-gold">{t('replay.mission', { n: mission.roundIndex + 1 })}</h3>
            <span className="text-sm text-parchment/45">{t('replay.missionSize', { size: mission.size })}</span>
            {mission.requiredFails === 2 && <TwoFailShield label={t('table.twoFails')} />}
            <MissionVerdict mission={mission} />
          </header>

          {mission.proposals.map((proposal) => (
            <ProposalEntry
              key={proposal.key}
              proposal={proposal}
              focused={focusKey === proposal.key}
              seats={seats}
              numbers={numbers}
              logLine={logLine}
              leader={proposal.leaderId ? model.byId.get(proposal.leaderId) : undefined}
              onSelectPlayer={onSelectPlayer}
            />
          ))}

          {mission.success !== null && <MissionCards mission={mission} model={model} onSelectPlayer={onSelectPlayer} />}

          {mission.lady && (
            <article className="replay-entry replay-lady" data-key={`lady${mission.roundIndex}`}>
              <GameIcon name="lady" className="replay-lady-art" />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-xs uppercase tracking-wide text-parchment/45">{t('replay.lady')}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {seats([mission.lady.holderPlayerId])}
                  <span aria-hidden="true" className="text-gold/60">→</span>
                  {seats([mission.lady.targetPlayerId])}
                </div>
                <span className="replay-pill" data-tone={mission.lady.revealedTeam}>
                  {t(`team.${mission.lady.revealedTeam}`)}
                </span>
              </div>
            </article>
          )}
        </section>
      ))}

      {(model.assassination || model.closingLog.length > 0) && (
        <section className="replay-chapter" data-key="strike">
          {model.assassination && (
            <>
              <header className="replay-chapter-head">
                <GameIcon name="assassinate" className="replay-chapter-icon" />
                <h3 className="font-serif text-lg text-crimson-bright">
                  {t(model.earlyStrike ? 'replay.earlyStrike' : 'replay.assassination')}
                </h3>
                <span className="replay-pill" data-tone={model.assassination.hitMerlin ? 'evil' : 'good'}>
                  {t(model.assassination.hitMerlin ? 'replay.hitMerlin' : 'replay.missedMerlin')}
                </span>
              </header>
              <article className="replay-entry">
                <div className="flex flex-wrap items-center gap-1.5">
                  {seats([model.assassination.assassinPlayerId])}
                  <GameIcon name="assassinate" className="h-6 w-6" />
                  {seats([model.assassination.targetPlayerId])}
                </div>
              </article>
            </>
          )}
          {model.closingLog.length > 0 && (
            <article className="replay-entry">{model.closingLog.map(logLine)}</article>
          )}
        </section>
      )}
    </div>
  );
}

function ProposalEntry({
  proposal,
  focused,
  leader,
  seats,
  numbers,
  logLine,
  onSelectPlayer,
}: {
  proposal: ReplayProposalView;
  focused: boolean;
  leader: ReturnType<ReplayModel['byId']['get']>;
  seats: (list: string[], muted?: boolean) => ReactNode;
  numbers: (list: string[]) => ReactNode;
  logLine: (entry: ClientLogEntry) => ReactNode;
  onSelectPlayer: (id: string) => void;
}) {
  const t = useTranslations();
  const approvers = [...proposal.votes].filter(([, v]) => v === 'approve').map(([id]) => id);
  const rejecters = [...proposal.votes].filter(([, v]) => v === 'reject').map(([id]) => id);
  const time = clock(proposal.startedAt);
  return (
    <article
      className={cn('replay-entry replay-proposal', focused && 'is-current')}
      data-key={proposal.key}
      data-approved={proposal.approved}
    >
      <div className="replay-proposal-head">
        {leader && (
          <button
            type="button"
            className="replay-proposal-leader"
            aria-label={`${t('replay.leader')} · ${seatLabel(leader.seat, leader.name)}`}
            onClick={() => onSelectPlayer(leader.id)}
          >
            <SeatPortrait player={leader} className="h-9 w-9" />
            <GameIcon name="leader" className="replay-proposal-crown" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-parchment/45">
            {t('replay.proposal', { n: proposal.proposalIndex + 1 })}
            {time && <span className="tabular-nums"> · {time}</span>}
          </p>
          {leader && <p className="truncate text-sm text-parchment">{seatLabel(leader.seat, leader.name)}</p>}
        </div>
        <span className="replay-pill" data-tone={proposal.approved ? 'good' : 'evil'}>
          {t(proposal.approved ? 'replay.approved' : 'replay.rejected')}
          <span className="tabular-nums"> {proposal.approves}:{proposal.rejects}</span>
        </span>
      </div>

      <dl className="replay-facts">
        {proposal.draftTeam && (
          <>
            <dt>{t('replay.draft')}</dt>
            <dd><ol className="replay-seat-row">{numbers(proposal.draftTeam)}</ol></dd>
          </>
        )}
        {proposal.team && (
          <>
            <dt>{t('replay.team')}</dt>
            <dd className="flex flex-wrap gap-1.5">{seats(proposal.team)}</dd>
          </>
        )}
        {proposal.speakers.length > 0 && (
          <>
            <dt>{t('replay.speakers')}</dt>
            <dd><ol className="replay-seat-row is-sequence">{numbers(proposal.speakers)}</ol></dd>
          </>
        )}
        <dt className="replay-vote-label">
          <GameIcon name="approve" className="h-4 w-4" />
          {t('replay.approvers')}
        </dt>
        <dd><ol className="replay-seat-row">{numbers(approvers)}</ol></dd>
        <dt className="replay-vote-label">
          <GameIcon name="reject" className="h-4 w-4" />
          {t('replay.rejecters')}
        </dt>
        <dd><ol className="replay-seat-row">{numbers(rejecters)}</ol></dd>
      </dl>
      {proposal.referee.length > 0 && <div className="space-y-1">{proposal.referee.map(logLine)}</div>}
    </article>
  );
}

function MissionCards({
  mission,
  model,
  onSelectPlayer,
}: {
  mission: ReplayMissionView;
  model: ReplayModel;
  onSelectPlayer: (id: string) => void;
}) {
  const t = useTranslations();
  return (
    <article className="replay-entry" data-key={`cards${mission.roundIndex}`}>
      <p className="mb-2 text-xs uppercase tracking-wide text-parchment/45">{t('replay.cards')}</p>
      <ul className="replay-cards">
        {(mission.team ?? []).map((id) => {
          const player = model.byId.get(id);
          const card = mission.cards.get(id);
          if (!player) return null;
          return (
            <li key={id}>
              <button
                type="button"
                className="replay-mission-card"
                data-card={card}
                data-team={player.team}
                onClick={() => onSelectPlayer(id)}
              >
                {card && <GameIcon name={card === 'fail' ? 'missionFail' : 'missionSuccess'} className="replay-mission-card-art" />}
                <span className="replay-mission-card-verdict">
                  {card ? t(card === 'fail' ? 'replay.playedFail' : 'replay.playedSuccess') : '—'}
                </span>
                <span className="replay-mission-card-name">{seatLabel(player.seat, player.name)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
