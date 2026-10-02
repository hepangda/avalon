import { TableSheet } from './TableSheet';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/Button';
import { VoteResultPanel } from './VoteResultPanel';
import { MissionCardReveal } from './MissionCardReveal';
import type { ClientGameState } from '@/lib/engine';

/**
 * Modal showing a single round's full history: every proposal vote for that
 * round (approved & rejected) and the mission outcome. Opened by tapping a
 * quest on the MissionTrack. `roundIndex` null = closed.
 */
export function RoundHistoryModal({
  roundIndex,
  game,
  onClose,
}: {
  roundIndex: number | null;
  game: ClientGameState;
  onClose: () => void;
}) {
  const t = useTranslations();
  const open = roundIndex !== null;
  const votes = open ? game.voteHistory.filter((v) => v.roundIndex === roundIndex) : [];
  const result = open ? game.missionResults.find((m) => m.roundIndex === roundIndex) : undefined;

  return (
    <TableSheet open={open} title={t('mission.roundDetail', { n: (roundIndex ?? 0) + 1 })} onClose={onClose}>
            {roundIndex !== null && game.config.requiredFails[roundIndex] === 2 && (
              <p className="mb-3 text-sm text-gold">{t('table.twoFails')}</p>
            )}

            {/* Mission outcome — title + revealed cards, matching the cue. */}
            <div className="mb-3 rounded-lg border border-gold/15 bg-ink/30 p-3">
              {result ? (
                <div className="space-y-2">
                  <p
                    className={`text-center font-serif text-lg ${
                      result.success ? 'text-sky-300' : 'text-crimson'
                    }`}
                  >
                    {result.success ? t('missionResult.succeeds') : t('missionResult.sabotaged')}
                  </p>
                  <MissionCardReveal
                    teamSize={result.teamSize}
                    failCount={result.failCount}

                  />
                </div>
              ) : (
                <p className="text-center text-sm text-parchment/50">{t('mission.notPlayed')}</p>
              )}
            </div>

            {/* Votes this round */}
            <p className="mb-1.5 text-xs uppercase tracking-wide text-parchment/50">
              {t('mission.votesThisRound')}
            </p>
            {votes.length > 0 ? (
              <div className="space-y-3">
                {votes.map((v) => (
                  <div
                    key={v.proposalIndex}
                    className="rounded-lg border border-gold/10 bg-ink/20 p-2.5"
                  >
                    <VoteResultPanel record={v} game={game} showProposalLabel />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-parchment/50">{t('mission.noHistory')}</p>
            )}

            <Button variant="secondary" className="mt-4 w-full" onClick={onClose}>
              {t('mission.close')}
            </Button>
    </TableSheet>
  );
}
