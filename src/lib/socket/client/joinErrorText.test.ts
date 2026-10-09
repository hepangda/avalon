import { describe, expect, it } from 'vitest';
import { joinErrorText } from './joinErrorText';

const t = (key: string) => `t:${key}`;

describe('joinErrorText', () => {
  it('translates a missing room', () => {
    expect(joinErrorText({ type: 'join_error', code: 'ROOM_NOT_FOUND', message: 'Room not found' }, t)).toBe('t:common.roomNotFound');
  });

  it('keeps the server message for other failures', () => {
    expect(joinErrorText({ type: 'join_error', message: 'Could not reach the server' }, t)).toBe('Could not reach the server');
  });
});
