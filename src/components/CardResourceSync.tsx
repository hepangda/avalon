import { useEffect, useState } from 'react';
import { useAuthIdentity } from '@/lib/auth/useAuthIdentity';
import { anonymousIdentityId } from '@/lib/auth/anonymousIdentity';
import { useSessionStore } from '@/lib/store/session';
import { useCardArtStore } from '@/lib/store/cardArt';

/** Evaluate for the viewer on every route, including direct game/replay links. */
export function CardResourceSync() {
  const { user, loading } = useAuthIdentity();
  const name = useSessionStore((state) => state.lastName);
  const [anonymousId] = useState(anonymousIdentityId);
  const setResource = useCardArtStore((state) => state.setResource);
  const anonymousName = user ? '' : name;

  useEffect(() => {
    setResource('default');
    if (loading) return;
    let active = true;
    let pending: AbortController | undefined;

    async function refresh() {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      const timeout = window.setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch('/api/card-resource', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ anonymousId, anonymousName }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Card resource evaluation failed');
        const body: unknown = await response.json();
        if (active && pending === controller && !controller.signal.aborted) {
          setResource(body && typeof body === 'object' && 'resource' in body ? body.resource : 'default');
        }
      } catch {
        if (active && pending === controller) setResource('default');
      } finally {
        window.clearTimeout(timeout);
      }
    }

    function refreshWhenVisible() {
      if (document.visibilityState === 'visible') void refresh();
    }
    void refresh();
    const interval = window.setInterval(refreshWhenVisible, 60_000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      active = false;
      pending?.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [loading, user?.id, user?.username, user?.alias, anonymousId, anonymousName, setResource]);

  return null;
}
