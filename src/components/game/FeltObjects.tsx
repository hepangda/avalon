import type { CSSProperties } from 'react';
import type { ClientGameState } from '@/lib/engine';
import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { GameIcon } from './GameArt';

/** A fixed scatter per quest, so a pile never reshuffles between renders. */
function jitter(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * What the table remembers, as things lying on the felt: this quest's
 * rejected teams pushed to one side, and each played quest's cards left in a
 * small pile. The live phase keeps the middle; these only fill the band above it.
 */
export function FeltObjects({ game }: { game: ClientGameState }) {
  const rejected = game.voteHistory.filter((record) => record.roundIndex === game.roundIndex && !record.approved);
  const results = game.missionResults;
  if (!rejected.length && !results.length) return null;
  return (
    <div className="table-felt-objects" aria-hidden="true">
      <ol className="table-rejected-teams">
        {rejected.map((record, index) => (
          <li key={`${record.roundIndex}-${record.proposalIndex}`} className="table-rejected-team"
            style={{ '--tilt': `${(jitter(record.proposalIndex + 1) - 0.5) * 7}deg`, '--depth': rejected.length - 1 - index } as CSSProperties}>
            <GameIcon name="reject" className="table-rejected-stone" />
            {record.team.map((id) => {
              const p = game.players.find((player) => player.id === id);
              return p && <PlayerAvatar key={id} playerId={id} avatarUrl={p.claimed === false ? undefined : p.avatarUrl} name="" className="table-rejected-token" />;
            })}
          </li>
        ))}
      </ol>
      <ol className="table-quest-piles">
        {results.map((result) => (
          <li key={result.roundIndex} className="table-quest-pile" data-success={result.success}>
            {Array.from({ length: result.teamSize }, (_, index) => {
              // Fails land somewhere in the pile, not always on top.
              const failAt = Math.floor(jitter(result.roundIndex * 7 + 3) * result.teamSize);
              const fail = (index - failAt + result.teamSize) % result.teamSize < result.failCount;
              const seed = result.roundIndex * 11 + index;
              return <span key={index} className="table-quest-card" data-fail={fail || undefined}
                style={{ '--x': (index - (result.teamSize - 1) / 2) * 0.32 + (jitter(seed) - 0.5) * 0.2, '--r': `${(jitter(seed + 0.5) - 0.5) * 34}deg` } as CSSProperties}>
                <GameIcon name={fail ? 'missionFail' : 'missionSuccess'} />
              </span>;
            })}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Candlelight and grain on the felt; the cloth warms or chills with the quests already played. */
export function FeltAmbience({ game }: { game: ClientGameState }) {
  const successes = game.missionResults.filter((result) => result.success).length;
  const fails = game.missionResults.length - successes;
  return (
    <>
      <span className="table-felt-grain" style={{ '--round': game.roundIndex } as CSSProperties} />
      <span className="table-felt-tint" data-lean={successes > fails ? 'good' : fails > successes ? 'evil' : undefined}
        style={{ '--lean': Math.abs(successes - fails) } as CSSProperties} />
      <span className="table-felt-candle is-left" />
      <span className="table-felt-candle is-right" />
    </>
  );
}
