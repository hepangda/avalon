import type { Ack } from '../types';

type Translate = (key: string, values?: Record<string, number>) => string;

/** Keep server diagnostics out of the player-facing start failure dialog. */
export function startErrorText(error: Ack['error'], t: Translate): string {
  if (error?.code === 'INVALID_ROLE_SET') {
    const split = /^Role set mismatch for (\d+)p: built (\d+) blue \/ (\d+) red, expected (\d+)\/(\d+)/.exec(error.message);
    return split
      ? t('startErrors.roleSplit', {
        players: Number(split[1]), good: Number(split[2]), evil: Number(split[3]),
        expectedGood: Number(split[4]), expectedEvil: Number(split[5]),
      })
      : t('startErrors.invalidRoles');
  }
  const keys: Record<string, string> = {
    INVALID_PLAYER_COUNT: 'invalidPlayers',
    NOT_HOST: 'notHost',
    NOT_IN_ROOM: 'notInRoom',
    NO_ROOM: 'notInRoom',
    WRONG_PHASE: 'alreadyStarted',
    DISCONNECTED: 'disconnected',
    TIMEOUT: 'timeout',
  };
  return t(`startErrors.${keys[error?.code ?? ''] ?? 'unknown'}`);
}
