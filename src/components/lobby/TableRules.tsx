import { useId, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { GameIcon } from '@/components/game/GameArt';
import { rejectionLimit, speechDuration, type GameOptions } from '@/lib/engine';

const SPEECH_PRESETS = [30, 60, 90, 120, 180, 240, 300, 600];
const LIMIT_STEPS = [1, 2, 3, 4, 5];

interface TableRulesProps {
  options: GameOptions;
  disabled: boolean;
  onChange: (patch: Partial<GameOptions>) => void;
}

function Stepper({ steps, value, label, display, less, more, disabled, onChange }: {
  steps: number[];
  value: number;
  label: string;
  display: ReactNode;
  less: string;
  more: string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const index = steps.indexOf(value);
  return (
    <div className="lobby-stepper" role="group" aria-labelledby={label}>
      <button type="button" aria-label={less} disabled={disabled || index <= 0} onClick={() => onChange(steps[index - 1]!)}>
        −
      </button>
      <output aria-live="polite" className="tabular-nums">{display}</output>
      <button type="button" aria-label={more} disabled={disabled || index >= steps.length - 1} onClick={() => onChange(steps[index + 1]!)}>
        +
      </button>
    </div>
  );
}

/** The host's table rules: discussion rounds, speaking time and the Lady of the Lake. */
export function TableRules({ options, disabled, onChange }: TableRulesProps) {
  const t = useTranslations();
  const id = useId();
  const limit = rejectionLimit(options.maxRejections);
  const speech = speechDuration(options.speechSeconds);

  return (
    <section className="lobby-section" aria-labelledby={`${id}-title`}>
      <div className="lobby-section-head">
        <h2 id={`${id}-title`} className="lobby-section-title">{t('lobby.tableRules')}</h2>
      </div>

      <dl className="lobby-rules">
        <div className="lobby-rule">
          <dt id={`${id}-limit`}>{t('lobby.rejectionLimit')}</dt>
          <dd>
            <Stepper
              steps={LIMIT_STEPS}
              value={limit}
              label={`${id}-limit`}
              display={limit}
              less={t('lobby.decreaseDiscussionLimit')}
              more={t('lobby.increaseDiscussionLimit')}
              disabled={disabled}
              onChange={(value) => onChange({ maxRejections: value })}
            />
          </dd>
        </div>

        <div className="lobby-rule">
          <dt id={`${id}-speech`}>{t('lobby.speechDuration')}</dt>
          <dd>
            <Stepper
              steps={[...new Set([...SPEECH_PRESETS, speech])].sort((a, b) => a - b)}
              value={speech}
              label={`${id}-speech`}
              display={t('lobby.seconds', { seconds: speech })}
              less={t('lobby.shorterSpeech')}
              more={t('lobby.longerSpeech')}
              disabled={disabled}
              onChange={(value) => onChange({ speechSeconds: value })}
            />
          </dd>
        </div>

        <div className="lobby-rule">
          <dt className="flex items-center gap-2.5">
            <GameIcon name="lady" className="lobby-rule-icon" />
            <span>{t('phase.LadyOfLake')}</span>
          </dt>
          <dd>
            <label className="lobby-switch">
              <span className="sr-only">{t('phase.LadyOfLake')}</span>
              <input
                type="checkbox"
                role="switch"
                checked={Boolean(options.ladyOfTheLake)}
                disabled={disabled}
                onChange={(event) => onChange({ ladyOfTheLake: event.target.checked })}
              />
            </label>
          </dd>
        </div>
      </dl>
    </section>
  );
}
