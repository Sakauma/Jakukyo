import type { GameSnapshot } from '../game/types';

export type TableMotionKind = 'draw' | 'discard' | 'chi' | 'pon' | 'kan' | 'riichi' | 'kita';
export interface TableMotionCue {
  key: string;
  kind: TableMotionKind;
  seat: number;
  riverIndex?: number;
  meldIndex?: number;
  /** A called tile is already public; this never identifies a concealed tile. */
  source?: { seat: number; riverIndex: number; tile: string };
  addedTiles?: number[];
  /** Supplementary flower exposure may be atomic; preserve foley without inventing a concealed move. */
  flowerSupplement?: boolean;
}

/** Display identity only: never used to make a decision or inspect a wall. */
export const tableScope = (snapshot: GameSnapshot) => `${snapshot.mode}:${snapshot.seed}:${snapshot.round.wind}:${snapshot.round.hand}:${snapshot.round.dealer}:${snapshot.round.sequence ?? ''}`;

export function needsTableBaseline(before: GameSnapshot | null, current: GameSnapshot): boolean {
  return !before || tableScope(before) !== tableScope(current)
    || current.revision < before.revision
    || (current.log.at(-1)?.id ?? 0) < (before.log.at(-1)?.id ?? 0)
    || current.status === 'playing' && (before.status !== 'playing' || current.round.tilesLeft > before.round.tilesLeft + 10);
}

/**
 * Actual, public board changes are the single event source for movement and foley.
 * Positional hand IDs and log text are deliberately not event identities.
 */
export function tableMotionCues(before: GameSnapshot, current: GameSnapshot): TableMotionCue[] {
  if (needsTableBaseline(before, current) || current.revision === before.revision) return [];
  const cues: TableMotionCue[] = [], scope = tableScope(current);
  const called = current.players.flatMap(player => {
    const old = before.players.find(item => item.id === player.id);
    return player.discards.flatMap((discard, index) => discard.called && !old?.discards[index]?.called
      ? [{ seat: player.id, riverIndex: index, tile: discard.tile }] : []);
  });
  for (const player of current.players) {
    const old = before.players.find(item => item.id === player.id);
    if (!old) continue;
    for (let index = old.discards.length; index < player.discards.length; index++) {
      cues.push({ key: `${scope}:discard:${player.id}:${index}`, kind: 'discard', seat: player.id, riverIndex: index });
    }
    player.melds.forEach((meld, index) => {
      const oldMeld = old.melds[index];
      if (oldMeld && oldMeld.type === meld.type && oldMeld.tiles.join() === meld.tiles.join()) return;
      const added = oldMeld && meld.tiles.length > oldMeld.tiles.length
        ? Array.from({ length: meld.tiles.length - oldMeld.tiles.length }, (_, i) => oldMeld.tiles.length + i)
        : meld.tiles.map((_, i) => i);
      const source = !meld.concealed ? called.find(item => meld.from == null || item.seat === meld.from) : undefined;
      cues.push({ key: `${scope}:meld:${player.id}:${index}:${meld.type}:${meld.tiles.join('')}`, kind: meld.type, seat: player.id, meldIndex: index, source, addedTiles: added });
    });
    if (player.riichi && !old.riichi) cues.push({ key: `${scope}:riichi:${player.id}`, kind: 'riichi', seat: player.id });
    if ((player.kita ?? 0) > (old.kita ?? 0)) cues.push({ key: `${scope}:kita:${player.id}:${player.kita}`, kind: 'kita', seat: player.id });
    if ((player.flowers?.length ?? 0) > (old.flowers?.length ?? 0)) {
      cues.push({ key: `${scope}:flowers:${player.id}:${player.flowers!.length}`, kind: 'draw', seat: player.id, flowerSupplement: true });
    }
    if (current.status === 'playing' && current.round.tilesLeft < before.round.tilesLeft && player.concealedCount > old.concealedCount) {
      cues.push({ key: `${scope}:draw:${player.id}:${current.round.tilesLeft}`, kind: 'draw', seat: player.id });
    }
  }
  return cues;
}

/** All visual arrivals finish before the next fastest visible engine step. */
export function motionDuration(kind: TableMotionKind, speed: number, reduced = false): number {
  if (reduced || speed <= 0) return 0;
  const normal: Record<TableMotionKind, number> = { draw: 210, discard: 230, chi: 225, pon: 225, kan: 235, riichi: 220, kita: 205 };
  return Math.min(normal[kind], Math.max(0, speed * .78));
}

/** Add only the missing observation time; the normal engine step already waits for speed. */
export function actionObservationDelay(cues: readonly TableMotionCue[], speed: number, reduced = false): number {
  if (reduced || speed <= 250 || !Number.isFinite(speed)) return 0;
  const windows: Partial<Record<TableMotionKind, number>> = { chi: 800, pon: 800, kan: 850, riichi: 850 };
  return Math.max(0, ...cues.map(cue => (windows[cue.kind] ?? 0) - speed));
}

// Existing sample contact offsets, in milliseconds. Keep the sound design intact.
const contacts: Record<TableMotionKind, number[]> = {
  draw: [105], discard: [0], chi: [45, 95, 150], pon: [0, 52, 84], kan: [0, 45, 98, 168], riichi: [100], kita: [174],
};

export function soundStartDelay(kind: TableMotionKind, speed: number, reduced = false): number {
  if (reduced) return 0;
  return Math.max(0, motionDuration(kind, speed) - contacts[kind].at(-1)!);
}

/** Meld tiles contact the cloth in the rhythm already present in the sample. */
export function tileArrivalTime(kind: TableMotionKind, speed: number, tileIndex = 0, reduced = false): number {
  if (reduced || speed <= 0) return 0;
  const pattern = contacts[kind], beat = pattern[Math.min(tileIndex, pattern.length - 1)];
  return Math.min(motionDuration(kind, speed), soundStartDelay(kind, speed) + beat);
}
