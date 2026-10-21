/**
 * Procedural score. A sacred-register choir drone (additive sines through vowel formants into
 * a synthesised cathedral reverb) carries the title and the lulls; a low pulse and percussion
 * join during combat. Nothing is sampled, so there is nothing to license or load.
 */
export type MusicState = 'title' | 'calm' | 'combat' | 'silent';

interface Voice {
  readonly gain: GainNode;
  readonly oscillators: OscillatorNode[];
}

const CHOIR_HZ = [73.42, 146.83, 220, 293.66, 349.23, 440]; // D2 D3 A3 D4 F4 A4: D minor, open
const FORMANTS: ReadonlyArray<readonly [number, number]> = [
  [600, 1040], // "ah"
  [400, 750], // "oh"
  [300, 870], // "oo"
];

const makeImpulse = (ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer => {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      // Decaying noise with a short fade-in: Moorer's classic synthetic room.
      data[i] = (Math.random() * 2 - 1) * (1 - Math.exp(-i / 400)) * (1 - t) ** decay;
    }
  }
  return buffer;
};

export class Music {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private choirBus: GainNode | null = null;
  private pulseBus: GainNode | null = null;
  private voices: Voice[] = [];
  private formantA: BiquadFilterNode | null = null;
  private formantB: BiquadFilterNode | null = null;
  private state: MusicState = 'silent';
  private beat = 0;
  private vowelPhase = 0;

  /** Call from a user gesture. Idempotent. */
  start(ctx: AudioContext, destination: AudioNode): void {
    if (this.ctx) return;
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(ctx, 4.5, 2.2);
    const dry = ctx.createGain();
    dry.gain.value = 0.35;
    const wet = ctx.createGain();
    wet.gain.value = 0.9;
    this.master.connect(dry).connect(destination);
    this.master.connect(reverb).connect(wet).connect(destination);

    this.choirBus = ctx.createGain();
    this.choirBus.gain.value = 0;
    this.formantA = ctx.createBiquadFilter();
    this.formantA.type = 'bandpass';
    this.formantA.Q.value = 6;
    this.formantB = ctx.createBiquadFilter();
    this.formantB.type = 'bandpass';
    this.formantB.Q.value = 8;
    const formantMix = ctx.createGain();
    formantMix.gain.value = 1.4;
    this.choirBus.connect(this.formantA).connect(formantMix);
    this.choirBus.connect(this.formantB).connect(formantMix);
    const body = ctx.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.value = 1800;
    this.choirBus.connect(body);
    formantMix.connect(this.master);
    body.connect(this.master);

    for (const hz of CHOIR_HZ) this.voices.push(this.makeVoice(hz));

    this.pulseBus = ctx.createGain();
    this.pulseBus.gain.value = 0;
    this.pulseBus.connect(this.master);

    window.setInterval(() => this.schedule(), 250);
  }

  setState(state: MusicState): void {
    if (state === this.state || !this.ctx || !this.master || !this.choirBus || !this.pulseBus) {
      this.state = state;
      return;
    }
    const now = this.ctx.currentTime;
    const ramp = (param: AudioParam, value: number, seconds: number): void => {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(value, now + seconds);
    };
    switch (state) {
      case 'title':
        ramp(this.master.gain, 0.9, 2.5);
        ramp(this.choirBus.gain, 0.5, 4);
        ramp(this.pulseBus.gain, 0, 2);
        break;
      case 'calm':
        ramp(this.master.gain, 0.7, 1.5);
        ramp(this.choirBus.gain, 0.32, 3);
        ramp(this.pulseBus.gain, 0.25, 4);
        break;
      case 'combat':
        ramp(this.master.gain, 0.85, 1.2);
        ramp(this.choirBus.gain, 0.22, 2);
        ramp(this.pulseBus.gain, 0.9, 1.5);
        break;
      case 'silent':
        ramp(this.master.gain, 0, 1.5);
        break;
    }
    this.state = state;
  }

  private makeVoice(hz: number): Voice {
    const ctx = this.ctx;
    const bus = this.choirBus;
    if (!ctx || !bus) throw new Error('Music not started');
    const gain = ctx.createGain();
    gain.gain.value = hz < 100 ? 0.5 : 0.16;
    gain.connect(bus);
    const oscillators: OscillatorNode[] = [];
    // Three detuned partial sets per voice give a section its width.
    for (const cents of [-5, 0, 6]) {
      const osc = ctx.createOscillator();
      osc.type = hz < 100 ? 'sine' : 'sawtooth';
      osc.frequency.value = hz;
      osc.detune.value = cents;
      const vibrato = ctx.createOscillator();
      vibrato.frequency.value = 4.8 + Math.random() * 1.4;
      const depth = ctx.createGain();
      depth.gain.value = hz * 0.0035;
      vibrato.connect(depth).connect(osc.frequency);
      vibrato.start();
      osc.connect(gain);
      osc.start();
      oscillators.push(osc);
    }
    return { gain, oscillators };
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.pulseBus || !this.formantA || !this.formantB) return;
    // Slow vowel drift gives the drone its breath.
    this.vowelPhase += 0.02;
    const blend = (Math.sin(this.vowelPhase) + 1) / 2;
    const [a0, b0] = FORMANTS[0] ?? [600, 1040];
    const [a1, b1] = FORMANTS[blend > 0.5 ? 1 : 2] ?? [400, 750];
    const t = Math.abs(blend - 0.5) * 2;
    this.formantA.frequency.setTargetAtTime(a0 + (a1 - a0) * t, ctx.currentTime, 0.5);
    this.formantB.frequency.setTargetAtTime(b0 + (b1 - b0) * t, ctx.currentTime, 0.5);

    if (this.state !== 'combat' && this.state !== 'calm') return;
    this.beat += 1;
    const quarter = this.beat % 4;
    const at = ctx.currentTime + 0.05;
    if (this.state === 'combat' && (quarter === 0 || quarter === 2)) this.drum(at, 62, 0.9);
    if (this.state === 'combat' && quarter === 2) this.snare(at + 0.25, 0.5);
    if (this.state === 'calm' && this.beat % 16 === 0) this.drum(at, 48, 0.6);
  }

  private drum(at: number, hz: number, gain: number): void {
    const ctx = this.ctx;
    const bus = this.pulseBus;
    if (!ctx || !bus) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.frequency.setValueAtTime(hz * 2.2, at);
    osc.frequency.exponentialRampToValueAtTime(hz, at + 0.12);
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
    osc.connect(env).connect(bus);
    osc.start(at);
    osc.stop(at + 0.65);
  }

  private snare(at: number, gain: number): void {
    const ctx = this.ctx;
    const bus = this.pulseBus;
    if (!ctx || !bus) return;
    const length = Math.floor(ctx.sampleRate * 0.18);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1500;
    filter.Q.value = 0.7;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
    source.connect(filter).connect(env).connect(bus);
    source.start(at);
  }
}
