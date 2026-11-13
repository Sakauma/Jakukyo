import type { TableSound, WinSoundTier } from './types';

export type SampleName = TableSound | `win-${WinSoundTier}`;

function random(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 * 2 - 1; };
}
const TAU = Math.PI * 2;

/** Small modal impacts: inharmonic tile/rod resonances plus filtered contact noise. */
function impact(output: Float32Array, rate: number, at: number, strength: number, seed: number, material: 'tile' | 'felt' | 'stick' = 'tile') {
  const noise = random(seed), start = Math.round(at * rate);
  const bend = 1 + noise() * .025;
  const modes = material === 'stick' ? [690, 1837, 3141] : material === 'felt' ? [176, 541, 1373] : [829, 1483, 2519, 3617];
  const duration = material === 'felt' ? .16 : .115;
  let low = 0, smooth = 0;
  for (let i = 0; i < duration * rate && start + i < output.length; i++) {
    const t = i / rate, n = noise(); low += .075 * (n - low); smooth += .33 * (n - smooth);
    const onset = 1 - Math.exp(-t / .00032);
    const ring = modes.reduce((sum, hz, index) => sum + Math.sin(TAU * hz * bend * t)
      * Math.exp(-t / (material === 'felt' ? .012 : .018 + index * .003)) / (2.2 + index * 1.3), 0);
    const body = Math.sin(TAU * (material === 'stick' ? 238 : 151) * t) * Math.exp(-t / .027);
    const contact = (smooth - low) * Math.exp(-t / .008);
    output[start + i] += strength * onset * (ring * (material === 'felt' ? .18 : .48)
      + body * (material === 'felt' ? .7 : .24) + contact * .72 + low * Math.exp(-t / .024) * .45);
  }
}

/** A tile sliding against cloth: broad, low-passed friction with an irregular envelope. */
function friction(output: Float32Array, rate: number, at: number, duration: number, strength: number, seed: number) {
  const noise = random(seed), start = Math.round(at * rate);
  let fast = 0, slow = 0;
  for (let i = 0; i < duration * rate && start + i < output.length; i++) {
    const t = i / rate, progress = t / duration, n = noise();
    fast += .19 * (n - fast); slow += .014 * (n - slow);
    const envelope = Math.sin(Math.PI * progress) ** 1.3 * (.76 + .15 * Math.sin(TAU * 37 * t) + .09 * Math.sin(TAU * 61 * t));
    output[start + i] += (fast - slow) * envelope * strength;
  }
}

/** Soft mallet/bowl partials decay independently, avoiding a sustained oscillator beep. */
function mallet(output: Float32Array, rate: number, at: number, frequency: number, strength: number, decay: number) {
  const start = Math.round(at * rate), duration = decay * 5;
  for (let i = 0; i < duration * rate && start + i < output.length; i++) {
    const t = i / rate, attack = 1 - Math.exp(-t / .005);
    const wave = Math.sin(TAU * frequency * t) * Math.exp(-t / decay)
      + .24 * Math.sin(TAU * frequency * 2.756 * t) * Math.exp(-t / (decay * .34))
      + .09 * Math.sin(TAU * frequency * 4.071 * t) * Math.exp(-t / (decay * .17));
    output[start + i] += wave * attack * strength;
  }
}

function capAndFade(data: Float32Array, peak: number, rate: number) {
  const maximum = data.reduce((value, sample) => Math.max(value, Math.abs(sample)), .0001);
  const scale = peak / maximum, fade = Math.min(Math.round(rate * .012), data.length / 2);
  for (let i = 0; i < data.length; i++) data[i] *= scale * Math.min(1, i / 12, (data.length - 1 - i) / fade);
}

/** Each short sample is generated once per material variation and cached, entirely offline. */
export class SoundLibrary {
  private samples = new Map<string, AudioBuffer>();
  constructor(private readonly context: BaseAudioContext) {}

  get(name: SampleName, variation = 0): AudioBuffer {
    const key = `${name}:${variation % 3}`;
    const cached = this.samples.get(key); if (cached) return cached;
    const rate = this.context.sampleRate;
    const duration = name === 'win-yakuman' ? 2.8 : name === 'win-big' ? 2 : name === 'win-normal' ? 1.3 : name === 'roundEnd' ? .9 : name === 'deal' ? .18 : .5;
    const buffer = this.context.createBuffer(1, Math.ceil(rate * duration), rate), data = buffer.getChannelData(0);
    const seed = 317 + variation * 7919;
    const tap = (at: number, strength = .7, material: 'tile' | 'felt' | 'stick' = 'tile') => impact(data, rate, at, strength, seed + Math.round(at * 10000), material);
    let peak = .66;
    if (name === 'select') { tap(0, .42, 'felt'); tap(.012, .14); peak = .22; }
    else if (name === 'draw') { friction(data, rate, 0, .13, .7, seed); tap(.105, .32); peak = .34; }
    else if (name === 'discard') { tap(0, .85, 'felt'); tap(.007, .68); tap(.037, .12, 'felt'); }
    else if (name === 'chi') { friction(data, rate, 0, .12, .4, seed); tap(.045, .48); tap(.095, .62); tap(.15, .44, 'felt'); }
    else if (name === 'pon') { tap(0, .9); tap(.052, .68); tap(.084, .55, 'felt'); }
    else if (name === 'kan') { tap(0, .86); tap(.045, .75); tap(.098, .66); tap(.157, .7, 'felt'); tap(.168, .36); }
    else if (name === 'riichi') { friction(data, rate, 0, .14, .23, seed); tap(.1, .6, 'stick'); tap(.123, .19, 'stick'); peak = .49; }
    else if (name === 'kita') { tap(0, .54); friction(data, rate, .04, .13, .6, seed); tap(.174, .3, 'felt'); peak = .45; }
    else if (name === 'deal') { tap(0, .5, 'felt'); tap(.014, .32); tap(.038, .18); peak = .31; }
    else if (name === 'reveal') { friction(data, rate, 0, .09, .2, seed); tap(0, .35, 'felt'); tap(.035, .39); tap(.07, .49, 'felt'); peak = .43; }
    else if (name === 'collect') { friction(data, rate, 0, .39, .7, seed); tap(.07, .2); tap(.15, .24, 'felt'); tap(.24, .16); tap(.35, .26, 'felt'); peak = .38; }
    else if (name === 'roundEnd') { friction(data, rate, .02, .24, .34, seed); mallet(data, rate, .08, 174.6, .2, .15); mallet(data, rate, .19, 261.6, .11, .12); peak = .29; }
    else {
      tap(0, .45, 'felt'); tap(.026, .2);
      const notes = name === 'win-yakuman' ? [146.83, 220, 293.66, 440, 587.33] : name === 'win-big' ? [196, 293.66, 392, 587.33] : [196, 293.66, 392];
      const spacing = name === 'win-normal' ? .115 : .17;
      notes.forEach((frequency, index) => mallet(data, rate, .07 + index * spacing, frequency, .23 - index * .024, name === 'win-yakuman' ? .43 : .27));
      if (name !== 'win-normal') { mallet(data, rate, .02, 98, .25, .28); friction(data, rate, .15, .5, .16, seed); }
      peak = name === 'win-yakuman' ? .68 : name === 'win-big' ? .59 : .46;
    }
    capAndFade(data, peak, rate); this.samples.set(key, buffer); return buffer;
  }

  impulse(): AudioBuffer {
    const cached = this.samples.get('impulse'); if (cached) return cached;
    const rate = this.context.sampleRate, buffer = this.context.createBuffer(2, Math.round(rate * .21), rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel), noise = random(1297 + channel); let filtered = 0;
      for (let i = 0; i < data.length; i++) {
        const t = i / rate; filtered += .2 * (noise() - filtered);
        data[i] = t < .008 ? 0 : filtered * .08 * Math.exp(-t / .035);
      }
      for (const [time, gain] of [[.011, .42], [.024, .24], [.039, .12]]) data[Math.round((time + channel * .0014) * rate)] += gain;
    }
    this.samples.set('impulse', buffer); return buffer;
  }

  ambience(theme: string): AudioBuffer {
    const key = `room:${theme}`, cached = this.samples.get(key); if (cached) return cached;
    const rate = this.context.sampleRate, duration = 8, buffer = this.context.createBuffer(2, rate * duration, rate);
    const garden = theme === 'sakura', night = theme === 'midnight';
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel), noise = random(713 + channel * 1231 + (garden ? 24 : night ? 81 : 0));
      let mid = 0, bass = 0, dc = 0;
      for (let i = 0; i < data.length; i++) {
        const t = i / rate, n = noise(); mid += (garden ? .055 : night ? .018 : .03) * (n - mid); bass += .004 * (n - bass); dc += .0006 * (n - dc);
        const breeze = .68 + .17 * Math.sin(TAU * t / 8 + channel * .7) + .09 * Math.sin(TAU * t / 2);
        const edge = Math.min(1, t / .15, (duration - t) / .15);
        data[i] = ((mid - bass) * (garden ? 1.8 : .9) + (bass - dc) * .9) * breeze * Math.sin(Math.PI * Math.max(0, edge) / 2);
      }
    }
    this.samples.set(key, buffer); return buffer;
  }
}
