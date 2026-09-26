import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { accountDisplayName, type AuthUser } from '@/lib/auth/types';
import { sanitizeName } from '@/lib/game/displayName';
import { getCurrentAuthUser } from './auth';
import type { Env } from './env';

export function cardResourceContext(user: AuthUser | null, anonymousId: string, anonymousName: string) {
  const userId = user?.id ?? `anonymous:${anonymousId}`;
  return {
    targetingKey: userId,
    userId,
    name: user ? accountDisplayName(user) : sanitizeName(anonymousName),
    username: user?.username ?? '',
    anonymous: !user,
    anonymousId: user ? '' : anonymousId,
    anonymousName: user ? '' : sanitizeName(anonymousName),
  };
}

export const cardResourceApi = new Hono<{ Bindings: Env }>();

cardResourceApi.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  await next();
});

cardResourceApi.post('/', bodyLimit({ maxSize: 1024 }), async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' ||
    !('anonymousId' in body) || typeof body.anonymousId !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.anonymousId) ||
    !('anonymousName' in body) || typeof body.anonymousName !== 'string') {
    return c.json({ error: 'Invalid anonymous identity' }, 400);
  }

  try {
    const user = await getCurrentAuthUser(c);
    const result = await c.env.FLAGS.getStringDetails('card-resource', 'default',
      cardResourceContext(user, body.anonymousId, body.anonymousName));
    if (result.errorCode) {
      console.warn(JSON.stringify({ message: 'Card resource evaluation failed', errorCode: result.errorCode }));
    }
    return c.json({ resource: result.value === 'furry' ? 'furry' : 'default' });
  } catch {
    console.warn(JSON.stringify({ message: 'Card resource unavailable; using default' }));
    return c.json({ resource: 'default' });
  }
});
