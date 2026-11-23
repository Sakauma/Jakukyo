import type { GameSnapshot } from '../game/types';

export type TableMotionKind = 'draw' | 'discard' | 'chi' | 'pon' | 'kan' | 'riichi' | 'kita';
export type MotionStyle = 'classic' | 'pixel';
export type MeldCall = 'chi' | 'pon' | 'kan';
export const isMeldCall = (kind: string): kind is MeldCall => kind === 'chi' || kind === 'pon' || kind === 'kan';
export interface TableMotionCue {
  key: string;
  kind: TableMotionKind;
  seat: number;
  riverIndex?: number;
  meldIndex?: number;
  /** A called tile is already public; this never identifies a concealed tile. */
  source?: { seat: number; riverIndex: number; tile: string; tileIndex: number };
  /** A rack-side slide is justified by the public declaration, not by a guessed giver. */
  kanEntry?: 'concealed' | 'added';
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
      // A pon upgraded in place retains its old giver; that is NOT a new discard.
      // Only a fresh, matching public claim has a piece to slide. Respect red fives.
      const take = !oldMeld && !meld.concealed ? called.find(item => item.seat !== player.id
        && (meld.from == null || item.seat === meld.from)
        && (meld.calledIndex == null ? meld.tiles.includes(item.tile) : meld.tiles[meld.calledIndex] === item.tile)) : undefined;
      const source = take && { ...take, tileIndex: meld.calledIndex ?? meld.tiles.lastIndexOf(take.tile) };
      const kanEntry = meld.type==='kan' && meld.tiles.length===4
        ? !oldMeld && meld.concealed ? 'concealed'
          : oldMeld?.type==='pon' && !meld.concealed && oldMeld.tiles.length===3 && oldMeld.tiles.every((t,i)=>t===meld.tiles[i]) ? 'added' : undefined
        : undefined;
      cues.push({ key: `${scope}:meld:${player.id}:${index}:${meld.type}:${meld.tiles.join('')}`, kind: meld.type, seat: player.id, meldIndex: index, source, kanEntry });
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
const pixelLength = { draw:210, discard:230, chi:225, pon:225, kan:235, riichi:220, kita:205 };
// Normal play: a single, readable stroke, not a wind-up / flight / slide.
// Keep the last clack of the existing foley inside the shortest engine step.
const classicLength = { draw:168, discard:160, chi:160, pon:128, kan:232, riichi:164, kita:184 };
export const continuousClaimPreview = import.meta.env.MODE === 'claim-preview';
export const riverClaimMs = 288;
export function motionDuration(kind: TableMotionKind, speed: number, reduced = false, style: MotionStyle = 'pixel', continuousClaims = continuousClaimPreview): number {
  if (reduced || speed <= 0 || !Number.isFinite(speed)) return 0;
  if (style==='pixel') return Math.min(pixelLength[kind],speed*.78);
  const travel=continuousClaims && (kind==='chi' || kind==='pon') ? riverClaimMs : classicLength[kind];
  return Math.min(travel,speed*.8);
}

type CueAction = Pick<TableMotionCue,'kind'|'source'|'kanEntry'>;
/** The arrival drives both the word and the sound. Ambiguous historical
 * changes have no slide; neither do reduced motion and zero-speed play. */
export function cueTravel(cue:CueAction, speed:number, reduced=false, style:MotionStyle='pixel', continuousClaims=continuousClaimPreview) {
  return isMeldCall(cue.kind) && !cue.source && !cue.kanEntry ? 0 : motionDuration(cue.kind,speed,reduced,style,continuousClaims);
}

/** Add only the missing observation time; the normal engine step already waits for speed. */
export function actionObservationDelay(cues: readonly TableMotionCue[], speed: number, reduced = false): number {
  if (reduced || speed <= 250 || !Number.isFinite(speed)) return 0;
  const windows: Partial<Record<TableMotionKind, number>> = { chi: 800, pon: 800, kan: 850, riichi: 850 };
  return Math.max(0, ...cues.map(cue => (windows[cue.kind] ?? 0) - speed));
}

// Meld samples attack immediately. Other recordings have a lead-in to contact.
const leadIn = { draw:105, discard:0, chi:0, pon:0, kan:0, riichi:100, kita:174 };
export function soundStartDelay(cue:CueAction, speed:number, reduced=false, style:MotionStyle='pixel') {
  return Math.max(0, cueTravel(cue,speed,reduced,style) - leadIn[cue.kind]);
}
