import type { DiscardTile } from '../game/types';

export const RIVER_COLUMNS = 6;
export const RIVER_ROWS = 4;
export const RIVER_PAGE_SIZE = RIVER_COLUMNS * RIVER_ROWS;
export interface VisibleDiscard { sourceIndex: number; tile: string; sideways: boolean; tsumogiri: boolean }

/** Called tiles move to the caller's meld. A called riichi marker passes to the next discard. */
export function visibleDiscards(discards: readonly DiscardTile[]): VisibleDiscard[] {
  const visible: VisibleDiscard[] = [];
  let pendingRiichi = false;
  discards.forEach((discard, sourceIndex) => {
    pendingRiichi ||= discard.riichi;
    if (discard.called) return;
    visible.push({ sourceIndex, tile: discard.tile, sideways: pendingRiichi, tsumogiri: discard.tsumogiri });
    pendingRiichi = false;
  });
  return visible;
}

/** Every page has exactly the same left origin, six columns and four bounded rows. */
export function riverLayout(discards: readonly DiscardTile[]) {
  const visible = visibleDiscards(discards), page = Math.max(0, Math.ceil(visible.length / RIVER_PAGE_SIZE) - 1);
  const scale = .78, width = .55 * scale, height = .77 * scale, gap = .045;
  const items = visible.slice(page * RIVER_PAGE_SIZE, (page + 1) * RIVER_PAGE_SIZE);
  // Offset each river around the centre, leaving room for one sideways riichi tile.
  // Keep the first row beyond the riichi stick and the fourth inside the skewed wall.
  const left = -1.95;
  let edge = left;
  return {
    count: visible.length, page: page + 1, pages: Math.max(1, Math.ceil(visible.length / RIVER_PAGE_SIZE)),
    items: items.map((discard, index) => {
      const column = index % RIVER_COLUMNS, row = Math.floor(index / RIVER_COLUMNS);
      if (column === 0) edge = left;
      const extent = discard.sideways ? height : width;
      const x = edge + extent / 2; edge += extent + gap;
      return { ...discard, scale, position: [x, 0, 1.84 + row * .63] as [number, number, number], rotation: [-Math.PI / 2, 0, discard.sideways ? Math.PI / 2 : 0] as [number, number, number] };
    }),
  };
}
