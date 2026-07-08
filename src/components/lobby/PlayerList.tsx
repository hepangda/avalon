'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useTranslations } from 'use-intl';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { latencyDotClass } from '@/lib/utils/latency';
import type { RoomMember } from '@/lib/socket/types';

interface PlayerListProps {
  members: RoomMember[];
  hostPlayerId: string;
  myPlayerId: string | null;
  isHost: boolean;
  onKick: (id: string) => void;
}

export function PlayerList({
  members,
  hostPlayerId,
  myPlayerId,
  isHost,
  onKick,
}: PlayerListProps) {
  const t = useTranslations();
  const seated = members.filter((m) => !m.isSpectator);
  const spectators = members.filter((m) => m.isSpectator);

  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-serif text-xl text-gold">{t('lobby.players')}</h2>
        <span className="text-sm text-parchment/50">
          {t('lobby.seated', { count: seated.length })}
        </span>
      </div>

      <ul className="space-y-2">
        <AnimatePresence initial={false}>
          {seated.map((m) => {
            const isYou = m.id === myPlayerId;
            const isRoomHost = m.id === hostPlayerId;
            return (
              <motion.li
                key={m.id}
                layout
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ duration: 0.25 }}
                className="flex items-center justify-between rounded-lg border border-gold/15 bg-ink/30 px-3 py-2"
              >
              <span className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold/20 text-xs text-gold">
                  {m.seat + 1}
                </span>
                <span className="text-parchment">{m.name}</span>
                {isRoomHost && (
                  <span className="rounded bg-gold/20 px-1.5 py-0.5 text-[10px] uppercase text-gold">
                    {t('lobby.host')}
                  </span>
                )}
                {isYou && <span className="text-xs text-parchment/40">({t('common.you')})</span>}
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${latencyDotClass(m.connected, m.latency)}`}
                  title={
                    m.connected
                      ? m.latency !== undefined
                        ? `${m.latency} ms`
                        : 'Online'
                      : 'Offline'
                  }
                />
              </span>

              {isHost && !isRoomHost && (
                <span className="flex gap-1">
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs text-crimson"
                    onClick={() => onKick(m.id)}
                  >
                    {t('lobby.kick')}
                  </Button>
                </span>
              )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      {spectators.length > 0 && (
        <div className="border-t border-gold/15 pt-2">
          <p className="text-xs uppercase tracking-wide text-parchment/40">
            {t('lobby.spectators')} ({spectators.length})
          </p>
          <p className="text-sm text-parchment/60">{spectators.map((s) => s.name).join(', ')}</p>
        </div>
      )}
    </Card>
  );
}
