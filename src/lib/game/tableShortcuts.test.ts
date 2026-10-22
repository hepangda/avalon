// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleTableShortcut, seatShortcut, shortcutKey } from './tableShortcuts';

function press(key: string, target: EventTarget = document.body, extra: Partial<KeyboardEvent> = {}) {
  return { key, target, repeat: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, defaultPrevented: false, ...extra };
}

function table(html: string) {
  const root = document.createElement('main');
  root.innerHTML = html;
  document.body.append(root);
  const clicks = vi.fn();
  root.addEventListener('click', (event) => clicks((event.target as HTMLElement).id));
  return { root, clicks };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('shortcutKey', () => {
  it('maps the vote, mission, seat and confirm keys in either case', () => {
    expect(['y', 'N', 's', 'F', 'Enter', '1', '0'].map(shortcutKey)).toEqual(['Y', 'N', 'S', 'F', 'Enter', '1', '0']);
    expect(shortcutKey('x')).toBeNull();
    expect(shortcutKey('Escape')).toBeNull();
  });

  it('numbers seats 1–9 by digit and the tenth seat 0', () => {
    expect(seatShortcut(0)).toBe('1');
    expect(seatShortcut(8)).toBe('9');
    expect(seatShortcut(9)).toBe('0');
    expect(seatShortcut(10)).toBeUndefined();
  });
});

describe('handleTableShortcut', () => {
  it('presses the enabled control that declares the key', () => {
    const { root, clicks } = table('<button id="yes" aria-keyshortcuts="Y">Y</button><button id="no" aria-keyshortcuts="N">N</button>');
    expect(handleTableShortcut(press('n'), root)?.id).toBe('no');
    expect(clicks).toHaveBeenCalledWith('no');
  });

  it('leaves a disabled control alone, so a loyal player cannot fail a quest', () => {
    const { root, clicks } = table('<button id="fail" aria-keyshortcuts="F" disabled>F</button>');
    expect(handleTableShortcut(press('f'), root)).toBeNull();
    expect(clicks).not.toHaveBeenCalled();
  });

  it('does nothing while typing, with a modifier held or on a held-down key', () => {
    const { root, clicks } = table('<input id="field" /><button id="seat" aria-keyshortcuts="3">3</button>');
    const field = root.querySelector('input')!;
    expect(handleTableShortcut(press('3', field), root)).toBeNull();
    expect(handleTableShortcut(press('3', document.body, { metaKey: true }), root)).toBeNull();
    expect(handleTableShortcut(press('3', document.body, { repeat: true }), root)).toBeNull();
    expect(clicks).not.toHaveBeenCalled();
  });

  it('lets Enter on a focused button press that button instead', () => {
    const { root, clicks } = table('<button id="other">x</button><button id="confirm" aria-keyshortcuts="Enter">ok</button>');
    expect(handleTableShortcut(press('Enter', root.querySelector('#other')!), root)).toBeNull();
    expect(handleTableShortcut(press('Enter'), root)?.id).toBe('confirm');
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it('stays out of the way while a sheet or popover is open', () => {
    const { root, clicks } = table('<button id="yes" aria-keyshortcuts="Y">Y</button>');
    const popover = document.createElement('div');
    popover.setAttribute('role', 'dialog');
    document.body.append(popover);
    expect(handleTableShortcut(press('y'), root)).toBeNull();
    popover.remove();
    const sheet = document.createElement('dialog');
    sheet.setAttribute('open', '');
    document.body.append(sheet);
    expect(handleTableShortcut(press('y'), root)).toBeNull();
    expect(clicks).not.toHaveBeenCalled();
  });
});
