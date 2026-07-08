'use client';

import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatLatency, latencyDotClass, latencyTextClass } from '@/lib/utils/latency';

interface RoomHeaderProps {
  code: string;
  status: string;
  connected: boolean;
  /** This client's own latency in ms (null until first ping). */
  latency?: number | null;
}

export function RoomHeader({
  code,
  status,
  connected,
  latency = null,
}: RoomHeaderProps) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);

  function copyInvite() {
    const url = `${window.location.origin}/room/${code}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Card className="flex items-center justify-between gap-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-parchment/50">{t('lobby.roomCode')}</p>
        <p className="font-serif text-3xl tracking-[0.3em] text-gold">{code}</p>
        <p className="mt-1 flex items-center gap-2 text-xs text-parchment/50">
          <span
            className={`inline-block h-2 w-2 rounded-full ${latencyDotClass(connected, latency ?? undefined)}`}
          />
          {connected ? (
            <span className={`tabular-nums ${latencyTextClass(latency)}`}>
              {formatLatency(latency)}
            </span>
          ) : (
            t('common.reconnecting')
          )}{' '}
          · {status}
        </p>
      </div>
      <Button variant="secondary" onClick={copyInvite}>
        {copied ? t('lobby.copied') : t('lobby.inviteLink')}
      </Button>
    </Card>
  );
}
