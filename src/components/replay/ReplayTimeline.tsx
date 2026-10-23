import { useTranslations } from 'use-intl';
import type { ReplayStep } from '@/lib/game/replaySteps';
import { stepTone, useStepLabel } from './stepText';

/** Transport and scrubber: every beat is a notch, grouped by mission. */
export function ReplayTimeline({ steps, index, playing, onSeek, onTogglePlay }: {
  steps: ReplayStep[];
  index: number;
  playing: boolean;
  onSeek: (index: number) => void;
  onTogglePlay: () => void;
}) {
  const t = useTranslations();
  const label = useStepLabel();
  const last = steps.length - 1;
  return (
    <div className="replay-transport">
      <button type="button" className="replay-transport-button" aria-label={t('replay.previous')} title={t('replay.previous')}
        disabled={index <= 0} onClick={() => onSeek(index - 1)}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" /></svg>
      </button>
      <button type="button" className="replay-transport-button is-play" aria-label={t(playing ? 'replay.pause' : 'replay.play')}
        title={t(playing ? 'replay.pause' : 'replay.play')} aria-pressed={playing} onClick={onTogglePlay}>
        {playing
          ? <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4.5v11M13 4.5v11" /></svg>
          : <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4.2v11.6L16 10Z" className="is-filled" /></svg>}
      </button>
      <button type="button" className="replay-transport-button" aria-label={t('replay.next')} title={t('replay.next')}
        disabled={index >= last} onClick={() => onSeek(index + 1)}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5" /></svg>
      </button>
      <ol className="replay-scrubber" aria-label={t('replay.timeline')}>
        {steps.map((step, i) => (
          <li key={step.key} data-break={i > 0 && steps[i - 1]!.roundIndex !== step.roundIndex ? '' : undefined}>
            <button type="button" className="replay-notch" data-kind={step.kind} data-tone={stepTone(step)}
              data-past={i < index ? '' : undefined} aria-current={i === index ? 'step' : undefined}
              aria-label={label(step)} title={label(step)} onClick={() => onSeek(i)} />
          </li>
        ))}
      </ol>
    </div>
  );
}
