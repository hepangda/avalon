import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPushToTalkShortcut } from './keyboard';

class Target {
  constructor(
    private tag: string,
    private talkButton = false,
  ) {}
  closest(selector: string) {
    if (selector === '[data-push-to-talk]') return this.talkButton ? this : null;
    return selector.split(', ').includes(this.tag) ? this : null;
  }
}
afterEach(() => vi.unstubAllGlobals());
function key(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: ' ',
    target: null,
    repeat: false,
    defaultPrevented: false,
    isComposing: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe('push-to-talk keyboard shortcut', () => {
  it('accepts Space from the game table and the talk button', () => {
    vi.stubGlobal('Element', Target);
    expect(isPushToTalkShortcut(key())).toBe(true);
    expect(
      isPushToTalkShortcut(key({ target: new Target('button', true) as unknown as EventTarget })),
    ).toBe(true);
  });
  it.each(['input', 'textarea', 'select', 'button', 'a', '[role="textbox"]'])(
    'does not interrupt %s controls',
    (tag) => {
      vi.stubGlobal('Element', Target);
      expect(isPushToTalkShortcut(key({ target: new Target(tag) as unknown as EventTarget }))).toBe(
        false,
      );
    },
  );
  it.each([
    'repeat',
    'defaultPrevented',
    'isComposing',
    'ctrlKey',
    'metaKey',
    'altKey',
    'shiftKey',
  ] as const)('ignores %s key events', (flag) => {
    expect(isPushToTalkShortcut(key({ [flag]: true }))).toBe(false);
  });
});
