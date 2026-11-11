import type { GameSnapshot, ModeId } from '../types';

export interface PublicWaitCount { tile: string; unseen: number }

/** Red fives and their ordinary counterparts are the same physical tile type. */
function tileKind(tile: string): string {
  const code = tile.slice(0, 2);
  return /^[mps]0$/.test(code) ? `${code[0]}5` : code;
}

function tileSupply(mode: ModeId, tile: string): number {
  if (/^f[1-8]$/.test(tile)) return ['mcr', 'hongkong', 'taiwan'].includes(mode) ? 1 : 0;
  if (/^z[1-7]$/.test(tile)) return mode.startsWith('sichuan') ? 0 : 4;
  if (!/^[mps][1-9]$/.test(tile)) return 0;
  if (mode === 'sanma' && /^m[2-8]$/.test(tile)) return 0;
  return 4;
}

/** Counts only the player's hand and public tiles; it never inspects other hands or the wall. */
export function publicWaitCounts(snapshot: GameSnapshot, waits: readonly string[]): PublicWaitCount[] {
  const shown = new Map<string, number>();
  const add = (tile: string) => {
    const kind = tileKind(tile);
    if (/^(?:[mps][1-9]|z[1-7]|f[1-8])$/.test(kind)) shown.set(kind, (shown.get(kind) ?? 0) + 1);
  };
  snapshot.players.find(player => player.id === snapshot.humanId)?.hand.forEach(tile => add(tile.tile));
  for (const player of snapshot.players) {
    // Called discards already belong to the exposed meld and must be counted once.
    player.discards.filter(discard => !discard.called).forEach(discard => add(discard.tile));
    player.melds.forEach(meld => {
      if (snapshot.hideOpponentConcealedKongs && player.id !== snapshot.humanId && meld.concealed) return;
      meld.tiles.forEach(add);
    });
    player.flowers?.forEach(add);
    for (let n = 0; n < (player.kita ?? 0); n++) add('z4');
  }
  snapshot.round.doraIndicators.forEach(add);

  const seen = new Set<string>(), mode = snapshot.mode ?? 'riichi';
  return waits.flatMap(tile => {
    const kind = tileKind(tile);
    if (seen.has(kind)) return [];
    seen.add(kind);
    return [{ tile, unseen: Math.max(0, tileSupply(mode, kind) - (shown.get(kind) ?? 0)) }];
  });
}
