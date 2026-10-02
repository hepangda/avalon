export const GAME_ICON_SRC = {
  crest: '/assets/game/icons/crest.webp',
  approve: '/assets/game/icons/approve.webp',
  reject: '/assets/game/icons/reject.webp',
  assassinate: '/assets/game/icons/assassinate.webp',
  missionSuccess: '/assets/game/icons/mission-success.webp',
  missionFail: '/assets/game/icons/mission-fail.webp',
  lady: '/assets/game/icons/lady.webp',
  leader: '/assets/game/icons/leader.webp',
} as const;

export type GameIconName = keyof typeof GAME_ICON_SRC;
