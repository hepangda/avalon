import { describe, expect, it } from 'vitest';
import { masterGain } from '@/lib/audio/engine';
import { clampVolume } from './sound';

describe('sound preferences', () => {
  it('keeps a stored volume inside 0–1 and rejects anything else', () => {
    expect(clampVolume(0.4)).toBe(0.4);
    expect(clampVolume(3)).toBe(1);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume('loud')).toBeNull();
    expect(clampVolume(Number.NaN)).toBeNull();
  });

  it('silences the master bus when muted and eases the slider into loudness', () => {
    expect(masterGain(0.8, true)).toBe(0);
    expect(masterGain(1, false)).toBe(1);
    expect(masterGain(0.5, false)).toBe(0.25);
  });
});
