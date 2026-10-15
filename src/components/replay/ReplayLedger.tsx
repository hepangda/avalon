import type { CSSProperties } from 'react';
import { useTranslations } from 'use-intl';
import { GameIcon } from '@/components/game/GameArt';
import { seatLabel } from '@/lib/game/playerLabel';
import type { ReplayMissionView, ReplayModel, ReplayProposalView, ReplaySeat } from '@/lib/game/replayModel';
import { cn } from '@/lib/utils/cn';
import { SeatPortrait } from './ReplayMarks';

/** Players across, every nomination down: the table's full vote sheet with revealed roles. */
export function ReplayLedger({
  model,
  focusPlayer,
  focusKey,
  onSelectPlayer,
  onSelectEvent,
}: {
  model: ReplayModel;
  focusPlayer: string | null;
  focusKey: string | null;
  onSelectPlayer: (id: string) => void;
  onSelectEvent: (key: string) => void;
}) {
  const t = useTranslations();
  const { players } = model;
  const missions = model.missions.filter((m) => m.proposals.length > 0);
  const colClass = (p: ReplaySeat) => cn(p.id === focusPlayer && 'is-focus');

  return (
    <div className="replay-ledger-scroll">
      <table className="replay-ledger" style={{ '--seats': players.length } as CSSProperties}>
        <colgroup>
          <col className="replay-ledger-label-col" />
          {players.map((p) => <col key={p.id} />)}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="replay-ledger-corner">
              <span className="sr-only">{t('replay.ledger')}</span>
            </th>
            {players.map((p) => (
              <th key={p.id} scope="col" className={colClass(p)} data-team={p.team}>
                <button
                  type="button"
                  className="replay-ledger-player"
                  aria-label={t('replay.seatColumn', { seat: p.seat + 1, name: p.name })}
                  aria-pressed={p.id === focusPlayer}
                  onClick={() => onSelectPlayer(p.id)}
                >
                  <SeatPortrait player={p} className="replay-ledger-portrait" />
                  <span className="replay-ledger-seat tabular-nums">{p.seat + 1}</span>
                  <span className="replay-ledger-name">{p.name}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        {missions.map((mission) => (
          <tbody key={mission.roundIndex} data-round={mission.roundIndex}>
            <tr className="replay-ledger-mission">
              <th scope="rowgroup" colSpan={players.length + 1}>
                <button
                  type="button"
                  className="replay-ledger-mission-bar"
                  aria-current={focusKey === `m${mission.roundIndex}` ? 'true' : undefined}
                  onClick={() => onSelectEvent(`m${mission.roundIndex}`)}
                >
                  <span className="font-serif text-gold">{t('replay.mission', { n: mission.roundIndex + 1 })}</span>
                  <span className="text-parchment/45">{t('replay.missionSize', { size: mission.size })}</span>
                  {mission.requiredFails === 2 && <TwoFailShield label={t('table.twoFails')} />}
                  <MissionVerdict mission={mission} />
                </button>
              </th>
            </tr>
            {mission.proposals.map((proposal) => (
              <ProposalRow
                key={proposal.key}
                proposal={proposal}
                players={players}
                colClass={colClass}
                focused={focusKey === proposal.key}
                onSelect={() => onSelectEvent(proposal.key)}
              />
            ))}
            {mission.success !== null && (
              <tr className="replay-ledger-cards" data-result={mission.success ? 'success' : 'fail'}>
                <th scope="row">
                  <GameIcon
                    name={mission.success ? 'missionSuccess' : 'missionFail'}
                    className="replay-ledger-row-icon"
                    alt={t('replay.cards')}
                  />
                </th>
                {players.map((p) => {
                  const card = mission.cards.get(p.id);
                  return (
                    <td key={p.id} className={colClass(p)} data-team={p.team}>
                      {card && (
                        <span
                          className="replay-card"
                          data-card={card}
                          role="img"
                          aria-label={`${seatLabel(p.seat, p.name)} · ${t(card === 'fail' ? 'replay.playedFail' : 'replay.playedSuccess')}`}
                        >
                          <GameIcon name={card === 'fail' ? 'missionFail' : 'missionSuccess'} className="h-full w-full" />
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            )}
            {mission.lady && (
              <tr className="replay-ledger-lady">
                <th scope="row">
                  <GameIcon name="lady" className="replay-ledger-row-icon" alt={t('replay.lady')} />
                </th>
                {players.map((p) => (
                  <td key={p.id} className={colClass(p)} data-team={p.team}>
                    {p.id === mission.lady!.holderPlayerId && (
                      <GameIcon name="lady" className="replay-ledger-mark" alt={t('replay.lady')} />
                    )}
                    {p.id === mission.lady!.targetPlayerId && (
                      <span className="replay-ledger-verdict" data-team={mission.lady!.revealedTeam}>
                        {t(`team.${mission.lady!.revealedTeam}`)}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        ))}
        {model.assassination && (
          <tbody>
            <tr className="replay-ledger-mission">
              <th scope="rowgroup" colSpan={players.length + 1}>
                <button
                  type="button"
                  className="replay-ledger-mission-bar"
                  aria-current={focusKey === 'strike' ? 'true' : undefined}
                  onClick={() => onSelectEvent('strike')}
                >
                  <span className="font-serif text-crimson-bright">
                    {t(model.earlyStrike ? 'replay.earlyStrike' : 'replay.assassination')}
                  </span>
                  <span
                    className="replay-pill"
                    data-tone={model.assassination.hitMerlin ? 'evil' : 'good'}
                  >
                    {t(model.assassination.hitMerlin ? 'replay.hitMerlin' : 'replay.missedMerlin')}
                  </span>
                </button>
              </th>
            </tr>
            <tr className="replay-ledger-strike">
              <th scope="row">
                <GameIcon name="assassinate" className="replay-ledger-row-icon" alt={t('replay.assassination')} />
              </th>
              {players.map((p) => (
                <td key={p.id} className={colClass(p)} data-team={p.team}>
                  {p.id === model.assassination!.assassinPlayerId && (
                    <GameIcon name="assassinate" className="replay-ledger-mark" />
                  )}
                  {p.id === model.assassination!.targetPlayerId && (
                    <span className="replay-ledger-target" data-hit={model.assassination!.hitMerlin}>
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <circle cx="10" cy="10" r="7.5" />
                        <path d="M10 1v5M10 14v5M1 10h5M14 10h5" />
                      </svg>
                    </span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        )}
      </table>
    </div>
  );
}

function ProposalRow({
  proposal,
  players,
  colClass,
  focused,
  onSelect,
}: {
  proposal: ReplayProposalView;
  players: ReplaySeat[];
  colClass: (p: ReplaySeat) => string | undefined;
  focused: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations();
  return (
    <tr className={cn('replay-ledger-proposal', focused && 'is-current')} data-approved={proposal.approved}>
      <th scope="row">
        <button
          type="button"
          className="replay-ledger-proposal-label"
          aria-label={`${t('replay.proposal', { n: proposal.proposalIndex + 1 })} · ${t(proposal.approved ? 'replay.approved' : 'replay.rejected')} · ${t('replay.tallyLabel', { approves: proposal.approves, rejects: proposal.rejects })}`}
          onClick={onSelect}
        >
          <span className="replay-ledger-proposal-n">{proposal.proposalIndex + 1}</span>
          <span className="replay-ledger-tally tabular-nums">{proposal.approves}:{proposal.rejects}</span>
        </button>
      </th>
      {players.map((p) => {
        const vote = proposal.votes.get(p.id);
        const onTeam = proposal.team?.includes(p.id) ?? false;
        const leads = proposal.leaderId === p.id;
        const label = [
          seatLabel(p.seat, p.name),
          vote && t(vote === 'approve' ? 'replay.approvers' : 'replay.rejecters'),
          onTeam && t('replay.team'),
          leads && t('replay.leader'),
        ].filter(Boolean).join(' · ');
        return (
          <td key={p.id} className={colClass(p)} data-team={p.team}>
            <span className="replay-vote" data-on-team={onTeam || undefined} role="img" aria-label={label}>
              {vote && (
                <GameIcon name={vote === 'approve' ? 'approve' : 'reject'} className="replay-stone" />
              )}
              {leads && <GameIcon name="leader" className="replay-crown" />}
            </span>
          </td>
        );
      })}
    </tr>
  );
}

export function MissionVerdict({ mission }: { mission: ReplayMissionView }) {
  const t = useTranslations();
  if (mission.success === null)
    return <span className="replay-pill">{t('replay.noTeamApproved')}</span>;
  return (
    <span className="replay-pill" data-tone={mission.success ? 'good' : 'evil'}>
      {t(mission.success ? 'replay.missionSuccess' : 'replay.missionFail')}
      {!!mission.failCount && <> · {t('replay.failCount', { count: mission.failCount })}</>}
    </span>
  );
}

export function TwoFailShield({ label }: { label: string }) {
  return (
    <span className="replay-shield" title={label} role="img" aria-label={label}>
      <svg viewBox="0 0 16 18" fill="none" aria-hidden="true">
        <path
          d="M8 1.5 14 4v4.5c0 3.5-2.5 6-6 8-3.5-2-6-4.5-6-8V4l6-2.5Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
