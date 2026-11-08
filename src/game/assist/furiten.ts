import type { RiichiFuritenView } from '../types';

export interface MissedWinState { temporary: boolean; riichiPass: boolean }
const normal = (tile: string) => tile.slice(0, 2).replace('0', '5');

/** Tracks only the local player's public events/decisions, never changes engine legality. */
export class MissedWinTracker {
  private temporary = false;
  private riichiPass = false;
  reset(): void { this.temporary = false; this.riichiPass = false; }
  miss(riichi: boolean): void {
    if (riichi) this.riichiPass = true;
    else this.temporary = true;
  }
  /** Temporary furiten ends at the player's next draw (including replacement draws). */
  ownDraw(): void { this.temporary = false; }
  /** The four-player core also resets its transient gate after a non-riichi called discard. */
  ownDiscard(riichi: boolean): void { if (!riichi) this.temporary = false; }
  getState(): MissedWinState { return { temporary: this.temporary, riichiPass: this.riichiPass }; }
}

export function furitenView(waits: readonly string[], ownDiscards: readonly string[], missed: MissedWinState): RiichiFuritenView {
  const discarded = new Set(ownDiscards.map(normal));
  const discardTiles = [...new Set(waits.map(normal))].filter(tile => discarded.has(tile));
  const reasons: RiichiFuritenView['reasons'] = [];
  if (discardTiles.length) reasons.push('discard');
  if (missed.riichiPass) reasons.push('riichi-pass');
  else if (missed.temporary) reasons.push('temporary');
  return { active: reasons.length > 0, reasons, discardTiles };
}
