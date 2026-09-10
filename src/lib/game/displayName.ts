/** Shared by identity inputs and the authoritative room boundary. */
export const MAX_NAME_LENGTH = 10;

export function sanitizeName(raw: string): string {
  return Array.from(raw.replace(/\s+/g, ' ').trim()).slice(0, MAX_NAME_LENGTH).join('');
}
