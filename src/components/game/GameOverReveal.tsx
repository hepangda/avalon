'use client';

import { motion } from 'framer-motion';
import { useTranslations } from 'use-intl';
import { Link } from '@/i18n/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ROLE_SIGIL, TEAM_COLOR } from '@/lib/game/roleMeta';
import { useRoleText } from '@/lib/game/useRoleText';
import { labelById } from '@/lib/game/playerLabel';
import type { ClientGameState } from '@/lib/engine';

export function GameOverReveal({
  game,
  gameId,
}: {
  game: ClientGameState;
  gameId?: string | null;
}) {
  const t = useTranslations();
  const roleText = useRoleText();
  const outcome = game.outcome;
  if (!outcome) return null;
  const goodWon = outcome.winner === 'good';
  const nameOf = (id: string) => labelById(game, id);

  const reasonKey =
    outcome.reason === 'five_rejections'
      ? 'gameOver.reasonFiveRejections'
      : outcome.reason === 'assassinated_merlin'
        ? 'gameOver.reasonAssassinatedMerlin'
        : outcome.reason === 'assassin_missed'
          ? 'gameOver.reasonAssassinMissed'
          : 'gameOver.reasonThreeMissions';

  return (
    <div className="mx-auto max-w-md space-y-5 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 160, damping: 14 }}
        className="text-center"
      >
        <p className="text-5xl">{goodWon ? '⚜️' : '🗡️'}</p>
        <h1 className={`font-serif text-4xl ${goodWon ? 'text-sky-300' : 'text-crimson'}`}>
          {goodWon ? t('gameOver.goodTriumphs') : t('gameOver.evilPrevails')}
        </h1>
        <p className="mt-1 text-sm text-parchment/60">{t(reasonKey)}</p>
        <p className="mt-1 text-xs text-parchment/50">
          {t('gameOver.questTally', {
            good: outcome.missionTally.good,
            evil: outcome.missionTally.evil,
          })}
        </p>
      </motion.div>

      <Card className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-parchment/50">
          {t('gameOver.courtRevealed')}
        </p>
        <ul className="space-y-1.5">
          {outcome.revealedRoles
            .slice()
            .sort((a, b) => {
              const sa = game.players.find((p) => p.id === a.playerId)?.seat ?? 0;
              const sb = game.players.find((p) => p.id === b.playerId)?.seat ?? 0;
              return sa - sb;
            })
            .map((r, i) => (
              <motion.li
                key={r.playerId}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.08 }}
                className="flex items-center justify-between rounded-lg border border-gold/15 bg-ink/30 px-3 py-2"
              >
                <span className="flex items-center gap-2">
                  <span>{ROLE_SIGIL[r.role]}</span>
                  <span className="text-parchment">{nameOf(r.playerId)}</span>
                  {outcome.assassinTargetId === r.playerId && (
                    <span className="text-xs text-crimson">{t('gameOver.targeted')}</span>
                  )}
                </span>
                <span className={`text-sm ${TEAM_COLOR[r.team]}`}>{roleText.name(r.role)}</span>
              </motion.li>
            ))}
        </ul>
      </Card>

      <div className="flex gap-3">
        {gameId && (
          <Link href={`/replay/${gameId}`} className="flex-1">
            <Button variant="secondary" className="w-full">
              {t('gameOver.viewReplay')}
            </Button>
          </Link>
        )}
        <Link href="/" className="flex-1">
          <Button className="w-full">{t('gameOver.newGame')}</Button>
        </Link>
      </div>
    </div>
  );
}
