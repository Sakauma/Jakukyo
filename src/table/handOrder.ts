import type { HandTile } from '../game/types';

interface DisplaySlot {
  id: string;
  tile: string;
}

export interface HandOrderController {
  /**
   * Returns current input objects in display order; their IDs stay valid for actions.
   * scopeKey must identify the hand, not the turn or snapshot revision. For example:
   * `${mode}:${seed}:${round.wind}:${round.hand}:${round.honba}:${round.dealer}`.
   * Call reset() when starting/resuming a session, including a same-seed restart.
   */
  reconcile(hand: readonly HandTile[], scopeKey: string, autoSort?: boolean): HandTile[];
  /** Sort on the next reconcile, then keep that order when autoSort is false. */
  sortOnce(): void;
  /** Forget one displayed slot after a successful discard/riichi, if its ID is known. */
  forget(tileId: string): void;
  /** Reset display history on a new/resumed session or when returning to the lobby. */
  reset(): void;
}

const suits = 'mpszf';

function tileRank(tile: string): number {
  const suit = suits.indexOf(tile[0]);
  const raw = Number(tile.slice(1));
  const number = raw === 0 && suit >= 0 && suit < 3 ? 5 : raw;
  return (suit < 0 ? suits.length : suit) * 100 + (Number.isFinite(number) ? number : 99);
}

/**
 * UI-only ordering. Engine IDs are currently positional and may be regenerated after
 * every discard. Therefore the fallback identity is the exact tile code, not index:
 * a red five is tracked separately from a normal five, but has the same sort rank.
 * Identical copies have no observable physical identity if their IDs all change.
 */
export function createHandOrderController(): HandOrderController {
  let scope: string | undefined;
  let previous: DisplaySlot[] = [];
  let requestedSort = false;

  return {
    reconcile(hand, scopeKey, autoSort = true) {
      if (scope !== scopeKey) {
        scope = scopeKey;
        previous = [];
      }

      // Exclude the current draw from matching. A previous draw enters the held
      // sequence at its old rightmost position only after it stops being `drawn`.
      const remaining = hand.filter(tile => !tile.drawn);
      const drawn = hand.filter(tile => tile.drawn);
      const matches = new Map<number, HandTile>();

      // Reserve exact surviving IDs before semantic matching, so an older missing
      // copy cannot steal another surviving copy of the same tile.
      previous.forEach((slot, index) => {
        const at = remaining.findIndex(tile => tile.id === slot.id && tile.tile === slot.tile);
        if (at >= 0) matches.set(index, remaining.splice(at, 1)[0]);
      });
      previous.forEach((slot, index) => {
        if (matches.has(index)) return;
        const at = remaining.findIndex(tile => tile.tile === slot.tile);
        if (at >= 0) matches.set(index, remaining.splice(at, 1)[0]);
      });

      let held = previous.flatMap((_, index) => {
        const tile = matches.get(index);
        return tile ? [tile] : [];
      });
      // New tiles arrive in current snapshot appearance order, even when the
      // engine itself has sorted them. Existing display slots keep their order.
      held.push(...remaining);

      if (autoSort || requestedSort) {
        held = held.map((tile, index) => ({ tile, index }))
          .sort((left, right) => tileRank(left.tile.tile) - tileRank(right.tile.tile) || left.index - right.index)
          .map(item => item.tile);
      }
      requestedSort = false;

      const ordered = [...held, ...drawn];
      previous = ordered.map(tile => ({ id: tile.id, tile: tile.tile }));
      return ordered;
    },
    sortOnce() { requestedSort = true; },
    forget(tileId) { previous = previous.filter(tile => tile.id !== tileId); },
    reset() {
      scope = undefined;
      previous = [];
      requestedSort = false;
    },
  };
}
