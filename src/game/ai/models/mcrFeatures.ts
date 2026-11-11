import { normalTile, parseConcealed, parseMeld } from '../evaluator';
import type { BotObservation } from '../types';
import type { RegionalBotAction } from '../regional';
import source from './mcr/source.json';

// Dannibal/ijcai-mahjong-ckpts-2026 champion feature.py, MIT.
// Botzone W/T/B are wan/tiao/bing. J1/J2/J3 are red/green/white dragons.
export const MCR_FEATURE_SIZE = 38 * 36;
export const MCR_ACTION_SIZE = 235;
export const MCR_MODEL_IDENTITY = Object.freeze({
  id: source.id, sha256: source.weights.sha256, featureVersion: 1, policyVersion: 1,
});

export function mcrTileIndex(tile: string): number {
  const normalized = normalTile(tile);
  const rank = Number(normalized[1]);
  if (normalized[0] === 'm' && rank >= 1 && rank <= 9) return rank - 1;
  if (normalized[0] === 's' && rank >= 1 && rank <= 9) return rank + 8;
  if (normalized[0] === 'p' && rank >= 1 && rank <= 9) return rank + 17;
  if (normalized[0] === 'z' && rank >= 1 && rank <= 4) return rank + 26;
  return ({ z7: 31, z6: 32, z5: 33 } as Record<string, number>)[normalized] ?? -1;
}

function encodeCounts(output: Float32Array, plane: number, tiles: string[]): void {
  const counts = Array<number>(34).fill(0);
  for (const tile of tiles) {
    const index = mcrTileIndex(tile);
    if (index >= 0) counts[index]++;
  }
  for (let tile = 0; tile < 34; tile++) {
    for (let copy = 0; copy < Math.min(4, counts[tile]); copy++) output[(plane + copy) * 36 + tile] = 1;
  }
}

/** Called at this player's own deal/draw/discard/call, matching the author's refresh timing. */
export function encodeMcrFeatures(observation: BotObservation): Float32Array {
  const output = new Float32Array(MCR_FEATURE_SIZE);
  output[27 + observation.seat] = 1;
  output[36 + 27 + observation.roundWind % 4] = 1;
  encodeCounts(output, 2, parseConcealed(observation.ownHand));
  for (const player of observation.players) {
    const relative = (player.seat - observation.seat + 4) % 4;
    // History includes claimed tiles. Public availability uses its separate de-duplicated counts.
    encodeCounts(output, 6 + relative * 4, player.discards.map(discard => discard.tile));
    const publicMelds = player.melds.filter(meld => player.id === observation.ownId || /[+=-]/.test(meld));
    encodeCounts(output, 22 + relative * 4, publicMelds.flatMap(parseMeld));
  }
  return output;
}

export function mcrActionIndex(action: RegionalBotAction): number {
  if (action.type === 'pass') return 0;
  if (action.type === 'ron' || action.type === 'tsumo') return 1;
  const tile = mcrTileIndex(action.tile || '');
  if (tile < 0) return -1;
  if (action.type === 'discard') return 2 + tile;
  if (action.type === 'pon') return 99 + tile;
  if (action.type === 'kan') return (action.kind === 'concealed' ? 167 : action.kind === 'added' ? 201 : 133) + tile;
  if (action.type !== 'chi' || !action.tiles?.length) return -1;
  const start = Math.min(...action.tiles.map(value => Number(normalTile(value)[1])));
  const suit = 'msp'.indexOf(action.tile![0]);
  const position = Number(normalTile(action.tile!)[1]) - start;
  if (suit < 0 || start < 1 || start > 7 || position < 0 || position > 2) return -1;
  return 36 + suit * 21 + (start - 1) * 3 + position;
}

export function mcrLegalMask(actions: readonly RegionalBotAction[]): Float32Array {
  const mask = new Float32Array(MCR_ACTION_SIZE);
  for (const action of actions) {
    const index = mcrActionIndex(action);
    if (index >= 0) mask[index] = 1;
  }
  return mask;
}
