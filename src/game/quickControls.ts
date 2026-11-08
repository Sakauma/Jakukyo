import type { LegalAction, QuickControls } from './types';

export const DEFAULT_QUICK_CONTROLS: Readonly<QuickControls> = Object.freeze({ autoWin: false, autoDiscard: false, noCall: false });
export function updateQuickControls(previous: QuickControls, incoming?: Partial<QuickControls>): QuickControls {
  const next = { ...previous };
  if (incoming) for (const key of ['autoWin', 'autoDiscard', 'noCall'] as const) {
    if (typeof incoming[key] === 'boolean') next[key] = incoming[key];
  }
  return next;
}

/** The rule engine remains the sole source of legality. Never synthesizes an action. */
export function chooseQuickAction<T extends LegalAction>(actions: readonly T[], controls: QuickControls, drawnTileId?: string): T | undefined {
  const win = actions.find(action => action.type === 'ron' || action.type === 'tsumo');
  // When automatic winning is off, keep the human's win opportunity on screen.
  if (win) return controls.autoWin ? win : undefined;
  if (controls.autoDiscard && drawnTileId) {
    const discard = actions.find(action => action.type === 'discard' && action.tileId === drawnTileId);
    if (discard) return discard;
  }
  if (controls.noCall && actions.some(action => action.type === 'chi' || action.type === 'pon' || action.type === 'kan')) {
    return actions.find(action => action.type === 'pass');
  }
  return undefined;
}
