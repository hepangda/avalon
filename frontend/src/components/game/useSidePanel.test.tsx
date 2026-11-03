// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useWideTable } from './useSidePanel';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function Screen({ ready }: { ready: boolean }) {
  const [wide, ref] = useWideTable();
  // As the lobby does: a loading state first, the measured screen only once the room arrives.
  return ready ? <main ref={ref} data-wide={wide} /> : <p>loading</p>;
}

it('measures a screen that mounts after a loading state', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1280);
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Screen ready={false} />));
    await act(async () => root.render(<Screen ready />));
    expect(container.querySelector('main')!.dataset.wide).toBe('true');
  } finally {
    await act(async () => root.unmount());
  }
});
