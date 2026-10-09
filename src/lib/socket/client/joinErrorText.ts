import type { RoomNotice } from '@/lib/store/room';

/** Join failures arrive as English server messages; translate the ones a player can act on. */
export function joinErrorText(notice: RoomNotice, t: (key: string) => string): string | undefined {
  return notice.code === 'ROOM_NOT_FOUND' ? t('common.roomNotFound') : notice.message;
}
