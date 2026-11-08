/** v1 strategy retained exclusively to reconstruct saves created before difficulty levels existed. */
import Majiang from '@kobalab/majiang-core';
import { normalTile, parseConcealed, parseMeld, tileIndex, visibleCounts } from './evaluator';
import type { BotAction, BotObservation } from './types';

export function chooseLegacyAction(observation: BotObservation, actions: BotAction[]): string {
  const win = actions.find(action => action.type === 'ron' || action.type === 'tsumo');
  if (win) return win.key;
  const hand = Majiang.Shoupai.fromString(observation.ownHand);
  const visible = visibleCounts(observation);
  const scoreCache = new Map<string, number>();
  const score = (action: BotAction) => {
    const discard = action.discard!.replace('*', '');
    if (!scoreCache.has(discard)) {
      const next = hand.clone().dapai(discard);
      const shanten = Majiang.Util.xiangting(next);
      const effective: string[] = Majiang.Util.tingpai(next) || [];
      const ukeire = effective.reduce((sum, tile) => sum + Math.max(0, 4 - visible[tileIndex(tile)]), 0);
      const dora = observation.doraIndicators.filter(tile => normalTile(Majiang.Shan.zhenbaopai(tile)) === normalTile(discard)).length * 4;
      let danger = 0;
      for (const player of observation.players) {
        if (player.id !== observation.ownId && player.riichi && !player.discards.some(tile => normalTile(tile.tile) === normalTile(discard))) danger += shanten > 1 ? 8 : 2;
      }
      scoreCache.set(discard, -shanten * 1000 + ukeire * 8 - (discard[1] === '0' ? 4 : 0) - dora - danger);
    }
    return scoreCache.get(discard)! + (action.type === 'riichi' ? 2 : 0);
  };
  const safeOpen = (candidate: any) => {
    const values = new Set([`z${observation.seat + 1}`, `z${observation.roundWind + 1}`, 'z5', 'z6', 'z7']);
    if (candidate._fulou.some((meld: string) => values.has(meld.slice(0, 2)))) return true;
    return [...parseConcealed(candidate.toString()), ...candidate._fulou.flatMap(parseMeld)]
      .every(tile => tile[0] !== 'z' && ![1, 9].includes(Number(tile[1]) || 5));
  };
  const currentShanten = Majiang.Util.xiangting(hand);
  for (const action of actions.filter(item => item.type === 'kan')) {
    if (observation.players.some(player => player.id !== observation.ownId && player.riichi)) continue;
    const next = action.concealedKan ? hand.clone().gang(action.meld) : hand.clone().fulou(action.meld);
    if (Majiang.Util.xiangting(next) <= currentShanten && (next.menqian || safeOpen(next))) return action.key;
  }
  const discards = actions.filter(action => action.discard);
  if (discards.length) return discards.reduce((best, candidate) => score(candidate) > score(best) ? candidate : best).key;
  for (const action of actions.filter(item => item.type === 'pon' || item.type === 'chi')) {
    const next = hand.clone().fulou(action.meld);
    if (!safeOpen(next)) continue;
    const discards: string[] = Majiang.Game.get_dapai(Majiang.rule(), next) || [];
    const best = Math.min(...discards.map(tile => Majiang.Util.xiangting(next.clone().dapai(tile))));
    if (best < currentShanten) return action.key;
  }
  return (actions.find(action => action.type === 'pass') || actions[0]).key;
}
