import { motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'use-intl';
import { GameIcon } from './GameArt';
import { RoleCard } from './RoleCard';
import { useRoleText } from '@/lib/game/useRoleText';
import type { MissionCard, Role, VoteValue } from '@/lib/engine';

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
}: {
  state?: TableCardState;
  role?: Role;
  variant?: number;
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
      >
        <RoleCard role={role} variant={variant} size="table" />
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
        <GameIcon name={assassination ? 'reject' : 'crest'} className="table-card-icon" />
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
