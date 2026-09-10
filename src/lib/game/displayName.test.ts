import { describe, expect, it } from 'vitest';
import { sanitizeName } from './displayName';

describe('10-character display names', () => {
  it.each([
    ['abcdefghijkl', 'abcdefghij'],
    ['一二三四五六七八九十十一', '一二三四五六七八九十'],
    ['一二三四五abcde六', '一二三四五abcde'],
    ['  Alice  \n Bob  ', 'Alice Bob'],
    ['𠮷'.repeat(11), '𠮷'.repeat(10)],
  ])('normalizes %s without cutting a Unicode character', (input, expected) => {
    expect(sanitizeName(input)).toBe(expected);
  });
});
