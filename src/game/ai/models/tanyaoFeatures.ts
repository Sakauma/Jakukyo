import Majiang from '@kobalab/majiang-core';
import { parseConcealed, parseMeld, tileIndex, visibleCounts } from '../evaluator';
import type { BotAction, BotObservation } from '../types';
import source from './riichi/source.json';

export const TANYAO_MODEL_IDENTITY = Object.freeze({ id: source.id, sha256: source.weights.sha256, featureVersion: 2, policyVersion: 1 });
export interface TanyaoContext { drawn: string | null; furiten: boolean }
export interface TanyaoFeatures { planes: Float32Array; scalars: Float32Array }

/** MIT obs_lean/obs_v2 public actor planes, relative seats self/right/across/left. */
export function encodeTanyaoFeatures(observation: BotObservation, context: TanyaoContext): TanyaoFeatures {
  if (observation.playerCount !== 4 || observation.players.some(player => player.discards.length > 24)) throw new Error('立直模型不支持当前观测长度。');
  const planes = new Float32Array(34 * 36), scalars = new Float32Array(32);
  const add = (tile: string, channel: number, value: number) => {
    const index = tileIndex(tile); if (index >= 0) planes[index * 36 + channel] += value;
  };
  const own = parseConcealed(observation.ownHand);
  const counts = Array<number>(34).fill(0);
  for (const tile of own) counts[tileIndex(tile)]++;
  for (let tile = 0; tile < 34; tile++) for (let copy = 0; copy < Math.min(4, counts[tile]); copy++) planes[tile * 36 + copy] = 1;
  for (const tile of own.filter(tile => tile[1] === '0')) add(tile, 4, 1);
  if (context.drawn) add(context.drawn, 5, 1);
  const players = [...observation.players].sort((a,b) => (a.seat-observation.seat+4)%4 - (b.seat-observation.seat+4)%4);
  const redSeen = new Set<string>();
  let allDiscards = 0, ownTedashi = 0;
  players.forEach((player, relative) => {
    scalars[relative] = Number(player.riichi); scalars[4 + relative] = player.points / 50000;
    player.discards.forEach((discard, index) => {
      add(discard.tile, 6 + relative, .25);
      planes[tileIndex(discard.tile) * 36 + 20 + relative] = (index + 1) / 24;
      if (!discard.tsumogiri) { add(discard.tile, 24 + relative, .25); if (!relative) ownTedashi++; }
      if (discard.riichi) {
        add(discard.tile, 28 + relative, 1);
        if (relative) scalars[25 + relative] = (index + 1) / 18;
      }
      if (relative) planes[tileIndex(discard.tile) * 36 + 31 + relative] = 1;
      if (discard.tile[1] === '0') redSeen.add(discard.tile[0]);
    });
    const last = player.discards.at(-1); if (last) add(last.tile, 10 + relative, 1);
    for (const tile of player.melds.flatMap(parseMeld)) {
      add(tile, 14 + relative, .25); if (tile[1] === '0') redSeen.add(tile[0]);
    }
    allDiscards += player.discards.length;
  });
  visibleCounts(observation).forEach((count, index) => { planes[index * 36 + 18] = count / 4; });
  for (const tile of observation.doraIndicators) {
    add(tile, 19, .25); if (tile[1] === '0') redSeen.add(tile[0]);
    const index = tileIndex(tile);
    const next = index < 27 ? index % 9 === 8 ? index - 8 : index + 1 : index < 31 ? 27 + (index - 27 + 1) % 4 : 31 + (index - 31 + 1) % 3;
    planes[next * 36 + 35] += .25;
  }
  scalars[8] = Majiang.Util.xiangting(Majiang.Shoupai.fromString(observation.ownHand)) / 6;
  scalars[9] = Number(context.furiten);
  scalars[10] = (observation.roundWind * 4 + observation.roundHand - 1) / 12;
  scalars[11] = observation.honba / 10; scalars[12] = observation.riichiSticks / 10;
  scalars[13 + observation.roundWind % 4] = 1; scalars[17 + observation.seat] = 1;
  scalars[21] = Math.max(0, observation.doraIndicators.length - 1) / 4;
  scalars[22] = redSeen.size / 3; scalars[23] = players[0].melds.length / 4;
  scalars[24] = Number(observation.tilesLeft === 0); scalars[25] = observation.tilesLeft / 70;
  scalars[29] = players[0].discards.length / 18; scalars[30] = allDiscards / 70;
  scalars[31] = ownTedashi / Math.max(1, players[0].discards.length);
  return { planes, scalars };
}

function consumedRed(meld: string): boolean {
  const called = meld.search(/[+=-]/) - 1;
  return [...meld].some((value, index) => value === '0' && index !== called);
}

export function tanyaoActionIndex(action: BotAction): number {
  if (action.type === 'riichi') return 72;
  if (action.type === 'tsumo') return 73;
  if (action.type === 'ron') return 74;
  if (action.type === 'pass') return 84;
  if (action.type === 'abort') return 85;
  if (action.type === 'discard') {
    if (action.discard?.includes('_')) return 71;
    const tile = action.tile || action.discard?.slice(0, 2) || '';
    return tile[1] === '0' ? 34 + 'mps'.indexOf(tile[0]) : tileIndex(tile);
  }
  const meld = action.meld;
  if (!meld) return -1;
  if (action.type === 'kan') return action.concealedKan ? 37 + tileIndex(meld[0] + meld.slice(-1)) : 77;
  if (action.type === 'pon') return 75 + Number(consumedRed(meld));
  if (action.type !== 'chi') return -1;
  const ranks = [...meld.slice(1)].filter(value => /\d/.test(value)).map(value => Number(value) || 5);
  const called = Number(meld[meld.search(/[+=-]/) - 1]) || 5;
  return 78 + (called - Math.min(...ranks)) * 2 + Number(consumedRed(meld));
}

export function tanyaoLegalMask(actions: readonly BotAction[]): Float32Array {
  const mask = new Float32Array(87);
  for (const action of actions) { const index = tanyaoActionIndex(action); if (index >= 0 && index < 86) mask[index] = 1; }
  return mask;
}
