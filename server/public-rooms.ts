import type { PublicRoom, PublicRoomPage } from '@/lib/socket/types';
import type { RoomDocument } from './persistence';

export function publicRoom(document: RoomDocument): PublicRoom | null {
  const { meta, members } = document;
  const playerCount = members.filter((member) => member.claimed && !member.isSpectator).length;
  if (meta.visibility !== 'public' || meta.status !== 'lobby' || playerCount >= meta.config.maxPlayers) return null;
  return { code: meta.code, name: meta.name ?? '', playerCount, maxPlayers: meta.config.maxPlayers };
}

export function publicRoomPage(rooms: PublicRoom[], requestedPage: number): PublicRoomPage {
  const totalPages = Math.max(1, Math.ceil(rooms.length / 5));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  return { rooms: rooms.sort((a, b) => a.code.localeCompare(b.code)).slice((page - 1) * 5, page * 5), page, totalPages };
}
