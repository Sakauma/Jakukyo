import { createSession } from './index';
import { getMode } from './catalog';
import { RegionalSession } from './variants/session';
import type { GameSessionAPI, SessionOptions } from './types';

/** One creation point for UI and saved games. Unsupported rules never silently fall back. */
export function createGameSession(options: SessionOptions = {}): GameSessionAPI {
  const mode = getMode(options.mode);
  if (mode.id === 'riichi') return createSession(options);
  if (mode.status !== 'playable') throw new Error(`${mode.name}仍在开发，暂时不能开始。`);
  return new RegionalSession(options);
}
export * from './catalog';
export type * from './types';
