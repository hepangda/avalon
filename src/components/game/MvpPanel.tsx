'use client';

import { useTranslations } from 'use-intl';
import { Card } from '@/components/ui/Card';
import { ROLE_SIGIL, TEAM_COLOR } from '@/lib/game/roleMeta';
import { useRoleText } from '@/lib/game/useRoleText';
import { seatLabel } from '@/lib/game/playerLabel';
import type { ReplayData } from '@/lib/game/replayTypes';
import { computeReplayStats } from '@/lib/game/replayStats';

function pct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}

export function MvpPanel({ replay }: { replay: ReplayData }) {
  const t = useTranslations();
  const roleText = useRoleText();
  const stats = computeReplayStats(replay);
  const roleOf = new Map(replay.roleAssignments.map((r) => [r.playerId, r.role]));
  const seatOf = new Map(replay.players.map((p) => [p.id, p.seat]));

  return (
    <Card className="space-y-3">
      <h2 className="font-serif text-xl text-gold">{t('mvp.title')}</h2>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-parchment/50">
              <th className="px-1 py-1 text-left font-normal"></th>
              <th className="px-1 py-1 text-right font-normal">{t('mvp.voteAccuracy')}</th>
              <th className="px-1 py-1 text-right font-normal">{t('mvp.participation')}</th>
              <th className="px-1 py-1 text-right font-normal">{t('mvp.contribution')}</th>
            </tr>
          </thead>
          <tbody>
            {stats.players.map((s) => {
              const role = roleOf.get(s.playerId);
              const isMvp = s.playerId === stats.mvpPlayerId;
              return (
                <tr
                  key={s.playerId}
                  className={`border-t border-gold/10 ${isMvp ? 'bg-gold/10' : ''}`}
                >
                  <td className="px-1 py-1.5">
                    <span className="flex items-center gap-1.5">
                      {role && <span>{ROLE_SIGIL[role]}</span>}
                      <span className="text-parchment">
                        {seatOf.has(s.playerId) ? seatLabel(seatOf.get(s.playerId)!, s.name) : s.name}
                      </span>
                      {isMvp && <span title={t('mvp.mvp')}>⭐</span>}
                      {role && (
                        <span className={`text-xs ${TEAM_COLOR[s.team]}`}>
                          {roleText.name(role)}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-1 py-1.5 text-right text-parchment/80">
                    {pct(s.voteAccuracy)}
                  </td>
                  <td className="px-1 py-1.5 text-right text-parchment/80">
                    {pct(s.missionParticipation)}
                  </td>
                  <td className="px-1 py-1.5 text-right text-parchment/80">
                    {pct(s.contribution)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
