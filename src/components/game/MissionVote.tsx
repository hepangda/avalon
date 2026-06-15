'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { gameActions } from '@/lib/socket/client';
import { ROLE_TEAM_UI } from '@/lib/game/roleMeta';
import { labelById } from '@/lib/game/playerLabel';
import type { ClientGameState } from '@/lib/engine';

export function MissionVote({
  game,
  myPlayerId,
}: {
  game: ClientGameState;
  myPlayerId: string | null;
}) {
  const t = useTranslations();
  const team = game.proposedTeam ?? [];
  const onTeam = !!myPlayerId && team.includes(myPlayerId);
  const myRole = game.selfRole;
  const isEvil = myRole ? ROLE_TEAM_UI[myRole] === 'evil' : false;
  const [played, setPlayed] = useState<'success' | 'fail' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const nameOf = (id: string) => labelById(game, id);

  async function play(card: 'success' | 'fail') {
    if (submitting || played) return;
    setSubmitting(true);
    setPlayed(card);
    const res = await gameActions.missionCard(card);
    if (!res.ok) setPlayed(null);
    setSubmitting(false);
  }

  return (
    <Card className="space-y-4">
      <div className="text-center">
        <h2 className="font-serif text-xl text-gold">{t('missionVote.title')}</h2>
        <p className="text-sm text-parchment/60">
          {t('game.missionOf', { round: game.roundIndex + 1 })} ·{' '}
          {game.config.requiredFails[game.roundIndex] === 2
            ? t('missionVote.twoFailsNeeded')
            : t('missionVote.oneFailSpoils')}
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {team.map((id) => (
          <span
            key={id}
            className="rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-sm text-parchment"
          >
            {nameOf(id)}
          </span>
        ))}
      </div>

      {onTeam ? (
        played ? (
          <p className="text-center text-sm text-parchment/60">{t('missionVote.sealed')}</p>
        ) : (
          <div className="flex items-stretch justify-center gap-4">
            <MissionChoiceCard
              kind="success"
              label={t('missionVote.success')}
              onClick={() => play('success')}
              disabled={submitting}
            />
            <MissionChoiceCard
              kind="fail"
              label={t('missionVote.fail')}
              onClick={() => play('fail')}
              disabled={submitting || !isEvil}
              lockedHint={!isEvil ? t('missionVote.loyalOnlySuccess') : undefined}
            />
          </div>
        )
      ) : (
        <p className="text-center text-sm text-parchment/50">{t('missionVote.watchAfar')}</p>
      )}
      {onTeam && !isEvil && !played && (
        <p className="text-center text-xs text-parchment/40">{t('missionVote.loyalOnlySuccess')}</p>
      )}
    </Card>
  );
}

function MissionChoiceCard({
  kind,
  label,
  onClick,
  disabled,
  lockedHint,
}: {
  kind: 'success' | 'fail';
  label: string;
  onClick: () => void;
  disabled?: boolean;
  lockedHint?: string;
}) {
  const isFail = kind === 'fail';
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={lockedHint}
      whileHover={disabled ? undefined : { scale: 1.05, y: -4 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      className={`relative flex h-32 w-24 flex-col items-center justify-center gap-2 rounded-xl border-2 shadow-lg transition-colors ${
        disabled
          ? 'cursor-not-allowed border-gold/20 bg-stone/40 opacity-50'
          : isFail
            ? 'border-crimson bg-crimson/30 hover:shadow-candle'
            : 'border-sky-300 bg-sky-600/30 hover:shadow-candle'
      }`}
    >
      <span className="text-4xl">{isFail ? '💀' : '✨'}</span>
      <span
        className={`text-sm font-bold ${
          disabled ? 'text-parchment/50' : isFail ? 'text-crimson-bright' : 'text-sky-200'
        }`}
      >
        {label}
      </span>
      {disabled && lockedHint && <span className="absolute right-1.5 top-1.5 text-xs">🔒</span>}
    </motion.button>
  );
}

