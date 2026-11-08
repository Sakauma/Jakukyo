import type { GameSnapshot } from '../game/types';
import { motionDuration, needsTableBaseline, soundStartDelay, tableMotionCues } from '../presentation/tableTimeline';
import { getWinEffect } from '../effects/winEffects';
import { SoundLibrary } from './synthesis';
import { BackgroundMusic } from './music';
import type { SampleName } from './synthesis';
import { DEFAULT_AUDIO_PREFERENCES } from './types';
import type { AudioPreferences, TableAudio, TableSound, WinSoundTier } from './types';
export { DEFAULT_AUDIO_PREFERENCES } from './types';
export type { AudioPreferences, TableAudio, TableSound, WinSoundTier } from './types';

interface PublicFrame {
  game: string; round: string; revision: number; lastLog: number; tilesLeft: number;
  counts: number[]; wins: number[]; result: string | null; status: GameSnapshot['status'];
}
const bounded = (value: number | undefined, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
function frame(snapshot: GameSnapshot): PublicFrame {
  return {
    game: `${snapshot.seed}:${snapshot.mode ?? 'riichi'}`,
    round: `${snapshot.round.wind}:${snapshot.round.hand}:${snapshot.round.honba}`,
    revision: snapshot.revision, lastLog: snapshot.log.at(-1)?.id ?? 0, tilesLeft: snapshot.round.tilesLeft,
    counts: snapshot.players.map(player => player.concealedCount), wins: snapshot.players.map(player => player.winCount ?? 0),
    result: snapshot.result?.kind ?? null, status: snapshot.status,
  };
}
/** One lazily unlocked AudioContext, public-state event detection, and cached offline samples. */
export function createTableAudio(initial: Partial<AudioPreferences> = {}): TableAudio {
  let preferences: AudioPreferences = { ...DEFAULT_AUDIO_PREFERENCES };
  let context: AudioContext | null = null, library: SoundLibrary | null = null;
  let master: GainNode | null = null, effects: GainNode | null = null, environment: GainNode | null = null;
  let musicGain: GainNode | null = null, music: BackgroundMusic | null = null;
  let room: ConvolverNode | null = null;
  let ambientSource: AudioBufferSourceNode | null = null, ambientTheme = '';
  let previous: GameSnapshot | null = null, disposed = false, unlocked = false, variation = 0;
  let playerCount = 4, resumeNeedsBaseline = false;
  let motionReduced = false;
  const heard = new Set<string>();
  const voices = new Set<AudioBufferSourceNode>();
  const hidden = () => typeof document !== 'undefined' && document.hidden;
  const usable = () => !disposed && unlocked && !hidden() && preferences.sound && !!context && context.state === 'running';

  function ramp(param: AudioParam, target: number, seconds = .035) {
    if (!context) return;
    param.cancelScheduledValues(context.currentTime); param.setValueAtTime(param.value, context.currentTime);
    param.linearRampToValueAtTime(target, context.currentTime + seconds);
  }
  function stopVoices() {
    for (const voice of voices) { try { voice.stop(); } catch { /* Already ended. */ } }
    voices.clear();
  }
  function stopAmbience() {
    if (ambientSource) { try { ambientSource.stop(); } catch { /* Already ended. */ } ambientSource.disconnect(); }
    ambientSource = null; ambientTheme = '';
  }
  function updateAmbience() {
    if (!context || !environment || !library || !usable() || preferences.ambience === 0 || preferences.master === 0) { stopAmbience(); return; }
    if (ambientSource && ambientTheme === preferences.theme) return;
    stopAmbience();
    const source = context.createBufferSource(); source.buffer = library.ambience(preferences.theme); source.loop = true;
    source.connect(environment); source.start(); ambientSource = source; ambientTheme = preferences.theme;
  }
  function updateGains() {
    if (!master || !effects || !environment) return;
    ramp(master.gain, preferences.sound && !hidden() ? preferences.master : 0);
    ramp(effects.gain, preferences.effects);
    ramp(environment.gain, preferences.ambience * .3, .3);
    if (musicGain) ramp(musicGain.gain, preferences.music, .16);
    if (!preferences.sound || preferences.master === 0 || preferences.effects === 0) stopVoices();
    updateAmbience();
    music?.update(usable() && preferences.bgm && preferences.music > 0 && preferences.master > 0, preferences.theme);
  }
  function setPreferences(next: Partial<AudioPreferences>) {
    preferences = {
      sound: typeof next.sound === 'boolean' ? next.sound : preferences.sound,
      master: bounded(next.master, preferences.master), effects: bounded(next.effects, preferences.effects), ambience: bounded(next.ambience, preferences.ambience),
      bgm: typeof next.bgm === 'boolean' ? next.bgm : preferences.bgm, music: bounded(next.music, preferences.music),
      theme: ['jade', 'sakura', 'midnight', 'contrast'].includes(next.theme ?? '') ? next.theme! : preferences.theme,
    };
    updateGains();
  }
  setPreferences(initial);

  async function unlock(): Promise<boolean> {
    if (disposed || hidden() || typeof window === 'undefined') return false;
    try {
      if (!context) {
        const AudioConstructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioConstructor) return false;
        context = new AudioConstructor({ latencyHint: 'interactive' }); library = new SoundLibrary(context);
        master = context.createGain(); effects = context.createGain(); environment = context.createGain();
        musicGain = context.createGain(); musicGain.gain.value = preferences.music; musicGain.connect(master); music = new BackgroundMusic(context, musicGain);
        room = context.createConvolver(); room.normalize = false; room.buffer = library.impulse();
        const wet = context.createGain(), limiter = context.createDynamicsCompressor(); wet.gain.value = .16;
        limiter.threshold.value = -12; limiter.knee.value = 16; limiter.ratio.value = 3; limiter.attack.value = .004; limiter.release.value = .12;
        master.gain.value = 0; effects.gain.value = preferences.effects; environment.gain.value = 0;
        effects.connect(master); effects.connect(room); room.connect(wet); wet.connect(master); environment.connect(master);
        master.connect(limiter); limiter.connect(context.destination);
      }
      if (context.state === 'suspended') await context.resume();
      if (disposed || hidden()) return false;
      unlocked = context.state === 'running'; updateGains(); return unlocked;
    } catch { return false; }
  }

  function emit(name: SampleName, seat = 0, delay = 0, volume = 1) {
    if (!usable() || !context || !effects || !library || preferences.master === 0 || preferences.effects === 0) return;
    if (voices.size >= 20) { const oldest = voices.values().next().value; if (oldest) { try { oldest.stop(); } catch { /* Ended. */ } voices.delete(oldest); } }
    const source = context.createBufferSource(), gain = context.createGain(), pan = context.createStereoPanner();
    const physicalSeat = playerCount === 3 && seat === 2 ? 3 : seat;
    pan.pan.value = [0, .34, 0, -.34][physicalSeat] ?? 0; gain.gain.value = volume * (physicalSeat === 2 ? .82 : physicalSeat === 0 ? 1 : .91);
    source.buffer = library.get(name, variation++ % 3); source.playbackRate.value = 1 + ((variation % 5) - 2) * .006;
    source.connect(gain); gain.connect(pan); pan.connect(effects); voices.add(source);
    source.onended = () => { voices.delete(source); source.disconnect(); gain.disconnect(); pan.disconnect(); };
    source.start(context.currentTime + .006 + delay);
  }
  function play(sound: TableSound, seat = 0) { emit(sound, seat); }
  function playWin(tier: WinSoundTier, seat = 0, delay = 0) {
    if (usable() && preferences.effects > 0 && preferences.master > 0) music?.duck(tier === 'yakuman' ? 2.5 : tier === 'big' ? 1.7 : 1.1, delay);
    emit(`win-${tier}`, seat, delay);
  }

  function sync(snapshot: GameSnapshot | null, options: { reducedMotion?: boolean } = {}) {
    if (disposed) return;
    const reduced = options.reducedMotion ?? false;
    if (reduced !== motionReduced) { motionReduced = reduced; stopVoices(); }
    if (!snapshot) { previous = null; heard.clear(); stopVoices(); return; }
    playerCount = snapshot.playerCount ?? snapshot.players.length;
    const oldSnapshot = previous, current = frame(snapshot), before = oldSnapshot ? frame(oldSnapshot) : null; previous = snapshot;
    if (!before || needsTableBaseline(oldSnapshot, snapshot) || resumeNeedsBaseline) {
      const deal = before && current.game === before.game && current.status === 'playing'
        && (before.status === 'roundEnd' || current.tilesLeft > before.tilesLeft + 10) && !resumeNeedsBaseline;
      heard.clear(); stopVoices(); resumeNeedsBaseline = false;
      if (deal) play('deal');
      return;
    }
    if (current.revision === before.revision || !usable()) return;
    const detected = tableMotionCues(oldSnapshot!, snapshot).filter(cue => !heard.has(cue.key));
    // Some rules expose a flower and its replacement draw in one publication.
    // That is one supplementary-draw foley cue, not two overlapping samples.
    const cues = detected.filter(cue => !cue.flowerSupplement || !detected.some(other => other.seat === cue.seat && other.kind === 'draw' && !other.flowerSupplement));
    for (const cue of detected) heard.add(cue.key);
    for (const cue of cues) {
      emit(cue.kind, cue.seat, cue.flowerSupplement ? 0 : soundStartDelay(cue.kind, snapshot.speed, reduced) / 1000);
    }
    // Each source is scheduled once on the same short timeline as its visible tile.
    // No queue of historical logs is replayed when a tab or save is restored.
    const winner = current.wins.findIndex((count, index) => count > (before.wins[index] ?? 0));
    const hasNewWin = winner >= 0 || current.result === 'win' && before.result !== 'win' && current.wins.every(count => count === 0);
    if (hasNewWin) {
      const effect = getWinEffect(snapshot), tier = effect?.tier === 3 ? 'yakuman' : effect ? 'big' : 'normal';
      const landing = cues.reduce((delay, cue) => Math.max(delay, motionDuration(cue.kind, snapshot.speed, reduced) / 1000), 0);
      playWin(tier, winner >= 0 ? winner : snapshot.result?.winners[0]?.playerId ?? 0, landing ? landing + .04 : 0);
    } else if ((current.result === 'draw' || current.result === 'abort') && before.result !== current.result) play('roundEnd');
  }

  function onVisibility() {
    if (!context || disposed) return;
    resumeNeedsBaseline = true;
    if (hidden()) {
      stopVoices(); stopAmbience(); music?.pause();
      if (master) { master.gain.cancelScheduledValues(context.currentTime); master.gain.setValueAtTime(0, context.currentTime); }
      if (room) room.buffer = null;
      void context.suspend().catch(() => {});
    } else if (unlocked) {
      void context.resume().then(() => { if (disposed || hidden()) return; if (room && library) room.buffer = library.impulse(); updateGains(); }).catch(() => {});
    }
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  return {
    unlock, setPreferences, sync, play,
    select: () => { void unlock().then(ok => { if (ok) play('select'); }); },
    preview: () => { void unlock().then(ok => {
      if (!ok) return; stopVoices(); emit('draw'); emit('discard', 0, .35); emit('pon', 1, .78); playWin('normal', 0, 1.3);
    }); },
    previewWin: (tier = 'big') => { void unlock().then(ok => { if (ok) { stopVoices(); playWin(tier); } }); },
    dispose: () => {
      if (disposed) return; disposed = true; stopVoices(); stopAmbience(); music?.dispose(); previous = null;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      if (context) void context.close().catch(() => {});
      context = null; library = null; master = null; effects = null; environment = null; room = null; music = null; musicGain = null;
    },
  };
}
