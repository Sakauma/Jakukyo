import type { GameSnapshot, HandTile } from '../../game/types';
import { motionDuration, needsTableBaseline, tableMotionCues, tableScope, tileArrivalTime } from '../../presentation/tableTimeline';
import { riverLayout } from '../riverLayout';
import { tableSeat } from '../themes';
import { tileRestHeight } from '../tableMaterials';
import { riichiStickLayout } from '../riichiStick';
import { HAND_ROW_Z, seatLayout } from '../tableLayout';
import { visibleWallCount, wallTileInSeat, wallTileTransform } from '../wallLayout';
import { riverSelectionScope } from '../../presentation/riverMatches';
import type { DiscardIntent } from '../../presentation/handInteraction';
import { createPlacementSeed } from '../tilePlacement';

export type Vec3 = [number, number, number];
export interface TileMotion {
  id: string;
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
export interface TableMotionFrame {
  identity: number;
  placementSeed: number;
  hand: HandSlot[];
  motions: Map<string, TileMotion>;
  latestDiscard: { seat: number; sourceIndex: number } | null;
}
export const riverMotionKey = (seat: number, index: number) => `river:${seat}:${index}`;
export const meldMotionKey = (seat: number, index: number, tile: number) => `meld:${seat}:${index}:${tile}`;
export const opponentMotionKey = (seat: number, tile: number) => `opponent:${seat}:${tile}`;
export const stickMotionKey = (seat: number) => `stick:${seat}`;
export const bonusMotionKey = (seat: number, tile: number) => `bonus:${seat}:${tile}`;

const rotate = (point: Vec3, angle: number): Vec3 => [Math.cos(angle) * point[0] + Math.sin(angle) * point[2], point[1], -Math.sin(angle) * point[0] + Math.cos(angle) * point[2]];

/** The visually removed wall tile; this uses only the public wall count. */
function wallOrigin(before: GameSnapshot, seat: number): { position: Vec3; rotation: Vec3; scale: number } {
  const reserve = !before.mode || ['riichi', 'sanma'].includes(before.mode) ? 14 : 0;
  const index = Math.max(0, visibleWallCount(before.round.tilesLeft, reserve) - 1);
  return wallTileInSeat(wallTileTransform(index, before.round.doraIndicators), tableSeat(seat, before.players.length) * Math.PI / 2);
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
  let motions = new Map<string, TileMotion>();
  let seenIntent = -1;
  let pendingDiscard: { slot: HandSlot; from?: Vec3; rotation?: Vec3 } | null = null;
  let releasedOrigin: { tileId: string; selectionScope: string; from: Vec3; rotation: Vec3 } | null = null;
  let latestDiscard: TableMotionFrame['latestDiscard'] = null;
  const cancel = () => { for (const motion of motions.values()) motion.cancelled = true; motions.clear(); needsBaseline = true; };

  return {
    cancel,
    captureReleaseOrigin(tileId: string, selectionScope: string, from: Vec3, rotation: Vec3) { releasedOrigin = { tileId, selectionScope, from: [...from], rotation: [...rotation] }; },
    clearReleaseOrigin() { releasedOrigin = null; },
    update(snapshot: GameSnapshot | null, incoming: HandTile[], selectedId: string | null, reduced: boolean, discardIntent?: DiscardIntent | null, sessionIdentity?: object | null): TableMotionFrame {
      const now = performance.now(), hidden = typeof document !== 'undefined' && document.hidden;
      const backwards = !!snapshot && !!previous && (snapshot.revision < previous.revision || (snapshot.log.at(-1)?.id ?? 0) < (previous.log.at(-1)?.id ?? 0));
      const newHand = previousSession !== sessionIdentity || !!snapshot && (wasLobby || !!previous && (tableScope(previous) !== tableScope(snapshot)
        || snapshot.status === 'playing' && (snapshot.round.honba !== previous.round.honba
          || !backwards && (previous.status !== 'playing' || snapshot.round.tilesLeft > previous.round.tilesLeft + 10)))) || !snapshot && !wasLobby;
      const baseline = newHand || !!snapshot && (needsBaseline || needsTableBaseline(previous, snapshot));
      if (baseline) {
        cancel();
        if (newHand) { hand = []; placementSeed = createPlacementSeed(); }
        pendingDiscard = null; releasedOrigin = null; latestDiscard = null; identity++;
      }
      const before = previous;
      const cues = snapshot && before && !baseline && !hidden ? tableMotionCues(before, snapshot).filter(cue => !cue.flowerSupplement) : [];
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
      const ownLayout = seatLayout(incoming, snapshot?.players[0]?.melds ?? [], true, (snapshot?.handSize ?? (incoming.length > 14 ? 16 : 13)) > 14);
      const scale = ownLayout.hand[0]?.scale ?? 1.2;
      const ownDraw = cues.find(cue => cue.seat === 0 && cue.kind === 'draw');
      hand = incoming.map((tile, index) => {
        const old = matched.get(index), key = old?.key ?? `hand:${identity}:${++nextKey}`;
        const position = ownLayout.hand[index].position;
        if (!old && ownDraw && before && snapshot && !reduced) {
          const origin = wallOrigin(before, 0); origin.position[2] -= HAND_ROW_Z;
          motions.set(key, { id: ownDraw.key, from: origin.position, rotation: origin.rotation, scale: origin.scale, started: now, duration: motionDuration('draw', snapshot.speed), arc: .5 });
        }
        return { key, tile, position, scale };
      });

      if (snapshot && before && !reduced) for (const cue of cues) {
        const player = snapshot.players.find(item => item.id === cue.seat)!;
        const old = before.players.find(item => item.id === cue.seat)!;
        const oldSlots = cue.seat === 0 ? oldHand : seatLayout(Array.from({ length: old.concealedCount }, () => ({ drawn: false })), old.melds, false, (before.handSize ?? 13) > 14).hand;
        const duration = motionDuration(cue.kind, snapshot.speed);
        if (duration <= 0) continue;
        const put = (key: string, from: Vec3, rotation: Vec3, fromScale: number, time = duration, arc = .22) => {
          motions.set(key, { id: cue.key + key, from, rotation, scale: fromScale, started: now, duration: time, arc });
        };
        if (cue.kind === 'discard') {
          const own = cue.seat === 0;
          const discard = player.discards[cue.riverIndex!];
          const fromSlot = own && discarded ? discarded : oldSlots[discard?.tsumogiri ? oldSlots.length - 1 : Math.floor(oldSlots.length / 2)];
          const x = fromSlot?.position[0] ?? 0;
          const committed = own && pendingDiscard?.slot.key === discarded?.key ? pendingDiscard : null;
          const rotation: Vec3 = committed?.rotation ?? (own ? [-.31, 0, 0] : [-.09, 0, Math.PI]);
          const fromScale = fromSlot?.scale ?? (own ? scale : 1);
          const from = committed?.from ?? [x, tileRestHeight(rotation, fromScale) + (own ? .16 : .05), HAND_ROW_Z] as Vec3;
          put(riverMotionKey(cue.seat, cue.riverIndex!), from, rotation, fromScale, duration, .28);
        } else if (cue.kind === 'draw' && cue.seat !== 0) {
          const origin = wallOrigin(before, cue.seat);
          put(opponentMotionKey(cue.seat, player.concealedCount - 1), origin.position, origin.rotation, origin.scale, duration, .48);
        } else if (cue.meldIndex != null) {
          const meld = player.melds[cue.meldIndex];
          const source = cue.source && before.players.find(item => item.id === cue.source!.seat);
          const sourceDiscard = source && riverLayout(source.discards).items.find(item => item.sourceIndex === cue.source!.riverIndex);
          const calledIndex = cue.source ? meld.tiles.lastIndexOf(cue.source.tile) : -1;
          const sourceHand = [...oldHand];
          for (const tileIndex of cue.addedTiles ?? []) {
            const oldSlot = oldSlots[Math.max(0, oldSlots.length - 1 - tileIndex)];
            let from: Vec3 = [oldSlot?.position[0] ?? 0, .6, HAND_ROW_Z], rotation: Vec3 = cue.seat === 0 ? [-.31, 0, 0] : [-.09, 0, Math.PI], fromScale = oldSlot?.scale ?? (cue.seat === 0 ? scale : 1);
            if (sourceDiscard && tileIndex === calledIndex) {
              const difference = (tableSeat(cue.source!.seat, snapshot.players.length) - tableSeat(cue.seat, snapshot.players.length)) * Math.PI / 2;
              from = rotate([sourceDiscard.position[0], tileRestHeight(sourceDiscard.rotation, sourceDiscard.scale), sourceDiscard.position[2]], difference);
              rotation = [-Math.PI / 2, 0, sourceDiscard.rotation[2]]; fromScale = sourceDiscard.scale;
            } else if (cue.seat === 0) {
              const handIndex = sourceHand.findIndex(slot => slot.tile.tile === meld.tiles[tileIndex]);
              const fromHand = handIndex >= 0 ? sourceHand.splice(handIndex, 1)[0] : undefined;
              if (fromHand) from = [fromHand.position[0], tileRestHeight(rotation, fromHand.scale), HAND_ROW_Z];
            }
            put(meldMotionKey(cue.seat, cue.meldIndex, tileIndex), from, rotation, fromScale, tileArrivalTime(cue.kind, snapshot.speed, tileIndex), .3);
          }
        } else if (cue.kind === 'riichi') {
          put(stickMotionKey(cue.seat), [...riichiStickLayout.from], [0, -.25, 0], 1, duration, .07);
        } else if (cue.kind === 'kita') {
          const index = (player.flowers?.length ?? 0) + (player.kita ?? 1) - 1;
          const oldSlot = cue.seat === 0 ? oldHand.find(slot => slot.tile.tile === 'z4') : oldSlots.at(-1);
          put(bonusMotionKey(cue.seat, index), [oldSlot?.position[0] ?? 0, .65, HAND_ROW_Z], cue.seat === 0 ? [-.31, 0, 0] : [-.09, 0, Math.PI], oldSlot?.scale ?? 1, duration, .32);
        }
      }

      if (humanDiscard) pendingDiscard = null;
      previous = snapshot; previousSession = sessionIdentity; selected = selectedId; wasLobby = !snapshot; needsBaseline = hidden;
      return { identity, placementSeed, hand, motions, latestDiscard };
    },
  };
}
