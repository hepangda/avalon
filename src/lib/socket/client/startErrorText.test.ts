import { createTranslator } from 'use-intl';
import { describe, expect, it } from 'vitest';
import zh from '../../../../messages/zh.json';
import en from '../../../../messages/en.json';
import { startErrorText } from './startErrorText';

const t = createTranslator({ locale: 'zh', messages: zh });

describe('startErrorText', () => {
  it('translates the role mismatch with actual and expected team sizes', () => {
    expect(startErrorText({ code: 'INVALID_ROLE_SET', message: 'Role set mismatch for 8p: built 5 blue / 4 red, expected 5/3 (too many special roles enabled?)' }, t))
      .toBe('8 人局需要 5 名蓝方和 3 名红方，当前配置为 5 名蓝方和 4 名红方。请关闭部分特殊角色，或切换到推荐配置后重试。');
  });

  it.each(['INVALID_PLAYER_COUNT', 'NOT_HOST', 'NOT_IN_ROOM', 'NO_ROOM', 'WRONG_PHASE', 'DISCONNECTED', 'TIMEOUT', 'INVALID_ROLE_SET', 'INTERNAL_ERROR'])(
    'provides a localized explanation for %s without leaking diagnostics', (code) => {
      const result = startErrorText({ code, message: 'Internal server diagnostic' }, t);
      expect(result).toMatch(/[\u4e00-\u9fff]/);
      expect(result).not.toContain('Internal server diagnostic');
    },
  );

  it('handles a missing error and respects the selected language', () => {
    expect(startErrorText(undefined, t)).toBe(zh.startErrors.unknown);
    expect(startErrorText({ code: 'NOT_HOST', message: 'Only host' }, createTranslator({ locale: 'en', messages: en })))
      .toBe(en.startErrors.notHost);
  });
});
