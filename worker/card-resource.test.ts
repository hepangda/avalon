import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentAuthUser } from './auth';
import { cardResourceApi } from './card-resource';
import type { Env } from './env';

vi.mock('./auth', () => ({ getCurrentAuthUser: vi.fn() }));

const anonymousId = '66fb3f90-9b4c-4cf8-9811-2f9db22604ae';
const evaluate = vi.fn();
const env = { FLAGS: { getStringDetails: evaluate } } satisfies {
  FLAGS: Pick<Env['FLAGS'], 'getStringDetails'>;
};

function request(body: unknown = { anonymousId, anonymousName: '  小虎  ' }) {
  return cardResourceApi.request('/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, env);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCurrentAuthUser).mockResolvedValue(null);
  evaluate.mockResolvedValue({ value: 'furry' });
});

describe('Flagship card-resource endpoint', () => {
  it('evaluates anonymous nicknames and a stable, namespaced rollout identity', async () => {
    const response = await request();
    expect(await response.json()).toEqual({ resource: 'furry' });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(evaluate).toHaveBeenCalledWith('card-resource', 'default', {
      targetingKey: `anonymous:${anonymousId}`, userId: `anonymous:${anonymousId}`,
      name: '小虎', username: '', anonymous: true, anonymousId, anonymousName: '小虎',
    });
  });

  it('takes authenticated identity from the session, ignoring client-supplied account fields', async () => {
    vi.mocked(getCurrentAuthUser).mockResolvedValue({ id: 'account-42', username: 'original-name', alias: '骑士' });
    const response = await request({ anonymousId, anonymousName: '假名字', userId: 'forged', name: 'forged', anonymous: true });
    expect(await response.json()).toEqual({ resource: 'furry' });
    expect(evaluate).toHaveBeenCalledWith('card-resource', 'default', {
      targetingKey: 'account-42', userId: 'account-42', name: '骑士', username: 'original-name',
      anonymous: false, anonymousId: '', anonymousName: '',
    });
  });

  it('uses the original name when no account alias exists', async () => {
    vi.mocked(getCurrentAuthUser).mockResolvedValue({ id: 'account-42', username: 'original-name' });
    await request();
    expect(evaluate.mock.calls[0]?.[2]).toMatchObject({ name: 'original-name', username: 'original-name' });
  });

  it.each(['default', 'classic', 'unknown', true, null])('maps unsupported or default values to the default deck: %s', async (value) => {
    evaluate.mockResolvedValue({ value });
    expect(await (await request()).json()).toEqual({ resource: 'default' });
  });

  it('returns default on binding errors and does not log identity data', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      evaluate.mockRejectedValue(new Error('binding unavailable'));
      expect(await (await request()).json()).toEqual({ resource: 'default' });
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls.flat().join('')).not.toContain(anonymousId);
    } finally { warn.mockRestore(); }
  });

  it('does not evaluate an authenticated user as anonymous if session lookup fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      vi.mocked(getCurrentAuthUser).mockRejectedValue(new Error('session unavailable'));
      expect(await (await request()).json()).toEqual({ resource: 'default' });
      expect(evaluate).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  it.each([null, {}, { anonymousId: 'invalid', anonymousName: '' }, { anonymousId, anonymousName: 3 }])('rejects malformed identity input', async (body) => {
    expect((await request(body)).status).toBe(400);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('limits request bodies', async () => {
    expect((await request({ anonymousId, anonymousName: 'x'.repeat(2000) })).status).toBe(413);
    expect(evaluate).not.toHaveBeenCalled();
  });
});
