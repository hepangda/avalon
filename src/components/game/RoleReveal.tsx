'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { FlipCard } from '@/components/animations';
import { gameActions } from '@/lib/socket/client';
import { ROLE_SIGIL, ROLE_TEAM_UI, TEAM_COLOR } from '@/lib/game/roleMeta';
import { useRoleText } from '@/lib/game/useRoleText';
import { labelById } from '@/lib/game/playerLabel';
import type { ClientGameState, Role, VisibilityInfo } from '@/lib/engine';

interface RoleRevealProps {
  game: ClientGameState;
  reveal: { selfRole: Role; knownPlayers: VisibilityInfo[] } | null;
  myPlayerId: string | null;
}

export function RoleReveal({ game, reveal }: RoleRevealProps) {
  const t = useTranslations();
  const roleText = useRoleText();
  const [flipped, setFlipped] = useState(false);
  const [acking, setAcking] = useState(false);

  const role = reveal?.selfRole ?? game.selfRole;
  const team = role ? ROLE_TEAM_UI[role] : null;
  const nameOf = (id: string) => labelById(game, id);

  async function handleAck() {
    // The overlay closes when roleAcks (in projected state) includes us; no need
    // to track a local "waiting" state — each player enters independently.
    setAcking(true);
    const res = await gameActions.ackRole();
    if (!res.ok) setAcking(false);
  }

  function shownLabel(shownAs: VisibilityInfo['shownAs']): string {
    if (shownAs === 'evil') return t('roleReveal.shownEvil');
    if (shownAs === 'merlin-or-morgana') return t('roleReveal.shownMerlinOrMorgana');
    return t('roleReveal.shownAlly');
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-6 p-4">
      <h1 className="font-serif text-2xl text-gold">{t('roleReveal.title')}</h1>

      <FlipCard
        revealed={flipped}
        onClick={() => setFlipped(true)}
        className="h-64 w-44 cursor-pointer"
        back={
          <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl border-2 border-gold/50 bg-gradient-to-b from-stone to-ink shadow-2xl">
            <span className="text-5xl">⚜️</span>
            <span className="mt-3 text-xs uppercase tracking-widest text-parchment/50">
              {t('roleReveal.tapToReveal')}
            </span>
          </div>
        }
        front={
          role &&
          team && (
            <div
              className={`flex h-full w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 p-4 text-center shadow-2xl ${
                team === 'evil'
                  ? 'border-crimson/60 bg-gradient-to-b from-crimson/30 to-ink'
                  : 'border-sky-400/50 bg-gradient-to-b from-sky-900/40 to-ink'
              }`}
            >
              <span className="text-5xl">{ROLE_SIGIL[role]}</span>
              <span className="font-serif text-xl text-gold">{roleText.name(role)}</span>
              <span className={`text-xs uppercase tracking-wide ${TEAM_COLOR[team]}`}>
                {roleText.teamLabel(team)}
              </span>
            </div>
          )
        }
      />

      {flipped && role && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="w-full space-y-4 text-center"
        >
          <p className="text-sm text-parchment/70">{roleText.blurb(role)}</p>

          <div className="rounded-xl border border-gold/20 bg-ink/40 p-3 text-left">
            <p className="mb-1 text-xs uppercase tracking-wide text-parchment/50">
              {t('roleReveal.whatYouPerceive')}
            </p>
            {reveal && reveal.knownPlayers.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {reveal.knownPlayers.map((k) => (
                  <li key={k.playerId} className="flex items-center justify-between">
                    <span className="text-parchment">{nameOf(k.playerId)}</span>
                    <span className="text-xs text-parchment/60">{shownLabel(k.shownAs)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-parchment/50">{t('roleReveal.seeNothing')}</p>
            )}
          </div>

          <Button className="w-full" onClick={handleAck} disabled={acking}>
            {acking ? t('roleReveal.entering') : t('roleReveal.understand')}
          </Button>
        </motion.div>
      )}

      {!flipped && <p className="text-sm text-parchment/40">{t('roleReveal.tapWhenReady')}</p>}
    </div>
  );
}
