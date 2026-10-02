import { describe,expect,it } from 'vitest';
import { initialRetryDelay,refreshDecision,SESSION_UNAVAILABLE,sessionReadFromResponse } from './sessionRead';
import type { AuthUser } from './types';

const user: AuthUser = { id: 'u1', username: 'merlin' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('sessionReadFromResponse', () => {
  it('reads a signed-in account', async () => {
    expect(await sessionReadFromResponse(json({ user }))).toEqual({ kind: 'known', user });
  });

  it('treats 200 { user: null } and 401 as a confirmed sign-out', async () => {
    expect(await sessionReadFromResponse(json({ user: null }))).toEqual({ kind: 'known', user: null });
    expect(await sessionReadFromResponse(json({ code: 'AUTH_REQUIRED' }, 401))).toEqual({ kind: 'known', user: null });
  });

  it.each([500, 502, 503, 504, 429, 404])('treats HTTP %i as unavailable', async (status) => {
    expect(await sessionReadFromResponse(json({ user: null }, status))).toEqual(SESSION_UNAVAILABLE);
  });

  it('treats a non-JSON or malformed 200 as unavailable', async () => {
    expect(await sessionReadFromResponse(new Response('<!doctype html><p>Bad gateway</p>'))).toEqual(SESSION_UNAVAILABLE);
    expect(await sessionReadFromResponse(json({}))).toEqual(SESSION_UNAVAILABLE);
    expect(await sessionReadFromResponse(json(null))).toEqual(SESSION_UNAVAILABLE);
    expect(await sessionReadFromResponse(json({ user: 'u1' }))).toEqual(SESSION_UNAVAILABLE);
  });
});

describe('refreshDecision', () => {
  it('keeps the current account and skips renewal while the server is unavailable', () => {
    expect(refreshDecision(SESSION_UNAVAILABLE, true)).toEqual({ action: 'keep' });
    expect(refreshDecision(SESSION_UNAVAILABLE, false)).toEqual({ action: 'keep' });
  });

  it('renews only a signed-in account the server confirms is signed out', () => {
    expect(refreshDecision({ kind: 'known', user: null }, true)).toEqual({ action: 'renew' });
    expect(refreshDecision({ kind: 'known', user: null }, false)).toEqual({ action: 'apply', user: null });
  });

  it('applies a confirmed account', () => {
    expect(refreshDecision({ kind: 'known', user }, true)).toEqual({ action: 'apply', user });
    expect(refreshDecision({ kind: 'known', user }, false)).toEqual({ action: 'apply', user });
  });
});

describe('initialRetryDelay', () => {
  it('backs off exponentially up to 30 seconds', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(initialRetryDelay)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });
});
