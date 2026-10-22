import { motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'use-intl';
import { GameIcon } from './GameArt';
import { RoleCard } from './RoleCard';
import { useRoleText } from '@/lib/game/useRoleText';
import type { MissionCard, Role, VoteValue } from '@/lib/engine';
import type { EndingMark } from '@/lib/game/tablePresentation';

export type TableCardState =
  'empty' | 'inactive' | 'back' | VoteValue | MissionCard;

/** A public card or an indistinguishable back. Hidden choices are never passed here. */
export function TableCard({
  state,
  role,
  variant,
  nominee,
  assassination = false,
  revealId,
  faceDown,
  mark,
  lost,
}: {
  state?: TableCardState;
  role?: Role;
  variant?: number;
  /** An identity still waiting its turn in the ending reveal; omitted, the card simply lies face up. */
  faceDown?: boolean;
  /** What the assassination did to this seat, shown once the card is face up. */
  mark?: EndingMark;
  /** The seat's side lost; its card sinks back once turned. */
  lost?: boolean;
  nominee?: number;
  assassination?: boolean;
  /** A new result starts face down, even if the previous phase removed this card. */
  revealId?: string;
}) {
  const t = useTranslations();
  const roleText = useRoleText();
  const reduce = useReducedMotion();
  if (role)
    return (
      <div
        className="table-card-slot table-role-card"
        aria-label={roleText.name(role)}
        data-face-down={faceDown}
        data-mark={mark}
        data-lost={lost || undefined}
      >
        {faceDown === undefined ? (
          <RoleCard role={role} variant={variant} size="table" />
        ) : (
          <motion.div
            className="table-card-flip"
            initial={false}
            animate={{ rotateY: faceDown ? 0 : 180 }}
            transition={{ duration: reduce ? 0 : 0.55, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className="table-card-back" aria-hidden="true">
              <GameIcon name="crest" className="table-card-icon" />
            </div>
            <div className="table-role-face" aria-hidden="true">
              <RoleCard role={role} variant={variant} size="table" />
            </div>
          </motion.div>
        )}
        {mark && !faceDown && <EndingMarkArt mark={mark} />}
      </div>
    );
  if (nominee !== undefined)
    return (
      <div
        className="table-card-slot table-nominee-card"
        aria-label={t(assassination ? 'assassin.strikeSeat' : 'table.selectedSeat', {
          seat: nominee,
        })}
      >
        <GameIcon name={assassination ? 'assassinate' : 'crest'} className="table-card-icon" />
        <span>{assassination ? t('assassin.strikeSeat', { seat: nominee }) : nominee}</span>
      </div>
    );
  if (!state || state === 'empty' || state === 'inactive')
    return (
      <div
        className={`table-card-slot table-card-empty ${state === 'inactive' ? 'is-inactive' : ''}`}
        aria-label={t(
          state === 'inactive' ? 'table.noCard' : 'table.awaitingCard',
        )}
      />
    );
  const value = state === 'back' ? null : state;
  const negative = value === 'reject' || value === 'fail';
  const label = value
    ? t(
        value === 'approve' || value === 'reject'
          ? `vote.${value}`
          : `missionVote.${value}`,
      )
    : t('table.cardSubmitted');
  return (
    <div className="table-card-slot" role="img" aria-label={label}>
      <motion.div
        key={revealId ?? 'card'}
        className="table-card-flip"
        initial={revealId && !reduce ? { rotateY: 0 } : false}
        animate={{ rotateY: value ? 180 : 0 }}
        transition={{
          duration: reduce ? 0 : 0.45,
          delay: revealId && !reduce ? 0.15 : 0,
          ease: 'easeInOut',
        }}
      >
        <div className="table-card-back" aria-hidden="true">
          <GameIcon name="crest" className="table-card-icon" />
        </div>
        <div
          className={`table-card-front ${negative ? 'is-negative' : 'is-positive'}`}
          aria-hidden="true"
        >
          {value && (
            <>
              <GameIcon
                name={
                  value === 'approve'
                    ? 'approve'
                    : value === 'reject'
                      ? 'reject'
                      : value === 'success'
                        ? 'missionSuccess'
                        : 'missionFail'
                }
                className="table-card-icon"
              />
              <span>{label}</span>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/** The dagger's mark on an ending card: driven in, glancing off, broken, or a halo for the one it never found. */
function EndingMarkArt({ mark }: { mark: EndingMark }) {
  return (
    <span className="table-role-mark" data-mark={mark} aria-hidden="true">
      {mark === 'survivor' ? (
        <span className="table-role-halo" />
      ) : (
        <>
          {mark === 'slain' && <span className="table-role-wound" />}
          <GameIcon name="assassinate" className="table-role-dagger" />
          {mark === 'foiled' && (
            <svg className="table-role-break" viewBox="0 0 20 20">
              <path d="M2 11 L7 8 L10 12 L13 7 L18 10" pathLength={1} />
            </svg>
          )}
        </>
      )}
    </span>
  );
}
