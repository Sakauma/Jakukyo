type Voice = 'string' | 'felt' | 'air' | 'bass';
interface Note { beat: number; duration: number; pitch: number; voice: Voice; volume: number; pan: number }
interface Layer {
  gain: GainNode; score: Note[]; theme: string; origin: number; index: number; cycle: number;
  voices: Set<AudioBufferSourceNode>; retired: boolean;
}
const BEAT = 60 / 68, LENGTH = 64, TAU = Math.PI * 2;

// Original sixteen-bar A / A' / B / A'' theme: four-beat phrases, breathing spaces,
// a contrasting middle register, and a resolved final phrase before the loop.
const MELODY: Array<Array<[number, number, number]>> = [
  [[.5, 0, 1], [1.5, 1, .5], [2, 2, 1], [3.25, 4, .6]],
  [[0, 3, 1.4], [1.75, 2, .6], [2.75, 1, .9]],
  [[.25, 0, .7], [1.25, 2, .7], [2.25, 3, 1.4]],
  [[0, 2, 1], [1.5, 1, .75], [2.75, 0, 1]],
  [[.5, 0, .7], [1.25, 1, .6], [2, 2, .8], [3, 5, .8]],
  [[.25, 4, 1.1], [1.75, 3, .6], [2.75, 2, .9]],
  [[0, 1, .8], [1, 2, .8], [2.25, 3, .7], [3.25, 1, .6]],
  [[.25, 0, 1.8], [2.5, -1, 1]],
  [[0, 5, 1.2], [1.5, 4, .7], [2.5, 3, 1]],
  [[.5, 2, .8], [1.5, 4, .8], [2.75, 5, .9]],
  [[.25, 6, .8], [1.25, 5, .6], [2.25, 4, 1.3]],
  [[0, 3, 1.4], [1.75, 2, .75], [3, 1, .7]],
  [[.5, 0, .8], [1.5, 1, .6], [2.5, 2, 1.1]],
  [[.25, 4, 1.2], [1.75, 3, .7], [2.75, 2, .9]],
  [[0, 1, 1], [1.5, 2, .6], [2.5, 1, .8]],
  [[0, -1, .8], [1.25, 1, .6], [2.25, 0, 1.65]],
];

function compose(theme: string): Note[] {
  const minor = theme === 'midnight';
  const root = theme === 'sakura' ? 65 : minor ? 57 : theme === 'contrast' ? 60 : 62;
  const scale = minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  const degree = (value: number) => root + scale[(value % 5 + 5) % 5] + Math.floor(value / 5) * 12;
  const chords = minor ? [[0, 3, 7, 14], [-4, 0, 3, 7], [-7, 0, 3, 7], [-5, 0, 2, 7]]
    : [[0, 4, 7, 14], [-3, 0, 4, 7], [-7, 0, 4, 7], [-5, 0, 2, 7]];
  const harmony = [0, 1, 2, 3, 0, 1, 2, 3, 1, 2, 0, 3, 2, 1, 3, 0];
  const lead: Voice = minor ? 'air' : theme === 'sakura' || theme === 'contrast' ? 'felt' : 'string';
  const notes: Note[] = [];
  for (let bar = 0; bar < 16; bar++) {
    const chord = chords[harmony[bar]], offset = bar * 4;
    for (const [beat, pitch, duration] of MELODY[bar]) notes.push({ beat: offset + beat, pitch: degree(pitch), duration, voice: lead, volume: .62, pan: .09 });
    notes.push({ beat: offset, pitch: root + chord[0] - 12, duration: 3.5, voice: 'bass', volume: .43, pan: 0 });
    // Two soft pad tones and a changing broken-chord figure beneath the melody.
    for (const index of [1, 2]) notes.push({ beat: offset + .06 + index * .022, pitch: root + chord[index], duration: 3.5,
      voice: 'air', volume: .11, pan: index === 1 ? -.28 : .28 });
    const arpeggio = bar % 2 ? [2, 1, 3, 1] : [1, 2, 3, 2];
    arpeggio.forEach((index, beat) => notes.push({ beat: offset + beat + .025, pitch: root + chord[index] - 12,
      duration: .85, voice: 'felt', volume: bar >= 8 && bar < 12 ? .26 : .21, pan: -.19 }));
  }
  return notes.sort((a, b) => a.beat - b.beat);
}

/** Small cached notes instead of a large downloaded soundtrack or a long in-memory recording. */
class MusicSamples {
  private cache = new Map<string, AudioBuffer>();
  constructor(private context: BaseAudioContext) {}
  note(voice: Voice, pitch: number, beats: number): AudioBuffer {
    const key = `${voice}:${pitch}:${beats}`;
    const cached = this.cache.get(key); if (cached) return cached;
    const hold = beats * BEAT, release = voice === 'air' ? .48 : .24, seconds = hold + release;
    const rate = this.context.sampleRate, buffer = this.context.createBuffer(1, Math.ceil(seconds * rate), rate), output = buffer.getChannelData(0);
    const frequency = 440 * 2 ** ((pitch - 69) / 12), attack = voice === 'air' ? .13 : voice === 'bass' ? .035 : .009;
    for (let i = 0; i < output.length; i++) {
      const t = i / rate, fade = t <= hold ? 1 : Math.max(0, 1 - (t - hold) / release) ** 2;
      const envelope = (1 - Math.exp(-t / attack)) * fade;
      let sample: number;
      if (voice === 'string') {
        sample = Math.sin(TAU * frequency * t) * Math.exp(-t / 1.05)
          + .32 * Math.sin(TAU * frequency * 2.001 * t) * Math.exp(-t / .36)
          + .13 * Math.sin(TAU * frequency * 3.006 * t) * Math.exp(-t / .17)
          + .045 * Math.sin(TAU * frequency * 4.018 * t) * Math.exp(-t / .08);
      } else if (voice === 'felt') {
        sample = Math.sin(TAU * frequency * t) * Math.exp(-t / .94)
          + .23 * Math.sin(TAU * frequency * 2.012 * t) * Math.exp(-t / .31)
          + .065 * Math.sin(TAU * frequency * 4.035 * t) * Math.exp(-t / .12);
      } else if (voice === 'air') {
        const phase = TAU * frequency * t + .018 * Math.sin(TAU * 4.2 * t);
        sample = (Math.sin(phase) + .17 * Math.sin(phase * 2) + .055 * Math.sin(phase * 3)) * (.88 + .025 * Math.sin(TAU * .65 * t));
      } else sample = (Math.sin(TAU * frequency * t) + .22 * Math.sin(TAU * frequency * 2 * t)) * Math.exp(-t / 2);
      output[i] = sample * envelope * .48;
    }
    // Cache size is bounded across repeated theme changes; existing voices retain their own buffers.
    if (this.cache.size > 150) this.cache.clear();
    this.cache.set(key, buffer); return buffer;
  }
}

/** One transport persists across lobby/game changes; old theme layers retire after a short crossfade. */
export class BackgroundMusic {
  private samples: MusicSamples;
  private duckGain: GainNode;
  private active: Layer | null = null;
  private layers = new Set<Layer>();
  private position = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private context: AudioContext, destination: AudioNode) {
    this.samples = new MusicSamples(context); this.duckGain = context.createGain(); this.duckGain.connect(destination);
  }
  update(enabled: boolean, theme: string) {
    if (this.disposed) return;
    if (!enabled) { this.pause(.16); return; }
    if (this.active?.theme === theme) {
      if (this.timer === null && this.context.state === 'running') this.pump();
      return;
    }
    const now = this.context.currentTime;
    if (this.active) { this.position = this.positionAt(now); this.retire(this.active, .7); }
    const gain = this.context.createGain(); gain.gain.value = 0; gain.connect(this.duckGain);
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(1, now + .8);
    const score = compose(theme), index = score.findIndex(note => note.beat >= this.position);
    this.active = { gain, score, theme, origin: now + .025 - this.position * BEAT,
      index: index < 0 ? 0 : index, cycle: index < 0 ? 1 : 0, voices: new Set(), retired: false };
    this.layers.add(this.active); this.clearTimer(); this.pump();
  }
  private positionAt(time: number) { return this.active ? Math.max(0, (time - this.active.origin) / BEAT) % LENGTH : this.position; }
  private clearTimer() { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  private retire(layer: Layer, fade: number) {
    layer.retired = true;
    const now = this.context.currentTime;
    layer.gain.gain.cancelAndHoldAtTime(now); layer.gain.gain.linearRampToValueAtTime(0, now + fade);
    for (const source of layer.voices) { try { source.stop(now + fade + .02); } catch { /* Already ended. */ } }
    if (!layer.voices.size) { layer.gain.disconnect(); this.layers.delete(layer); }
  }
  private pump = () => {
    this.timer = null;
    const layer = this.active;
    if (!layer || this.disposed || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    let scheduled = 0;
    while (scheduled++ < 40) {
      const note = layer.score[layer.index], time = layer.origin + (layer.cycle * LENGTH + note.beat) * BEAT;
      if (time > now + .8) break;
      if (time >= now - .02) this.schedule(layer, note, Math.max(time, now + .005));
      layer.index++; if (layer.index === layer.score.length) { layer.index = 0; layer.cycle++; }
    }
    this.timer = setTimeout(this.pump, 200);
  };
  private schedule(layer: Layer, note: Note, time: number) {
    const source = this.context.createBufferSource(), gain = this.context.createGain(), pan = this.context.createStereoPanner();
    source.buffer = this.samples.note(note.voice, note.pitch, note.duration); gain.gain.value = note.volume; pan.pan.value = note.pan;
    source.connect(gain); gain.connect(pan); pan.connect(layer.gain); layer.voices.add(source);
    source.onended = () => {
      source.disconnect(); gain.disconnect(); pan.disconnect(); layer.voices.delete(source);
      if (layer.retired && !layer.voices.size) { layer.gain.disconnect(); this.layers.delete(layer); }
    };
    source.start(time);
  }
  duck(duration: number, delay = 0) {
    if (this.disposed || !this.active) return;
    const now = this.context.currentTime, start = now + delay, gain = this.duckGain.gain;
    gain.cancelAndHoldAtTime(now); gain.setValueAtTime(gain.value, start);
    gain.linearRampToValueAtTime(.26, start + .06); gain.setValueAtTime(.26, start + duration);
    gain.linearRampToValueAtTime(1, start + duration + .65);
  }
  pause(fade = 0) {
    this.clearTimer(); if (!this.active) return;
    this.position = this.positionAt(this.context.currentTime); this.retire(this.active, fade); this.active = null;
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.clearTimer();
    for (const layer of this.layers) { for (const source of layer.voices) { try { source.stop(); } catch { /* Already ended. */ } } layer.gain.disconnect(); }
    this.layers.clear(); this.active = null; this.duckGain.disconnect();
  }
}
