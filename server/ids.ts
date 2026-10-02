import { customAlphabet } from 'nanoid';

/** Generate a random 4-digit room code, preserving leading zeros. */
export const makeCode = customAlphabet('0123456789', 4);

/** Generate a 16-char opaque player id / host token. */
export const makePlayerId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);

/** Generate an opaque bearer token used to prove ownership of a claimed seat. */
export const makeSessionToken = customAlphabet(
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  32,
);
