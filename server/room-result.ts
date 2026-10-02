import type { Ack } from '@/lib/socket/types';
export const ok = <T>(data?: T): Ack<T> => ({ ok: true, data });
export const fail = <T = undefined>(code: string, message: string): Ack<T> => ({ ok: false, error: { code, message } });

/** Coerce an unknown wire value to a string[] (team payloads). */
export function asStrArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}
