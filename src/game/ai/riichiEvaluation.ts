import Majiang from '@kobalab/majiang-core';
import { evaluateDanger, normalTile, tileIndex, visibleCounts } from './evaluator';
import type { BotDecision, BotObservation, CandidateMetrics, Difficulty, GenericCandidate } from './types';

type Hand = any;

export interface RiichiCandidate extends GenericCandidate {
  riichi?: boolean;
  ronUkeire?: number;
}

/** Score live winning tiles, including furiten caused by the proposed discard. */
export function readyHandMetrics(hand: Hand, observation: BotObservation, known: number[], discard: string, riichi: boolean) {
  const waits: string[] = Majiang.Util.tingpai(hand) || [];
  const waitTypes = new Set(waits.map(normalTile));
  const ownRiver = observation.players.find(player => player.id === observation.ownId)?.discards || [];
  const furiten = observation.discardFuriten && (waitTypes.has(normalTile(discard))
    || ownRiver.some(item => waitTypes.has(normalTile(item.tile))));
  // Pool payments are added once by the ranker, separately from the hand value.
  const param = Majiang.Util.hule_param({ menfeng: observation.seat, zhuangfeng: observation.roundWind,
    lizhi: riichi || hand.lizhi ? 1 : 0, baopai: observation.doraIndicators });
  let ukeire = 0;
  let ronUkeire = 0;
  let weightedValue = 0;
  for (const tile of waits) {
    const remaining = Math.max(0, (observation.tileLimits?.[tileIndex(tile)] ?? 4) - known[tileIndex(tile)]);
    if (!remaining) continue;
    const tsumo = Majiang.Util.hule(hand.clone().zimo(tile), null, param)?.defen || 0;
    const ron = furiten ? 0 : Majiang.Util.hule(hand, tile + '+', param)?.defen || 0;
    if (!tsumo && !ron) continue;
    ukeire += remaining;
    if (ron) ronUkeire += remaining;
    weightedValue += remaining * (ron && tsumo ? tsumo * .4 + ron * .6 : tsumo || ron);
  }
  return { ukeire, ronUkeire, estimatedValue: ukeire ? weightedValue / ukeire : 0 };
}

function placementProtection(observation: BotObservation): number {
  if (!observation.finalRound) return 1;
  const scores = observation.players.map(player => player.points).sort((a, b) => b - a);
  const own = observation.players.find(player => player.id === observation.ownId)?.points || 0;
  if (own === scores[0] && scores[0] - scores[1] >= 6000) return 1.6;
  if (own === scores[scores.length - 1] && scores[scores.length - 2] - own >= 3000) return .62;
  return 1.1;
}

/** Four-player v6 policy. Win chances remain bounded heuristics, not measured probabilities. */
export function rankRiichiCandidates(observation: BotObservation, candidates: RiichiCandidate[], difficulty: Difficulty,
  phase: 'discard' | 'response' = 'discard'): BotDecision {
  if (!candidates.length) throw new Error('AI requires at least one legal candidate.');
  const known = visibleCounts(observation);
  const unseen = Math.max(1, 136 - known.reduce((sum, count) => sum + count, 0));
  const maximumThreat = evaluateDanger(observation, 'z1', known).maximumThreat;
  const threatened = maximumThreat >= .6;
  // A ready opponent can end the hand before the remaining wall is exhausted.
  const ownDraws = Math.min(Math.max(0, observation.tilesLeft / observation.playerCount), threatened ? 4 : Infinity);
  // Quiet play retains shape progress. Threatened play compares net point estimates.
  const progressWeight = threatened || phase === 'response' ? .03 : 1;
  const protection = placementProtection(observation);
  const metrics: CandidateMetrics[] = candidates.map(candidate => {
    const danger = candidate.tile ? evaluateDanger(observation, candidate.tile, known)
      : { risk: 0, expectedLoss: 0, lossIfDealIn: 0 };
    const ronShare = candidate.shanten === 0 && candidate.ukeire ? (candidate.ronUkeire ?? 0) / candidate.ukeire : 0;
    const opportunities = Math.max(0, ownDraws - Math.max(0, candidate.shanten) * 1.5) * (1 + .6 * ronShare);
    const improve = 1 - Math.pow(1 - Math.min(.9, candidate.ukeire / unseen), opportunities);
    const chance = candidate.shanten < 0 ? 1 : improve * [1, .4, .12, .03][Math.min(3, Math.max(0, candidate.shanten))];
    const value = candidate.estimatedValue + observation.riichiSticks * 1000 + observation.honba * 300;
    // A new 1000-point deposit is paid now and returned on this player's own win.
    const riichiCost = candidate.riichi ? 1000 * (1 - chance) : 0;
    const distance = candidate.shanten === 0 && candidate.ukeire === 0 ? 1 : candidate.shanten;
    const progress = threatened ? -Math.min(6, Math.max(0, distance)) + Math.min(1, candidate.ukeire / 136)
      : (-distance * 10000 + candidate.ukeire * 20) * progressWeight;
    const score = progress + chance * value - riichiCost
      - danger.expectedLoss * protection * (candidate.shanten === 0 ? 1.1 : 1.25)
      + (difficulty === 'expert' ? candidate.lookahead || 0 : 0);
    return { key: candidate.key, tile: candidate.tile, shanten: candidate.shanten, ukeire: candidate.ukeire,
      estimatedValue: candidate.estimatedValue, risk: danger.risk, lossIfDealIn: danger.lossIfDealIn, score,
      ...(candidate.lookahead == null ? {} : { lookahead: candidate.lookahead }) };
  });
  metrics.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const bestShanten = Math.min(...metrics.map(candidate => candidate.shanten));
  const winner = metrics[0];
  const folding = winner.shanten > bestShanten && winner.risk < .025;
  return { key: winner.key, difficulty, strategy: folding ? 'fold'
    : difficulty === 'expert' && candidates.some(candidate => candidate.lookahead != null) ? 'search' : 'attack',
    candidates: metrics, searchNodes: 0, searchBudget: 0 };
}

/** One node is one fully evaluated hypothetical discard. Partial draw branches are discarded. */
export function improvingDrawQuality(hand: Hand, observation: BotObservation, known: number[], budget: number) {
  const originalShanten = Majiang.Util.xiangting(hand);
  if (originalShanten <= 0) return { value: 0, nodes: 0 };
  const remaining = (tile: string, counts: number[]) => Math.max(0,
    (observation.tileLimits?.[tileIndex(tile)] ?? 4) - counts[tileIndex(tile)]);
  const draws = (Majiang.Util.tingpai(hand) as string[] || [])
    .map(tile => ({ tile, weight: remaining(tile, known) })).filter(draw => draw.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.tile.localeCompare(b.tile));
  const unseen = Math.max(1, 136 - known.reduce((sum, count) => sum + count, 0));
  let nodes = 0;
  let weightedQuality = 0;
  let evaluatedWeight = 0;
  for (const draw of draws.slice(0, 4)) {
    const drawn = hand.clone().zimo(draw.tile);
    const discards: string[] = drawn.get_dapai() || [];
    if (!discards.length || nodes + discards.length > budget) break;
    const afterDraw = [...known];
    afterDraw[tileIndex(draw.tile)]++;
    let bestShanten = Infinity;
    let bestUkeire = 0;
    for (const discard of discards) {
      const next = drawn.clone().dapai(discard);
      const shanten = Majiang.Util.xiangting(next);
      nodes++;
      if (shanten > bestShanten) continue;
      const effective: string[] = Majiang.Util.tingpai(next) || [];
      const ukeire = effective.reduce((sum, tile) => sum + remaining(tile, afterDraw), 0);
      if (shanten < bestShanten) { bestShanten = shanten; bestUkeire = ukeire; }
      else bestUkeire = Math.max(bestUkeire, ukeire);
    }
    weightedQuality += draw.weight * (bestShanten < originalShanten ? bestUkeire : 0);
    evaluatedWeight += draw.weight;
  }
  const improveWeight = draws.reduce((sum, draw) => sum + draw.weight, 0);
  // At most three effective tiles' worth of tie-breaking, always on the same shanten.
  const value = evaluatedWeight ? Math.min(60, weightedQuality / evaluatedWeight * improveWeight / unseen * 4) : 0;
  return { value, nodes };
}
