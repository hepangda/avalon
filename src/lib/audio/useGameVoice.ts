import { useEffect, useRef } from 'react';
import { useLocale } from 'use-intl';
import type { ClientGameState } from '@/lib/engine';
import { sameTimeline } from '@/lib/game/tablePresentation';
import { assetUrl } from '@/lib/assets';
import { playVoiceSequence, stopVoice } from './engine';
import { voiceCues } from './voiceCues';
import manifest from './voice-manifest.json';

const assets: Record<string, Record<string, string>> = manifest;

/** A short line at the current voice level, for the settings slider. */
export function previewVoice(locale: string) {
  const url = assets[locale]?.voteApproved;
  if (url) void playVoiceSequence([assetUrl(url)]);
}

export function useGameVoice(game: ClientGameState | null, settled: boolean, connected: boolean) {
  const locale = useLocale();
  const seen = useRef<ClientGameState | null>(null);
  const language = useRef(locale);
  useEffect(() => {
    if (!game || !connected || language.current !== locale) {
      seen.current = game;
      language.current = locale;
      stopVoice();
      return;
    }
    if (seen.current && !sameTimeline(seen.current, game)) {
      seen.current = game;
      stopVoice();
      return;
    }
    const cues = voiceCues(seen.current, game);
    if (!settled) {
      if (cues.length) stopVoice();
      return;
    }
    seen.current = game;
    if (!cues.length) return;
    const urls = cues.flatMap((cue) => assets[locale]?.[cue] ? [assetUrl(assets[locale][cue])] : []);
    if (urls.length) void playVoiceSequence(urls);
  }, [game, settled, connected, locale]);
  useEffect(() => () => stopVoice(), []);
}
