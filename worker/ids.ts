import { customAlphabet } from 'nanoid';

// Room codes: 6 uppercase letters/digits, unambiguous (no 0/O/1/I).
const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Generate a random 6-char room code. */
export const makeCode = customAlphabet(ROOM_ALPHABET, 6);

/** Generate a 16-char opaque player id / host token. */
export const makePlayerId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);
