import { useTranslations } from 'use-intl';
import { RoleCard } from '@/components/game/RoleCard';
import { TableSheet } from '@/components/game/TableSheet';
import { seatLabel } from '@/lib/game/playerLabel';
import { playerStats, type ReplayModel } from '@/lib/game/replayModel';
import { useRoleText } from '@/lib/game/useRoleText';
import { SeatChip } from './ReplayMarks';

/** One player's revealed card, what they saw at the deal, and how they played. */
export function ReplayPlayerSheet({
  model,
  playerId,
  onSelectPlayer,
  onClose,
}: {
  model: ReplayModel;
  playerId: string | null;
  onSelectPlayer: (id: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const roleText = useRoleText();
  const player = playerId ? model.byId.get(playerId) : undefined;
  const sight = player ? model.knowledge(player.id) : [];
  const stats = player ? playerStats(model, player.id) : null;

  return (
    <TableSheet
      open={!!player}
      title={player ? seatLabel(player.seat, player.name) : ''}
      className="replay-sheet"
      onClose={onClose}
    >
      {player && stats && (
        <div className="replay-dossier">
          <div className="replay-dossier-side">
            {player.role && <RoleCard role={player.role} variant={player.variant} size="compact" />}
            {player.isBot && <span className="replay-pill">{t('replay.bot')}</span>}
          </div>
          <div className="replay-dossier-body">
            <section>
              <h3 className="replay-dossier-heading">{t('replay.knowledge')}</h3>
              {sight.length > 0 ? (
                <ul className="space-y-1.5">
                  {sight.map((seen) => {
                    const other = model.byId.get(seen.playerId);
                    if (!other) return null;
                    return (
                      <li key={seen.playerId} className="flex items-center gap-2">
                        <SeatChip player={other} onSelect={onSelectPlayer} />
                        <span className="replay-pill" data-tone={seen.shownAs === 'merlin-or-morgana' ? undefined : 'evil'}>
                          {seen.shownAs === 'known-ally' && seen.role
                            ? roleText.shortName(seen.role)
                            : t(`replay.seen.${seen.shownAs}`)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-parchment/45">{t('replay.sawNothing')}</p>
              )}
            </section>

            <section>
              <h3 className="replay-dossier-heading">{t('replay.stats')}</h3>
              <dl className="replay-stats">
                <Stat label={t('replay.statLed')} value={stats.led} />
                <Stat label={t('replay.statPicked')} value={stats.picked} />
                <Stat label={t('replay.statMissions')} value={stats.missions} />
                <Stat label={t('replay.statApproves')} value={stats.approves} />
                <Stat label={t('replay.statRejects')} value={stats.rejects} />
                <Stat label={t('replay.statFails')} value={stats.fails} tone={stats.fails ? 'evil' : undefined} />
                <Stat label={t('replay.statEvilTeams')} value={stats.approvedEvilTeams} wide />
              </dl>
            </section>
          </div>
        </div>
      )}
    </TableSheet>
  );
}

function Stat({ label, value, tone, wide }: { label: string; value: number; tone?: 'evil'; wide?: boolean }) {
  return (
    <div className="replay-stat" data-tone={tone} data-wide={wide || undefined}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
