import type { HandTile, MeldView } from '../game/types';

export const HAND_ROW_Z = 5.80;
export const SEAT_ROW_HALF_WIDTH = 5.35;

interface MeldTileLayout {
  key: string;
  meldIndex: number;
  tileIndex: number;
  tile?: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}

/** Concealed tiles occupy the left part; whole melds grow left from a fixed right edge. */
export function seatLayout(hand: readonly Pick<HandTile, 'drawn'>[], melds: readonly MeldView[], human: boolean, largeHand = false, hideConcealedKongs = false) {
  const count = melds.reduce((total, meld) => total + meld.tiles.length, 0);
  const handScale = human ? largeHand ? 1.06 : 1.2 : 1;
  const handSpacing = human ? largeHand ? .61 : .695 : .575;
  const tileGap = .035, groupGap = .15, handGap = count ? .24 : 0;
  const gapSpace = count ? (count - melds.length) * tileGap + (melds.length - 1) * groupGap : 0;
  // Reserve the drawn-tile slot, so melds do not shift or resize on every draw/discard.
  const capacity = Math.max(1, (largeHand ? 17 : 14) - melds.length * 3);
  const handReserve = (capacity - 1) * handSpacing + .55 * handScale + (human ? .23 : 0);
  const scale = count ? Math.min(.86, (SEAT_ROW_HALF_WIDTH * 2 - handReserve - handGap - gapSpace) / (count * .55)) : .86;
  const tileWidth = .55 * scale;
  const meldWidth = count * tileWidth + gapSpace;
  const handCenter = -(meldWidth + handGap) / 2 - (human ? .115 : 0);
  const handSlots = hand.map((tile, index) => ({ scale: handScale,
    position: [(index - (hand.length - 1) / 2) * handSpacing + (human && tile.drawn ? .23 : 0) + handCenter, 0, 0] as [number, number, number] }));
  let right = SEAT_ROW_HALF_WIDTH;
  const meldTiles: MeldTileLayout[] = melds.flatMap((meld, meldIndex) => {
    if (meldIndex) right -= groupGap;
    return meld.tiles.map<MeldTileLayout>((tile, tileIndex) => {
      if (tileIndex) right -= tileGap;
      const x = right - tileWidth / 2; right -= tileWidth;
      const faceDown = meld.concealed && (hideConcealedKongs || tileIndex === 0 || tileIndex === 3);
      return { key: `${meld.id}-${tileIndex}`, meldIndex, tileIndex, tile: faceDown ? undefined : tile,
        position: [x, 0, HAND_ROW_Z], rotation: [faceDown ? Math.PI / 2 : -Math.PI / 2, 0, 0], scale };
    });
  });
  return { hand: handSlots, melds: meldTiles };
}

export const bonusPosition = (index: number): [number, number, number] => [-3.64 + (index % 2) * .39, .23, 1.88 + Math.floor(index / 2) * .54];
