import type { RegionalBotAction, RegionalBotInput } from '../regional';
import { parseMeld, tileIndex, visibleCounts } from '../evaluator';
import { shanten } from '../../variants/hand';

export const SICHUAN_FEATURE_VERSION = 1;
export const SICHUAN_TILE_CHANNELS = 16;
export const SICHUAN_SCALARS = 32;
export const SICHUAN_FEATURES = 27 * SICHUAN_TILE_CHANNELS + SICHUAN_SCALARS;
export const SICHUAN_ACTIONS = 137;

/** Fixed whitelist of the acting player's hand and the table's public information. */
export function encodeSichuanFeatures(input: RegionalBotInput): Float32Array {
  const features = new Float32Array(SICHUAN_FEATURES);
  const scalar = 27 * SICHUAN_TILE_CHANNELS;
  const observation = input.observation;
  const add = (tile: string, channel: number, amount: number) => {
    const index = tileIndex(tile);
    if (index >= 0 && index < 27) features[index * SICHUAN_TILE_CHANNELS + channel] += amount;
  };
  input.player.hand.forEach(tile => add(tile, 0, .25));
  if (input.drawn) add(input.drawn, 1, 1);
  visibleCounts(observation).slice(0, 27).forEach((count, tile) => {
    features[tile * SICHUAN_TILE_CHANNELS + 2] = count / 4;
    features[tile * SICHUAN_TILE_CHANNELS + 15] = Number('mps'[Math.floor(tile / 9)] === input.player.voidSuit);
  });
  const players = [...observation.players].sort((a, b) =>
    (a.seat - observation.seat + 4) % 4 - (b.seat - observation.seat + 4) % 4);
  const ownPoints = players[0].points;
  players.forEach((player, relative) => {
    player.discards.filter(discard => !discard.called).forEach(discard => add(discard.tile, 3 + relative, .25));
    player.melds.flatMap(parseMeld).forEach(tile => add(tile, 7 + relative, .25));
    const last = player.discards.at(-1);
    if (last) add(last.tile, 11 + relative, 1);
    features[scalar + 4 + relative] = (player.points - ownPoints) / 64;
    features[scalar + 8 + relative] = Number(player.active !== false);
    const suit = ['m', 'p', 's'].indexOf(player.voidSuit ?? '');
    if (suit >= 0) features[scalar + 12 + relative * 3 + suit] = 1;
    features[scalar + 24 + relative] = Number(player.dealer);
  });
  features[scalar] = observation.tilesLeft / 56;
  features[scalar + 1] = (observation.activePlayerCount ?? 4) / 4;
  features[scalar + 2] = shanten(input.player.hand, input.player.melds, 4, undefined, true, false) / 6;
  features[scalar + 3] = input.player.melds.length / 4;
  features[scalar + 28] = Number(input.actions.some(action => action.type === 'pass'));
  features[scalar + 29] = input.player.hand.filter(tile => tile[0] === input.player.voidSuit).length / 14;
  features[scalar + 30] = Number(input.drawn !== null);
  features[scalar + 31] = players.reduce((sum, player) => sum + player.discards.length, 0) / 56;
  return features;
}

export function sichuanActionIndex(action: RegionalBotAction): number {
  if (action.type === 'pass') return 0;
  if (action.type === 'ron' || action.type === 'tsumo') return 1;
  const tile = tileIndex(action.tile ?? '');
  if (tile < 0 || tile >= 27) return -1;
  if (action.type === 'discard') return 2 + tile;
  if (action.type === 'pon') return 29 + tile;
  if (action.type === 'kan') return (action.kind === 'concealed' ? 83 : action.kind === 'added' ? 110 : 56) + tile;
  return -1;
}

/** The engine supplies the complete legal action list, including forced missing-suit discards. */
export function sichuanLegalMask(actions: readonly RegionalBotAction[]): Float32Array {
  const mask = new Float32Array(SICHUAN_ACTIONS);
  for (const action of actions) {
    const index = sichuanActionIndex(action);
    if (index < 0) throw new Error(`四川模型不支持操作 ${action.type}`);
    mask[index] = 1;
  }
  return mask;
}
