/**
 * Every cue is synthesized, rendered once offline into a buffer and replayed from there, so the
 * repo carries no audio files. Pitches lean on D major for the light side and D minor for the dark.
 */
export type SoundName =
  | 'deal' | 'flip' | 'shuffle' | 'gather'
  | 'voteApprove' | 'voteReject'
  | 'missionSuccess' | 'missionFail' | 'seal'
  | 'leader' | 'lady'
  | 'heartbeat' | 'stab' | 'assassinHit' | 'assassinMiss'
  | 'victory' | 'defeat' | 'turn';

interface Recipe {
  /** Seconds of audio to render, tail included. */
  length: number;
  /** Share of the signal sent to the room; cards stay dry, bells and brass ring out. */
  space: number;
  draw: (k: Kit) => void;
}

/** Small deterministic noise source, so every render of a cue sounds the same. */
function noiseBuffer(ctx: BaseAudioContext, seconds: number, seed = 7) {
  const buffer = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let s = seed;
  for (let i = 0; i < data.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    data[i] = s / 2 ** 31 - 1;
  }
  return buffer;
}

/** Drawing tools bound to one offline render. */
class Kit {
  constructor(readonly ctx: BaseAudioContext, readonly out: AudioNode) {}

  private envelope(gain: AudioParam, t: number, attack: number, peak: number, decay: number) {
    gain.setValueAtTime(0.0001, t);
    gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /** A filtered breath of noise: card edges, swishes, cloth. */
  noise(t: number, opts: {
    dur: number; peak: number; attack?: number;
    type?: BiquadFilterType; freq: number; freqEnd?: number; q?: number; seed?: number;
  }) {
    const { ctx } = this;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, opts.dur + 0.05, opts.seed);
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type ?? 'bandpass';
    filter.Q.value = opts.q ?? 0.9;
    filter.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) filter.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.dur);
    const gain = ctx.createGain();
    const attack = opts.attack ?? 0.003;
    this.envelope(gain.gain, t, attack, opts.peak, Math.max(opts.dur - attack, 0.005));
    src.connect(filter).connect(gain).connect(this.out);
    src.start(t);
    src.stop(t + opts.dur + 0.05);
  }

  /** One oscillator voice with an optional pitch glide and a lowpass. */
  tone(t: number, opts: {
    freq: number; freqEnd?: number; glide?: number; dur: number; peak: number; attack?: number;
    type?: OscillatorType; detune?: number; cutoff?: number; cutoffEnd?: number;
  }) {
    const { ctx } = this;
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.detune.value = opts.detune ?? 0;
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + (opts.glide ?? opts.dur));
    const gain = ctx.createGain();
    const attack = opts.attack ?? 0.004;
    this.envelope(gain.gain, t, attack, opts.peak, Math.max(opts.dur - attack, 0.01));
    let node: AudioNode = osc;
    if (opts.cutoff) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.7;
      filter.frequency.setValueAtTime(opts.cutoff, t);
      if (opts.cutoffEnd) filter.frequency.exponentialRampToValueAtTime(opts.cutoffEnd, t + opts.dur);
      node = osc.connect(filter);
    }
    node.connect(gain).connect(this.out);
    osc.start(t);
    osc.stop(t + opts.dur + 0.05);
  }

  /** Struck metal: a fundamental with inharmonic partials that die away faster than it does. */
  bell(t: number, freq: number, peak: number, dur = 1.6) {
    const partials: Array<[number, number, number]> = [
      [1, 1, 1], [2.01, 0.42, 0.7], [2.76, 0.3, 0.5], [5.4, 0.12, 0.3], [8.9, 0.05, 0.18],
    ];
    for (const [ratio, amp, life] of partials)
      this.tone(t, { freq: freq * ratio, dur: dur * life, peak: peak * amp, attack: 0.002 });
  }

  /** A harp-like pluck: bright on the attack, closing quickly. */
  pluck(t: number, freq: number, peak: number, dur = 0.9) {
    this.tone(t, { freq, dur, peak, type: 'triangle', attack: 0.003, cutoff: freq * 8, cutoffEnd: freq * 1.5 });
    this.tone(t, { freq: freq * 2, dur: dur * 0.4, peak: peak * 0.25, attack: 0.002 });
  }

  /** Brass section: detuned saws behind a lowpass that opens with the swell. */
  brass(t: number, freq: number, peak: number, dur: number, attack = 0.06, bright = 6) {
    for (const detune of [-7, 0, 6])
      this.tone(t, { freq, dur, peak: peak / 3, attack, type: 'sawtooth', detune, cutoff: freq * bright, cutoffEnd: freq * 1.2 });
  }

  /** A low drum hit with the pitch falling out of it: thumps, seals, heartbeats. */
  thump(t: number, peak: number, from = 150, to = 45, dur = 0.22) {
    this.tone(t, { freq: from, freqEnd: to, glide: dur * 0.6, dur, peak, attack: 0.002 });
    this.noise(t, { dur: 0.03, peak: peak * 0.35, type: 'lowpass', freq: 900, q: 0.5 });
  }

  /** One card: a short swish off the deck and a soft tap where it lands. */
  card(t: number, peak: number, seed = 3) {
    this.noise(t, { dur: 0.085, peak, type: 'highpass', freq: 5200, freqEnd: 1400, q: 0.6, seed });
    this.noise(t + 0.07, { dur: 0.03, peak: peak * 0.7, freq: 1800, q: 1.2, seed: seed + 1 });
  }
}

const D = { d3: 146.83, f3: 174.61, a3: 220, d4: 293.66, e4: 329.63, f4: 349.23, fs4: 369.99, g4: 392, a4: 440, bb4: 466.16, c5: 523.25, cs5: 554.37, d5: 587.33, e5: 659.25, fs5: 739.99, a5: 880, d6: 1174.66, e6: 1318.51, fs6: 1479.98, a6: 1760 };

export const RECIPES: Record<SoundName, Recipe> = {
  deal: { length: 0.25, space: 0, draw: (k) => k.card(0, 0.5) },
  flip: {
    length: 0.3, space: 0.05,
    draw: (k) => {
      k.noise(0, { dur: 0.13, peak: 0.32, freq: 1100, freqEnd: 4200, q: 0.8, attack: 0.04, seed: 11 });
      k.noise(0.115, { dur: 0.025, peak: 0.55, type: 'highpass', freq: 2500, q: 0.7, seed: 12 });
    },
  },
  shuffle: {
    length: 1.3, space: 0,
    draw: (k) => {
      // A riffle: the two halves leaf into each other quickly, then are squared up with a knock.
      for (let i = 0; i < 26; i++) {
        const at = 0.05 + 0.75 * Math.sin((i / 26) * Math.PI * 0.5);
        k.noise(at, { dur: 0.016, peak: 0.18 + (i % 3) * 0.06, freq: 3200 + (i % 5) * 500, q: 1.4, seed: 20 + i });
      }
      k.noise(0.02, { dur: 0.85, peak: 0.06, type: 'lowpass', freq: 2400, q: 0.5, attack: 0.2, seed: 60 });
      k.noise(1.02, { dur: 0.04, peak: 0.45, type: 'lowpass', freq: 1300, q: 0.8, seed: 61 });
      k.noise(1.12, { dur: 0.035, peak: 0.35, type: 'lowpass', freq: 1500, q: 0.8, seed: 62 });
    },
  },
  gather: {
    length: 0.6, space: 0,
    draw: (k) => k.noise(0, { dur: 0.5, peak: 0.16, type: 'bandpass', freq: 700, freqEnd: 2600, q: 0.6, attack: 0.2, seed: 70 }),
  },
  voteApprove: {
    length: 1.4, space: 0.35,
    draw: (k) => {
      [D.d5, D.fs5, D.a5].forEach((f, i) => k.pluck(i * 0.075, f, 0.32));
      k.bell(0.22, D.d6, 0.12, 1.1);
    },
  },
  voteReject: {
    length: 1.1, space: 0.25,
    draw: (k) => {
      k.thump(0, 0.5, 120, 50, 0.2);
      k.tone(0.02, { freq: D.e4, dur: 0.35, peak: 0.22, type: 'triangle', cutoff: 1200, cutoffEnd: 300 });
      k.tone(0.17, { freq: D.cs5 / 2, dur: 0.7, peak: 0.26, type: 'triangle', cutoff: 900, cutoffEnd: 250 });
    },
  },
  missionSuccess: {
    length: 2.6, space: 0.5,
    draw: (k) => {
      [D.d5, D.fs5, D.a5, D.d6].forEach((f, i) => k.bell(i * 0.07, f, 0.16, 2));
      k.brass(0.05, D.d4, 0.2, 1.4, 0.18, 4);
      k.brass(0.05, D.a4, 0.14, 1.4, 0.18, 4);
    },
  },
  missionFail: {
    length: 2.4, space: 0.45,
    draw: (k) => {
      // The card cracks, the floor drops, and a minor second grinds underneath.
      k.noise(0, { dur: 0.2, peak: 0.55, type: 'highpass', freq: 1800, freqEnd: 600, q: 0.6, seed: 80 });
      k.thump(0, 0.8, 110, 32, 0.6);
      k.brass(0.04, D.d3, 0.26, 1.8, 0.1, 3);
      k.brass(0.04, D.d3 * 1.0595, 0.2, 1.8, 0.1, 3);
      k.brass(0.04, D.f3, 0.16, 1.8, 0.1, 3);
    },
  },
  seal: {
    length: 1, space: 0.25,
    draw: (k) => {
      k.thump(0, 0.9, 170, 42, 0.26);
      k.noise(0.005, { dur: 0.12, peak: 0.22, type: 'lowpass', freq: 600, freqEnd: 200, q: 0.6, seed: 90 });
      k.bell(0.03, D.a6, 0.035, 0.7);
    },
  },
  leader: {
    length: 1.3, space: 0.4,
    draw: (k) => {
      k.brass(0, D.a4, 0.16, 0.22, 0.03, 5);
      k.brass(0.16, D.d5, 0.2, 0.6, 0.04, 5);
      k.bell(0.16, D.d6, 0.05, 0.9);
    },
  },
  lady: {
    length: 2.4, space: 0.6,
    draw: (k) => {
      // Water stirring, then a rising pentatonic shimmer with a slow chorus beat.
      k.noise(0, { dur: 0.9, peak: 0.08, type: 'bandpass', freq: 400, freqEnd: 1800, q: 1.4, attack: 0.3, seed: 100 });
      [D.d5, D.e5, D.fs5, D.a5, D.d6, D.e6].forEach((f, i) => {
        k.tone(0.1 + i * 0.09, { freq: f, dur: 1.4, peak: 0.08, attack: 0.02 });
        k.tone(0.1 + i * 0.09, { freq: f, dur: 1.4, peak: 0.05, attack: 0.02, detune: 9 });
      });
    },
  },
  heartbeat: {
    length: 1.6, space: 0.15,
    draw: (k) => {
      for (const at of [0.05, 0.85]) {
        k.thump(at, 0.85, 75, 38, 0.2);
        k.thump(at + 0.2, 0.55, 65, 36, 0.22);
      }
    },
  },
  stab: {
    // The blade draws a breath before it lands, matching the reveal's impact point.
    length: 1.2, space: 0.35,
    draw: (k) => {
      k.noise(0, { dur: 0.15, peak: 0.25, type: 'highpass', freq: 900, freqEnd: 6000, q: 0.7, attack: 0.12, seed: 110 });
      k.thump(0.15, 0.9, 140, 40, 0.3);
      k.noise(0.15, { dur: 0.08, peak: 0.5, type: 'highpass', freq: 3000, q: 0.7, seed: 111 });
      for (const [f, p] of [[1240, 0.08], [1873, 0.06], [2650, 0.05], [3420, 0.03]] as const)
        k.tone(0.15, { freq: f, dur: 0.7, peak: p, attack: 0.001 });
    },
  },
  assassinHit: {
    length: 3.6, space: 0.55,
    draw: (k) => {
      // A gong under a dark minor chord: Merlin has fallen.
      for (const [r, a, life] of [[1, 0.5, 3], [1.48, 0.25, 2.2], [2.12, 0.16, 1.6], [2.86, 0.1, 1.1]] as const)
        k.tone(0, { freq: 73.4 * r, dur: life, peak: a, attack: 0.004 });
      k.brass(0.1, D.d3, 0.22, 2.8, 0.4, 3);
      k.brass(0.1, D.f3, 0.18, 2.8, 0.4, 3);
      k.brass(0.1, D.a3, 0.16, 2.8, 0.4, 3);
    },
  },
  assassinMiss: {
    length: 3, space: 0.55,
    draw: (k) => {
      k.noise(0, { dur: 0.6, peak: 0.1, type: 'highpass', freq: 2000, freqEnd: 8000, q: 0.5, attack: 0.3, seed: 120 });
      [D.d5, D.a5, D.d6, D.fs6].forEach((f, i) => k.bell(0.12 + i * 0.1, f, 0.13, 2.4));
      k.brass(0.15, D.d4, 0.16, 2.2, 0.35, 4);
      k.brass(0.15, D.fs4, 0.12, 2.2, 0.35, 4);
    },
  },
  victory: {
    length: 3.4, space: 0.5,
    draw: (k) => {
      // Ta-ta-taa, then the full chord with bells on top.
      k.brass(0, D.a4, 0.22, 0.14, 0.02, 7);
      k.brass(0.15, D.a4, 0.22, 0.14, 0.02, 7);
      k.brass(0.3, D.d5, 0.3, 2.4, 0.04, 7);
      k.brass(0.3, D.fs4, 0.2, 2.4, 0.06, 6);
      k.brass(0.3, D.d4, 0.2, 2.4, 0.08, 5);
      [D.d6, D.fs6, D.a6].forEach((f, i) => k.bell(0.32 + i * 0.06, f, 0.08, 2.2));
      k.thump(0.3, 0.5, 110, 45, 0.4);
    },
  },
  defeat: {
    length: 3.6, space: 0.55,
    draw: (k) => {
      [D.a4, D.f4, D.d4].forEach((f, i) => k.brass(i * 0.42, f, 0.24, i === 2 ? 2.6 : 0.5, 0.08, 3.5));
      k.brass(0.84, D.a3, 0.16, 2.6, 0.2, 3);
      k.tone(0, { freq: 73.4, dur: 3.2, peak: 0.25, attack: 0.5 });
      k.thump(0.84, 0.5, 90, 35, 0.5);
    },
  },
  turn: {
    length: 1.6, space: 0.45,
    draw: (k) => {
      k.bell(0, D.a5, 0.16, 1.2);
      k.bell(0.13, D.e6, 0.14, 1.4);
    },
  },
};

export const SOUND_NAMES = Object.keys(RECIPES) as SoundName[];

/** A generated room: decaying stereo noise, enough to give the cues somewhere to ring. */
function roomImpulse(ctx: BaseAudioContext, seconds = 1.8) {
  const length = Math.ceil(seconds * ctx.sampleRate);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    let s = 31 + c;
    for (let i = 0; i < length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      data[i] = (s / 2 ** 31 - 1) * (1 - i / length) ** 3;
    }
  }
  return impulse;
}

/** Renders one cue offline; the result is replayed as many times as needed. */
export async function renderSound(name: SoundName, sampleRate: number): Promise<AudioBuffer> {
  const recipe = RECIPES[name];
  const tail = recipe.space ? 1.2 : 0.05;
  const ctx = new OfflineAudioContext(2, Math.ceil((recipe.length + tail) * sampleRate), sampleRate);
  const bus = ctx.createGain();
  // Headroom: stacked voices and the room send must not clip once summed.
  bus.gain.value = 0.7;
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -10;
  compressor.ratio.value = 4;
  bus.connect(compressor).connect(ctx.destination);
  if (recipe.space) {
    const room = ctx.createConvolver();
    room.buffer = roomImpulse(ctx);
    const send = ctx.createGain();
    send.gain.value = recipe.space;
    bus.connect(send).connect(room).connect(compressor);
  }
  recipe.draw(new Kit(ctx, bus));
  return ctx.startRendering();
}
