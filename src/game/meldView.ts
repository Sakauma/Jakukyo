import type { MeldView } from './types';

/** Display indices only: calledIndex, replay data and scoring evidence always
 * refer to the original array, even when the called tile is a red five. */
export function meldReadingOrder(meld:MeldView):number[] {
  const ids=meld.tiles.map((_,i)=>i);
  const rank=(i:number)=>Number(meld.tiles[i][1]) || 5;
  return meld.type==='chi' ? ids.sort((a,b)=>rank(a)-rank(b) || a-b) : ids;
}

/** Decode public riichi notation, including which exact (possibly red) tile
 * carried the direction mark. The original order remains the engine's order. */
export function meldView(meld: string, id: string, seat?: number, playerIds?: readonly number[]): MeldView {
  const tiles = (meld.match(/\d/g) ?? []).map(n => meld[0] + n);
  const mark = meld.search(/[+=-]/);
  const type = tiles.length === 4 ? 'kan' : new Set(tiles.map(t => t.replace('0','5'))).size === 1 ? 'pon' : 'chi';
  if (mark < 0) return { id, tiles, type, concealed:true };
  const relative = '_+=-'.indexOf(meld[mark]);
  return { id, tiles, type, concealed:false, calledIndex:mark-2,
    ...(seat != null && playerIds?.length === 4 ? { from:playerIds[(seat+relative)%4] } : {}) };
}
