import { SCENARIOS,type ScenarioId } from '@/lib/debug/scenarios';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

export function ScenePicker({ scenarioId, playerCount, onSelect }: {
  scenarioId: ScenarioId; playerCount: number; onSelect: (scene: ScenarioId, count: number) => void;
}) {
  const t = useTranslations();
  const [filter, setFilter] = useState("");
  const groups = [...new Set(SCENARIOS.map((s) => s.group))];
  const matching = SCENARIOS.filter((s) =>
    t(`debug.scenes.${s.id}.title`)
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );

  return (
        <details className="debug-section" open>
          <summary>
            {t("debug.scenarios")} <span>{matching.length}</span>
          </summary>
          <input
            type="search"
            aria-label={t("debug.search")}
            placeholder={t("debug.search")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <nav className="debug-scenarios" aria-label={t("debug.scenarios")}>
            {groups.map((group) => {
              const scenes = matching.filter((s) => s.group === group);
              return (
                scenes.length > 0 && (
                  <div key={group}>
                    <h2>{t(`debug.groups.${group}`)}</h2>
                    {scenes.map((s) => (
                      <button
                        key={s.id}
                        aria-current={s.id === scenarioId ? "true" : undefined}
                        onClick={() =>
                          onSelect(
                            s.id,
                            "minPlayers" in s
                              ? Math.max(playerCount, s.minPlayers)
                              : playerCount,
                          )
                        }
                      >
                        <span>{t(`debug.scenes.${s.id}.title`)}</span>
                        <span aria-hidden="true">
                          {s.id === scenarioId ? "●" : "↗"}
                        </span>
                      </button>
                    ))}
                  </div>
                )
              );
            })}
            {!matching.length && <p>{t("debug.noResults")}</p>}
          </nav>
        </details>
  );
}
