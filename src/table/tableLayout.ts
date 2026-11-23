import type { HandTile, MeldView } from '../game/types';
import { meldReadingOrder } from '../game/meldView';
import { continuousClaimPreview } from '../presentation/tableTimeline';

export const HAND_ROW_Z = 5.80;
export const SEAT_ROW_HALF_WIDTH = 5.35;
const FACE_WIDTH=.55, FACE_LENGTH=.77;
export interface ClassicSeat { seat:number; playerCount:number }

interface MeldTileLayout {
  key: string;
  meldIndex: number;
  tileIndex: number;
  tile?: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  stackHeight?: number;
}

interface Column { index:number; sideways:boolean; extra?:number }
// Return columns from the anchored right edge. Keys and tileIndex stay in
// engine order, even when a middle tile of a sequence is displayed on the left.
function meldColumns(meld:MeldView, seat?:ClassicSeat):Column[] {
  const ids=meld.tiles.map((_,i)=>i), take=meld.calledIndex, from=meld.from;
  // This layout consumes columns right to left. Read the sequence in rank
  // order from the caller's left, in both styles and even in older replays.
  if (meld.type==='chi' && !(continuousClaimPreview && seat))
    return meldReadingOrder(meld).reverse().map(index=>({index,sideways:false}));
  if (!seat) {
    // Keep the pixel triplet's original column order. The fourth slides on
    // its support rather than creating a fourth column beside the three.
    if (!meld.concealed && meld.type==='kan' && ids.length===4 && take!=null && Number.isInteger(take) && take>=0 && take<3)
      return ids.slice(0,3).map(index=>({index,sideways:false,...(index===take ? {extra:3} : {})}));
    return ids.map(index=>({index,sideways:false}));
  }
  if (meld.concealed || take==null || !Number.isInteger(take) || take<0 || take>=ids.length ||
      from==null || !Number.isInteger(from) || from<0 || from>=seat.playerCount || from===seat.seat)
    return ids.map(index=>({index,sideways:false})); // A record without a known source.
  const relative=(from-seat.seat+seat.playerCount)%seat.playerCount;
  const addedKan=meld.type==='kan' && ids.length===4 && take<3;
  const own=ids.filter(i=>i!==take && !(addedKan && i===3));
  // Left: previous player (all chi); centre: opposite; right: next player.
  // Three-player play has no opposite source in turn order.
  const slot=meld.type==='chi' || relative===seat.playerCount-1 ? 0 : relative===1 ? own.length : 1;
  const columns:Column[]=own.map(index=>({index,sideways:false}));
  // In the game the giver determines the slot, not a 90° turn. Keeping the
  // old orientation only in the separate A/B build makes that study reproducible.
  columns.splice(slot,0,{index:take,sideways:continuousClaimPreview,...(addedKan ? {extra:3} : {})});
  return columns.reverse();
}

/** Concealed tiles occupy the left part; whole melds grow left from a fixed right edge. */
export function seatLayout(hand: readonly Pick<HandTile, 'drawn'>[], melds: readonly MeldView[], human: boolean, largeHand = false, hideConcealedKongs = false, classic?:ClassicSeat) {
  const groups=melds.map(m=>meldColumns(m,classic)), count=groups.reduce((n,g)=>n+g.length,0);
  const handScale = human ? largeHand ? 1.06 : 1.2 : 1;
  const handSpacing = human ? largeHand ? .61 : .695 : .575;
  const tileGap = classic ? .024 : .035, groupGap = classic ? .18 : .15, handGap = count ? (classic ? .30 : .24) : 0;
  const gapSpace = count ? (count - melds.length) * tileGap + (melds.length - 1) * groupGap : 0;
  // Reserve the drawn-tile slot, so melds do not shift or resize on every draw/discard.
  const capacity = Math.max(1, (largeHand ? 17 : 14) - melds.length * 3);
  const handReserve = (capacity - 1) * handSpacing + .55 * handScale + (human ? .23 : 0);
  const units=groups.reduce((n,g)=>g.reduce((sum,col)=>sum+(col.sideways ? FACE_LENGTH : FACE_WIDTH),n),0);
  const maxScale=classic ? .96 : .86;
  const scale = count ? Math.min(maxScale, (SEAT_ROW_HALF_WIDTH * 2 - handReserve - handGap - gapSpace) / units) : maxScale;
  const meldWidth = units * scale + gapSpace;
  const handCenter = -(meldWidth + handGap) / 2 - (human ? .115 : 0);
  const handSlots = hand.map((tile, index) => ({ scale: handScale,
    position: [(index - (hand.length - 1) / 2) * handSpacing + (human && tile.drawn ? .23 : 0) + handCenter, 0, 0] as [number, number, number] }));
  let right = SEAT_ROW_HALF_WIDTH;
  const meldTiles: MeldTileLayout[] = melds.flatMap((meld, meldIndex) => {
    if (meldIndex) right -= groupGap;
    const slots:MeldTileLayout[]=[];
    groups[meldIndex].forEach((col,i)=>{
      if(i) right-=tileGap;
      const width=(col.sideways ? FACE_LENGTH : FACE_WIDTH)*scale, x=right-width/2;
      right-=width;
      // Square the player-facing edges, not the centres of unequal rectangles.
      const z=HAND_ROW_Z+(col.sideways ? (FACE_LENGTH-FACE_WIDTH)*scale/2 : 0);
      const place=(tileIndex:number,depth:number,stackHeight?:number)=>{
        const faceDown=meld.concealed && (hideConcealedKongs || tileIndex===0 || tileIndex===3);
        slots[tileIndex]={key:`${meld.id}-${tileIndex}`,meldIndex,tileIndex,tile:faceDown ? undefined : meld.tiles[tileIndex],
          position:[x,0,depth],rotation:[faceDown ? Math.PI/2 : -Math.PI/2,0,col.sideways ? Math.PI/2 : 0],scale,
          ...(stackHeight ? {stackHeight} : {})};
      };
      place(col.index,z);
      // Lay the fourth on the original called tile, one rigid tile thick.
      // A small setback exposes both edges, without protruding into a live wall.
      if(col.extra!=null) place(col.extra,z-.14*scale,.395*scale);
    });
    return slots;
  });
  return { hand: handSlots, melds: meldTiles };
}

export const bonusPosition = (index: number): [number, number, number] => [-3.64 + (index % 2) * .39, .23, 1.88 + Math.floor(index / 2) * .54];

/** One shared seat-local offset for the whole closed quad, or just the
 * fourth tile of an upgrade. Never send four pieces through the standing
 * hand, or through an already exposed set. No concealed codes are needed. */
export function rackSlideOffset(layout:ReturnType<typeof seatLayout>, moving:readonly MeldTileLayout[]) {
  if (!moving.length) return 0;
  const scale=moving[0].scale;
  if (moving.length===1 && moving[0].stackHeight) return -.38*scale; // always overlaps the support below
  const half=(s:MeldTileLayout)=>(s.rotation[2] ? FACE_LENGTH : FACE_WIDTH)*s.scale/2;
  const left=Math.min(...moving.map(s=>s.position[0]-half(s))), right=Math.max(...moving.map(s=>s.position[0]+half(s)));
  // Stay inside the flat tabletop even if the incoming snapshot is very dense.
  let before=-SEAT_ROW_HALF_WIDTH-.68, after=SEAT_ROW_HALF_WIDTH+.68;
  for(const h of layout.hand) before=Math.max(before,h.position[0]+FACE_WIDTH*h.scale/2+.035);
  for(const s of layout.melds) {
    if(moving.includes(s)) continue;
    if(s.position[0]<=left) before=Math.max(before,s.position[0]+half(s)+.025);
    if(s.position[0]>=right) after=Math.min(after,s.position[0]-half(s)-.025);
  }
  const run=.92*scale, fromRack=Math.max(0,Math.min(run,left-before));
  const fromEnd=Math.max(0,Math.min(run,after-right));
  // Prefer the hand side; use the free outside edge only if the rack is tight.
  return fromRack>=.5*scale || fromRack>=fromEnd ? -fromRack : fromEnd;
}
