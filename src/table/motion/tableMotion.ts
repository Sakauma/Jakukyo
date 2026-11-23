import type { GameSnapshot, HandTile } from '../../game/types';
import { continuousClaimPreview, cueTravel, isMeldCall, motionDuration, needsTableBaseline, tableMotionCues, tableScope } from '../../presentation/tableTimeline';
import type { MeldCall, MotionStyle } from '../../presentation/tableTimeline';
import type { PhysicalMove, Origin } from './classicGestures';
import { classicBlockers, meldEntryOffset } from './classicClearance';
import { riverLayout } from '../riverLayout';
import { tableSeat } from '../themes';
import { tileRestHeight } from '../tableMaterials';
import { riichiStickLayout } from '../riichiStick';
import { HAND_ROW_Z, rackSlideOffset, seatLayout } from '../tableLayout';
import { fieldSeatOffset, visibleWallCount, wallTileInSeat, wallTileTransform } from '../wallLayout';
import { riverSelectionScope } from '../../presentation/riverMatches';
import type { DiscardIntent } from '../../presentation/handInteraction';
import { createPlacementSeed, tilePlacement } from '../tilePlacement';

export type Vec3 = [number, number, number];
export interface ClaimPose { position: Vec3; rotation: Vec3; scale: number }
type ReadRiverPose = (piece: string, receivingSeat: number) => ClaimPose | undefined;
export interface TileMotion {
  id: string;
  kind: PhysicalMove;
  origin?: Origin;
  from: Vec3;
  rotation: Vec3;
  scale: number;
  started: number;
  duration: number;
  arc: number;
  cancelled?: boolean;
}
interface HandSlot {
  key: string;
  tile: HandTile;
  position: Vec3;
  scale: number;
}
export interface MeldImpact {
  id: string; kind: MeldCall; seat: number; meldIndex: number;
  contactAt: number; life: number; cancelled: boolean;
}
// The afterimage can outlive the move; it never holds the engine or the next input.
const impactLife: Record<MeldCall,number> = {chi:220,pon:262,kan:348};
export interface TableMotionFrame {
  identity: number;
  placementSeed: number;
  hand: HandSlot[];
  motions: Map<string, TileMotion>;
  impacts: Map<number, MeldImpact>;
  latestDiscard: { seat: number; sourceIndex: number } | null;
}
export const riverMotionKey = (seat: number, index: number) => `river:${seat}:${index}`;
export const meldMotionKey = (seat: number, index: number, tile: number) => `meld:${seat}:${index}:${tile}`;
export const opponentMotionKey = (seat: number, tile: number) => `opponent:${seat}:${tile}`;
export const stickMotionKey = (seat: number) => `stick:${seat}`;
export const bonusMotionKey = (seat: number, tile: number) => `bonus:${seat}:${tile}`;
export const wallMotionKey = (index:number) => `wall:${index}`;

const rotate = (point: Vec3, angle: number): Vec3 => [Math.cos(angle) * point[0] + Math.sin(angle) * point[2], point[1], -Math.sin(angle) * point[0] + Math.cos(angle) * point[2]];

/** The visually removed wall tile; this uses only the public wall count. */
function wallOrigin(before: GameSnapshot, seat: number, extraX:number, rear:number): { position: Vec3; rotation: Vec3; scale: number } {
  const reserve = !before.mode || ['riichi', 'sanma'].includes(before.mode) ? 14 : 0;
  const index = Math.max(0, visibleWallCount(before.round.tilesLeft, reserve) - 1);
  const side=tableSeat(seat,before.players.length);
  const wall=wallTileTransform(index,before.round.doraIndicators,extraX,rear), offset=fieldSeatOffset(side,extraX,rear);
  wall.position[0]-=offset[0]; wall.position[2]-=offset[2];
  return wallTileInSeat(wall,side*Math.PI/2);
}

/**
 * Persistent display identities follow exact tile codes, not regenerated engine IDs.
 * HandTile objects remain the current engine objects so every click dispatches the
 * current legal ID. Identical copies are interchangeable only in visual identity.
 */
export function createTableMotionController() {
  let previous: GameSnapshot | null = null, hand: HandSlot[] = [], selected: string | null = null;
  let identity = 0, nextKey = 0, wasLobby = true, needsBaseline = false;
  let placementSeed = createPlacementSeed(), previousSession: object | null | undefined;
  let previousStyle: MotionStyle | undefined;
  let motions = new Map<string, TileMotion>();
  let seenIntent = -1;
  let pendingDiscard: { slot: HandSlot; from?: Vec3; rotation?: Vec3 } | null = null;
  let releasedOrigin: { tileId: string; selectionScope: string; from: Vec3; rotation: Vec3 } | null = null;
  let latestDiscard: TableMotionFrame['latestDiscard'] = null;
  const impacts = new Map<number,MeldImpact>(); // Only the latest declaration at each seat.
  const clearImpacts = () => { for (const impact of impacts.values()) impact.cancelled=true; impacts.clear(); };
  const cancel = () => { for (const motion of motions.values()) motion.cancelled = true; motions.clear(); clearImpacts(); needsBaseline = true; };

  return {
    cancel,
    captureReleaseOrigin(tileId: string, selectionScope: string, from: Vec3, rotation: Vec3) { releasedOrigin = { tileId, selectionScope, from: [...from], rotation: [...rotation] }; },
    clearReleaseOrigin() { releasedOrigin = null; },
    update(snapshot: GameSnapshot | null, incoming: HandTile[], selectedId: string | null, reduced: boolean, discardIntent?: DiscardIntent | null, sessionIdentity?: object | null, extraX=0, rear=0, style: MotionStyle='classic', readRiverPose?: ReadRiverPose, showCalls=true): TableMotionFrame {
      const now = performance.now(), hidden = typeof document !== 'undefined' && document.hidden;
      const backwards = !!snapshot && !!previous && (snapshot.revision < previous.revision || (snapshot.log.at(-1)?.id ?? 0) < (previous.log.at(-1)?.id ?? 0));
      const newHand = previousSession !== sessionIdentity || !!snapshot && (wasLobby || !!previous && (tableScope(previous) !== tableScope(snapshot)
        || snapshot.status === 'playing' && (snapshot.round.honba !== previous.round.honba
          || !backwards && (previous.status !== 'playing' || snapshot.round.tilesLeft > previous.round.tilesLeft + 10)))) || !snapshot && !wasLobby;
      const baseline = newHand || previousStyle!==style || !!snapshot && (needsBaseline || needsTableBaseline(previous, snapshot));
      previousStyle=style;
      if (baseline) {
        cancel();
        if (newHand) { hand = []; placementSeed = createPlacementSeed(); }
        pendingDiscard = null; releasedOrigin = null; latestDiscard = null; identity++;
      }
      const before = previous;
      const cues = snapshot && before && !baseline && !hidden ? tableMotionCues(before, snapshot).filter(cue => !cue.flowerSupplement) : [];
      // A quick call may interrupt a draw, sort, or even the pon that is now
      // being extended. Never carry that old pose over to the registered set.
      const calls=cues.filter(c=>isMeldCall(c.kind));
      for (const c of calls) {
        const rack=c.seat===0 ? 'hand:' : `opponent:${c.seat}:`, group=`meld:${c.seat}:${c.meldIndex}:`;
        for (const [key,m] of motions) if(key.startsWith(rack) || key.startsWith(group)) { m.cancelled=true; motions.delete(key); }
      }
      if (discardIntent && discardIntent.sequence !== seenIntent) {
        seenIntent = discardIntent.sequence;
        pendingDiscard = null;
        const slot = before && riverSelectionScope(before) === discardIntent.selectionScope ? hand.find(item => item.tile.id === discardIntent.tileId) : undefined;
        if (slot) {
          const release = releasedOrigin?.tileId === discardIntent.tileId && releasedOrigin.selectionScope === discardIntent.selectionScope ? releasedOrigin : null;
          pendingDiscard = { slot: { ...slot, position: [...slot.position], tile: { ...slot.tile } }, ...(release ? { from: release.from, rotation: release.rotation } : {}) };
        }
        releasedOrigin = null;
      }
      if (snapshot?.lastDiscard !== undefined) {
        latestDiscard = snapshot.lastDiscard ? { seat: snapshot.lastDiscard.playerId, sourceIndex: snapshot.lastDiscard.riverIndex } : null;
      } else {
        const discards = cues.filter(cue => cue.kind === 'discard');
        if (discards.length === 1) latestDiscard = { seat: discards[0].seat, sourceIndex: discards[0].riverIndex! };
        else if (discards.length > 1) latestDiscard = null;
      }
      if (latestDiscard) {
        const marked = snapshot?.players.find(player => player.id === latestDiscard!.seat)?.discards[latestDiscard.sourceIndex];
        if (!marked || marked.called) latestDiscard = null;
      }
      if (hidden || reduced) for (const motion of motions.values()) motion.cancelled = true;
      for (const [key, motion] of motions) if (motion.cancelled || now - motion.started >= motion.duration) motions.delete(key);
      if (!showCalls || hidden || reduced || snapshot?.status !== 'playing' || !snapshot.speed) clearImpacts();
      for (const [seat, impact] of impacts) if (now >= impact.contactAt+impact.life) impacts.delete(seat);

      const oldHand = [...hand];
      const humanDiscard = cues.find(cue => cue.seat === 0 && cue.kind === 'discard');
      let discarded: HandSlot | undefined;
      if (humanDiscard && snapshot) {
        const discard = snapshot.players[0]?.discards[humanDiscard.riverIndex!];
        discarded = pendingDiscard && pendingDiscard.slot.tile.tile === discard?.tile ? pendingDiscard.slot : oldHand.find(slot => slot.tile.id === selected && slot.tile.tile === discard?.tile)
          ?? oldHand.find(slot => slot.tile.tile === discard?.tile && slot.tile.drawn === !!discard?.tsumogiri)
          ?? oldHand.find(slot => slot.tile.tile === discard?.tile);
      }
      const available = oldHand.filter(slot => slot.key !== discarded?.key);
      const matched = new Map<number, HandSlot>();
      // Match real held slots before considering a formerly separate drawn tile.
      incoming.forEach((tile, index) => {
        const at = available.findIndex(slot => slot.tile.id === tile.id && slot.tile.tile === tile.tile && slot.tile.drawn === tile.drawn);
        if (at >= 0) matched.set(index, available.splice(at, 1)[0]);
      });
      incoming.forEach((tile, index) => {
        if (matched.has(index)) return;
        const at = available.findIndex(slot => slot.tile.tile === tile.tile);
        if (at >= 0) matched.set(index, available.splice(at, 1)[0]);
      });
      const classicSeat=(seat:number)=>style==='classic' ? {seat,playerCount:snapshot?.players.length ?? 4} : undefined;
      const ownLayout = seatLayout(incoming, snapshot?.players[0]?.melds ?? [], true, (snapshot?.handSize ?? (incoming.length > 14 ? 16 : 13)) > 14,false,classicSeat(0));
      const scale = ownLayout.hand[0]?.scale ?? 1.2;
      const ownDraw = cues.find(cue => cue.seat === 0 && cue.kind === 'draw');
      // Only lift the lead insertion. Ordinary recentring or a renamed engine
      // ID is not a sort. Other tiles slide to open the gap, retaining identity.
      let insertIndex=-1;
      if (style==='classic' && !baseline && !hidden && !reduced && snapshot?.status==='playing' && snapshot.speed>0 && !calls.some(c=>c.seat===0)) {
        let best=0;
        for (const [index,old] of matched) {
          if (incoming[index].drawn) continue;
          const delta=Math.abs(ownLayout.hand[index].position[0]-old.position[0]);
          const manual=!cues.length && incoming.length===oldHand.length && matched.size===incoming.length;
          if (delta>scale*.55 && (old.tile.drawn || manual) && delta>best) { best=delta; insertIndex=index; }
        }
      }
      hand = incoming.map((tile, index) => {
        const old = matched.get(index), key = old?.key ?? `hand:${identity}:${++nextKey}`;
        const position = ownLayout.hand[index].position;
        if (!old && ownDraw && before && snapshot && !reduced) {
          const origin = wallOrigin(before, 0, extraX, rear); origin.position[2] -= HAND_ROW_Z;
          const duration=motionDuration('draw',snapshot.speed,false,style);
          if(duration>0) motions.set(key, { id: ownDraw.key, kind:'draw', from: origin.position, rotation: origin.rotation, scale: origin.scale, started: now, duration, arc: .5 });
        } else if (old && index===insertIndex && snapshot) {
          const duration=Math.min(168,snapshot.speed*.70), rotation:Vec3=[-.31,0,0];
          motions.set(key,{id:`insert:${key}:${now}`,kind:'insert',from:[old.position[0],tileRestHeight(rotation,old.scale),old.position[2]],
            rotation,scale:old.scale,started:now,duration,arc:0});
        }
        return { key, tile, position, scale };
      });

      if (snapshot && before && !reduced && snapshot.speed>0 && Number.isFinite(snapshot.speed)) for (const cue of cues) {
        const player = snapshot.players.find(item => item.id === cue.seat)!;
        const old = before.players.find(item => item.id === cue.seat)!;
        const oldRack = () => cue.seat === 0 ? oldHand : seatLayout(Array.from({ length: old.concealedCount }, () => ({ drawn: false })), old.melds, false, (before.handSize ?? 13) > 14,false,classicSeat(cue.seat)).hand;
        const duration = cueTravel(cue, snapshot.speed,false,style);
        const put = (key: string, from: Vec3, rotation: Vec3, fromScale: number, arc:number, origin: Origin='held') => {
          motions.set(key, { id: cue.key + key, kind:cue.kind, from, rotation, scale: fromScale, started: now, duration, arc,origin });
        };
        if (cue.kind === 'discard') {
          const own = cue.seat === 0;
          const discard = player.discards[cue.riverIndex!];
          const oldSlots=oldRack();
          const fromSlot = own && discarded ? discarded : oldSlots[discard?.tsumogiri ? oldSlots.length - 1 : Math.floor(oldSlots.length / 2)];
          const x = fromSlot?.position[0] ?? 0;
          const committed = own && pendingDiscard?.slot.key === discarded?.key ? pendingDiscard : null;
          const rotation: Vec3 = committed?.rotation ?? (own ? [-.31, 0, 0] : [-.09, 0, Math.PI]);
          const fromScale = fromSlot?.scale ?? (own ? scale : 1);
          const from = committed?.from ?? [x, tileRestHeight(rotation, fromScale) + (own ? .16 : .05), HAND_ROW_Z] as Vec3;
          put(riverMotionKey(cue.seat, cue.riverIndex!), from, rotation, fromScale, .28, committed?.from?'released':'held');
        } else if (cue.kind === 'draw' && cue.seat !== 0) {
          const origin = wallOrigin(before, cue.seat, extraX, rear);
          put(opponentMotionKey(cue.seat, player.concealedCount - 1), origin.position, origin.rotation, origin.scale, .48);
        } else if (cue.meldIndex != null) {
          if (showCalls && snapshot.status==='playing' && isMeldCall(cue.kind)) {
            const oldImpact=impacts.get(cue.seat); if (oldImpact) oldImpact.cancelled=true;
            impacts.set(cue.seat,{id:`${identity}:${snapshot.revision}:${cue.seat}:${cue.meldIndex}`,kind:cue.kind,
              seat:cue.seat,meldIndex:cue.meldIndex,contactAt:now+duration,life:impactLife[cue.kind],cancelled:false});
          }
          const take=cue.source;
          if (!take && !cue.kanEntry) continue; // ambiguous historical change, never guess an origin
          const layout=cue.seat===0 ? ownLayout : seatLayout(Array.from({length:player.concealedCount},()=>({drawn:false})),player.melds,false,
            (snapshot.handSize??13)>14,!!snapshot.hideOpponentConcealedKongs && cue.seat!==snapshot.humanId,classicSeat(cue.seat));
          const group=layout.melds.filter(t=>t.meldIndex===cue.meldIndex);
          const slide=(slot:(typeof group)[number],dx:number,dz:number)=>put(meldMotionKey(cue.seat,slot.meldIndex,slot.tileIndex),
            [slot.position[0]+dx,tileRestHeight(slot.rotation,slot.scale)+(slot.stackHeight??0),slot.position[2]+dz],
            slot.rotation,slot.scale,0,'meld-edge');
          if (cue.kanEntry) {
            // Start flat. A closed quad keeps its spacing and both face-down
            // ends throughout; on an upgrade only the fourth slides on top.
            const moving=cue.kanEntry==='concealed' ? group : group.filter(s=>s.tileIndex===3);
            const dx=rackSlideOffset(layout,moving);
            for(const slot of moving) slide(slot,dx,0);
            continue;
          }
          if (!take) continue;
          const key=meldMotionKey(cue.seat,cue.meldIndex,take.tileIndex);
          const riverKey=riverMotionKey(take.seat,take.riverIndex);
          const previousDiscard=motions.get(riverKey);
          if(previousDiscard) { previousDiscard.cancelled=true; motions.delete(riverKey); }

          // The opt-in historical A/B study alone follows the old river mesh.
          if (continuousClaimPreview && style==='classic' && (cue.kind==='chi' || cue.kind==='pon')) {
            let pickup=readRiverPose?.(riverKey,cue.seat);
            if (!pickup) {
              const source=before.players.find(p=>p.id===take.seat);
              const discard=source && riverLayout(source.discards).items.find(t=>t.sourceIndex===take.riverIndex);
              if(!discard) continue;
              const n=snapshot.players.length, a=tableSeat(take.seat,n), b=tableSeat(cue.seat,n);
              const yaw=(a-b)*Math.PI/2, j=tilePlacement(placementSeed,riverKey,'river');
              const p=rotate([discard.position[0]+j.x,tileRestHeight(discard.rotation,discard.scale),discard.position[2]+j.z],yaw);
              const u=fieldSeatOffset(a,extraX,rear), v=fieldSeatOffset(b,extraX,rear);
              const offset=rotate([u[0]-v[0],0,u[2]-v[2]],-b*Math.PI/2);
              pickup={position:[p[0]+offset[0],p[1],p[2]+offset[2]],rotation:[-Math.PI/2,0,discard.rotation[2]+yaw+j.yaw],scale:discard.scale};
            }
            put(key,pickup.position,pickup.rotation,pickup.scale,0,'river-claim');
            continue;
          }

          // On an open call, keep the companions planted and slide only the
          // actual claimed discard. No rotation or lift along its entry lane.
          const slot=group.find(t=>t.tileIndex===take.tileIndex);
          if (!slot) continue;
          let dz=-.40*slot.scale;
          if(style==='classic') {
            const reserve=!snapshot.mode || ['riichi','sanma'].includes(snapshot.mode) ? 14 : 0;
            dz=meldEntryOffset(classicBlockers(visibleWallCount(snapshot.round.tilesLeft,reserve)),slot.position[0],slot.position[2],slot.scale,
              slot.rotation[2],tableSeat(cue.seat,snapshot.players.length),(cue.kind==='chi' ? .52 : .40)*slot.scale);
          }
          slide(slot,0,dz);
        } else if (cue.kind === 'riichi') {
          put(stickMotionKey(cue.seat), [...riichiStickLayout.from], [0, -.25, 0], 1, .07);
        } else if (cue.kind === 'kita') {
          const index = (player.flowers?.length ?? 0) + (player.kita ?? 1) - 1;
          const oldSlot = cue.seat === 0 ? oldHand.find(slot => slot.tile.tile === 'z4') : oldRack().at(-1);
          put(bonusMotionKey(cue.seat, index), [oldSlot?.position[0] ?? 0, .65, HAND_ROW_Z], cue.seat === 0 ? [-.31, 0, 0] : [-.09, 0, Math.PI], oldSlot?.scale ?? 1, .32);
        }
      }

      // A kan can expose its indicator on a later snapshot. Follow the actual
      // public wall change, never a predicted kan outcome or a concealed code.
      if (style==='classic' && !reduced && !hidden && !baseline && before && snapshot?.status==='playing'
          && snapshot.speed>0 && snapshot.revision>before.revision && (!snapshot.mode || ['riichi','sanma'].includes(snapshot.mode))) {
        const old=before.round.doraIndicators, next=snapshot.round.doraIndicators;
        if(next.length>old.length && old.every((tile,i)=>next[i]===tile)) for(let i=old.length;i<next.length;i++) {
          const index=i*2+1;
          if(index>=visibleWallCount(snapshot.round.tilesLeft,14)) continue;
          const wall=wallTileTransform(index,old,extraX,rear), duration=Math.min(176,snapshot.speed*.8);
          motions.set(wallMotionKey(index),{id:`indicator:${identity}:${i}`,kind:'indicator',from:wall.position,rotation:wall.rotation,
            scale:wall.scale,started:now,duration,arc:0});
        }
      }

      if (humanDiscard) pendingDiscard = null;
      previous = snapshot; previousSession = sessionIdentity; selected = selectedId; wasLobby = !snapshot; needsBaseline = hidden;
      return { identity, placementSeed, hand, motions, impacts, latestDiscard };
    },
  };
}
