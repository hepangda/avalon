import type { useTranslations } from 'use-intl';
import type { ClientGameState, ClientLogEntry, Role } from '@/lib/engine';
import { labelById } from './playerLabel';

const PLAYER_PARAMS = ['player', 'leader', 'target', 'holder'];

export function formatGameLog(entry: ClientLogEntry, game: Pick<ClientGameState, 'players'>, t: ReturnType<typeof useTranslations>, roleName: (role: Role) => string): string {
  const nameOf = (id: string) => labelById(game, id);
  const resolved: Record<string, string | number> = {};
  const isAdmin = entry.style === 'admin';
  const decodeLineup = (encoded: string): string =>
    encoded
      .split(',')
      .filter(Boolean)
      .map((tok) => {
        const [role, n] = tok.split('*');
        const name = roleName(role as Role);
        return n ? `${name} ×${n}` : name;
      })
      .join('、');
  if (entry.params) {
    for (const [k, v] of Object.entries(entry.params)) {
      if (
        entry.key === 'lineup' &&
        (k === 'good' || k === 'evil') &&
        typeof v === 'string'
      ) {
        resolved[k] = decodeLineup(v);
      } else if (isAdmin && k === 'actor' && v === '__admin_someone__') {
        resolved[k] = t('admin.someone');
      } else if (
        isAdmin &&
        k === 'value' &&
        (v === 'approve' || v === 'reject')
      ) {
        resolved[k] = v === 'approve' ? t('vote.approve') : t('vote.reject');
      } else if (isAdmin && k === 'phase') {
        resolved[k] = t(`phase.${v}`);
      } else if (entry.key === 'admin.speechSkipped' && k === 'player' && typeof v === 'string') {
        resolved[k] = nameOf(v);
      } else if (isAdmin) {
        resolved[k] = v;
      } else if (PLAYER_PARAMS.includes(k) && typeof v === 'string') {
        resolved[k] = nameOf(v);
      } else if (k === 'team' && typeof v === 'string') {
        resolved[k] = v.split(',').map(nameOf).join('、');
      } else if (k === 'role' && typeof v === 'string') {
        resolved[k] = roleName(v as Role);
      } else {
        resolved[k] = v;
      }
    }
  }
  return t(`log.${entry.key}`, resolved);
}
