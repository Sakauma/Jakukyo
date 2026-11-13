import { RiichiSession } from './index';
import { RegionalSession } from './variants/session';
import { DEFAULT_QUICK_CONTROLS } from './quickControls';
import { validateReplayData } from './replaySupport';
import { restoredStartPoints } from './startingPoints';
import type { ReplayCaptureOptions, ReplayFrame, SavedGame, SessionOptions } from './types';
export type { ReplayFrame } from './types';

/** Reconstructs a file in a fresh, silent, disposable engine; never uses the live session. */
export async function buildReplayFrames(data: SavedGame, options: ReplayCaptureOptions = {}): Promise<ReplayFrame[]> {
  validateReplayData(data);
  options.signal?.throwIfAborted();
  const sessionOptions: SessionOptions = { mode: data.mode ?? 'riichi', seed: data.seed, matchLength: data.matchLength,
    difficulty: data.difficulty ?? 'standard', startPoints: restoredStartPoints(data), autoPlayDifficulty: data.autoPlayDifficulty ?? 'expert', autoExchangeThree: data.autoExchangeThree ?? false, rulesVersion: data.rulesVersion, variantOptions: data.variantOptions,
    speed: 0, autoPlay: false, quickControls: DEFAULT_QUICK_CONTROLS };
  const session = sessionOptions.mode === 'riichi' ? new RiichiSession(sessionOptions) : new RegionalSession(sessionOptions);
  try { return await session.captureReplayFrames(structuredClone(data), options); }
  finally { session.dispose(); }
}
