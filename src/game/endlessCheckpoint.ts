import type { EndlessCheckpoint, ModeId } from './types';

/** Validate an endless hand's public round-start state before reconstructing it. */
export function validEndlessCheckpoint(value: unknown, mode: ModeId | undefined): value is EndlessCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const checkpoint = value as Partial<EndlessCheckpoint>;
  const players = mode === 'sanma' ? 3 : 4;
  return checkpoint.version === 1
    && typeof checkpoint.sessionId === 'string' && checkpoint.sessionId.length > 0 && checkpoint.sessionId.length <= 128
    && Number.isSafeInteger(checkpoint.sequence) && checkpoint.sequence! >= 1
    && Number.isSafeInteger(checkpoint.rotation) && checkpoint.rotation! >= 0 && checkpoint.rotation! < checkpoint.sequence!
    && Number.isSafeInteger(checkpoint.dealer) && checkpoint.dealer === checkpoint.rotation! % players
    && Number.isSafeInteger(checkpoint.honba) && checkpoint.honba! >= 0
    && Number.isSafeInteger(checkpoint.sticks) && checkpoint.sticks! >= 0
    && Array.isArray(checkpoint.points) && checkpoint.points.length === players
    && checkpoint.points.every(point => Number.isSafeInteger(point));
}

/** Identity is separate from the seed; it never changes the shuffled wall. */
export function newEndlessSessionId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `endless-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
