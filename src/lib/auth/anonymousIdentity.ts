const STORAGE_KEY = 'avalon-anonymous-id';
let memoryId: string | undefined;

/** Stable rollout identity, including when no anonymous nickname has been chosen. */
export function anonymousIdentityId(): string {
  if (memoryId) return memoryId;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(saved)) {
      memoryId = saved;
      return saved;
    }
  } catch { /* A page-lifetime identity still works when storage is unavailable. */ }
  memoryId = crypto.randomUUID();
  try { localStorage.setItem(STORAGE_KEY, memoryId); } catch { /* Keep the in-memory ID. */ }
  return memoryId;
}
