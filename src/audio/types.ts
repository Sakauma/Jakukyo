import type { GameSnapshot } from '../game/types';

export type TableSound = 'select' | 'draw' | 'discard' | 'chi' | 'pon' | 'kan' | 'riichi' | 'kita' | 'deal' | 'roundEnd';
export type WinSoundTier = 'normal' | 'big' | 'yakuman';
export interface AudioPreferences {
  sound: boolean;
  /** All volume controls use 0..1; ambience=0 switches the room sound off. */
  master: number;
  effects: number;
  ambience: number;
  /** Background music has a separate switch and volume; sound remains the global mute. */
  bgm: boolean;
  music: number;
  theme: string;
}
export const DEFAULT_AUDIO_PREFERENCES: Readonly<AudioPreferences> = {
  sound: true, master: .72, effects: .85, ambience: 0, bgm: true, music: .18, theme: 'jade',
};
export interface TableAudio {
  /** Call from a user gesture. No context exists before the first unlock. */
  unlock(): Promise<boolean>;
  setPreferences(preferences: Partial<AudioPreferences>): void;
  /** First/restored snapshots establish a silent baseline; null resets it. */
  sync(snapshot: GameSnapshot | null, options?: { reducedMotion?: boolean }): void;
  /** Seat is the fixed visible player id: 0 near, 1 right, 2 far, 3 left. */
  play(sound: TableSound, seat?: number): void;
  select(): void;
  /** A short draw/discard/meld/win sequence, initiated by a user gesture. */
  preview(): void;
  previewWin(tier?: WinSoundTier): void;
  dispose(): void;
}
