import type { ModeId, SavedGame } from './types';

export const REGIONAL_START_POINTS = 100;
export const LEGACY_REGIONAL_START_POINTS = 1000;

export function defaultStartPoints(mode?: ModeId): number {
  return mode == null || mode === 'riichi' ? 25000 : mode === 'sanma' ? 35000 : REGIONAL_START_POINTS;
}

/** Missing metadata always describes an older table, never the new default. */
export function restoredStartPoints(save: Pick<SavedGame, 'mode' | 'startPoints'>): number {
  return save.startPoints ?? (save.mode == null || save.mode === 'riichi' || save.mode === 'sanma'
    ? defaultStartPoints(save.mode) : LEGACY_REGIONAL_START_POINTS);
}

export function validStartPoints(mode: ModeId | undefined, value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return false;
  return mode == null || mode === 'riichi' || mode === 'sanma'
    ? value === defaultStartPoints(mode)
    : value === REGIONAL_START_POINTS || value === LEGACY_REGIONAL_START_POINTS;
}
