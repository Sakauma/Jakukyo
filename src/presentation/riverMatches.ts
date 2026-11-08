import type { GameSnapshot, PlayerView } from '../game/types';
import { riverLayout } from '../table/riverLayout';

/** Matching is by tile kind; a red five is still the same five for river comparison. */
export function normalizeRiverTile(code: string | null | undefined): string | null {
  if (!code || !/^(?:[mps][0-9]|z[1-7]|f[1-8])$/.test(code)) return null;
  return code[1] === '0' ? `${code[0]}5` : code;
}

/** Own-hand identities may be reused by engines; bind a selection to its actual hand. */
export function riverSelectionScope(snapshot: GameSnapshot): string {
  const human = snapshot.players.find(player => player.isHuman);
  return JSON.stringify([snapshot.mode ?? 'riichi', snapshot.seed, snapshot.round.wind, snapshot.round.hand,
    snapshot.round.honba, snapshot.round.dealer, human?.hand.map(tile => [tile.id, tile.tile, tile.drawn]) ?? []]);
}

export function resolveRiverSelection(snapshot: GameSnapshot | null, selectedId: string | null, selectedScope: string | null): string | null {
  if (!snapshot || snapshot.status !== 'playing' || !selectedId || selectedScope !== riverSelectionScope(snapshot)) return null;
  const selected = snapshot.players.find(player => player.isHuman)?.hand.find(tile => tile.id === selectedId);
  return normalizeRiverTile(selected?.tile);
}

export interface PlayerRiverMatches {
  playerId: number;
  /** All current, uncalled river tiles, including earlier display pages. */
  inRiverCount: number;
  /** Only the tiles on this player's current 3D river page. */
  pageCount: number;
  /** Historical discard entries, including tiles that were later called away. */
  discardedCount: number;
  calledAwayCount: number;
  inRiverIndices: number[];
  pageIndices: number[];
  discardedIndices: number[];
}

/** Public rivers only: never estimates the wall, opponents' hands, or furiten. */
export function getRiverMatches(players: readonly Pick<PlayerView, 'id' | 'discards'>[], highlightedTile: string | null | undefined) {
  const tile = normalizeRiverTile(highlightedTile);
  const byPlayer: PlayerRiverMatches[] = players.map(player => {
    const discardedIndices = tile ? player.discards.flatMap((discard, index) => normalizeRiverTile(discard.tile) === tile ? [index] : []) : [];
    const inRiverIndices = discardedIndices.filter(index => !player.discards[index].called);
    const currentPage = new Set(riverLayout(player.discards).items.map(discard => discard.sourceIndex));
    const pageIndices = inRiverIndices.filter(index => currentPage.has(index));
    return { playerId: player.id, inRiverCount: inRiverIndices.length, pageCount: pageIndices.length,
      discardedCount: discardedIndices.length, calledAwayCount: discardedIndices.length - inRiverIndices.length,
      inRiverIndices, pageIndices, discardedIndices };
  });
  return { tile, byPlayer, inRiverCount: byPlayer.reduce((total, player) => total + player.inRiverCount, 0),
    pageCount: byPlayer.reduce((total, player) => total + player.pageCount, 0),
    discardedCount: byPlayer.reduce((total, player) => total + player.discardedCount, 0),
    calledAwayCount: byPlayer.reduce((total, player) => total + player.calledAwayCount, 0) };
}
