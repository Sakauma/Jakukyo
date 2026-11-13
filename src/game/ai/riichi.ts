import Majiang from '@kobalab/majiang-core';
import { evaluateDanger, normalTile, parseConcealed, parseMeld, rankPublicCandidates, seededRandom, TILE_TYPES, tileIndex, visibleCounts } from './evaluator';
import type { BotAction, BotDecision, BotObservation, Difficulty, GenericCandidate } from './types';
import { AI_VERSION } from './types';
import { improvingDrawQuality, rankRiichiCandidates, readyHandMetrics } from './riichiEvaluation';
import type { RiichiCandidate } from './riichiEvaluation';

type Hand = any;
const SEARCH_NODES = 240;

function shapeValue(hand: Hand, discard: string, observation: BotObservation): number {
  const tiles = parseConcealed(hand.toString());
  const counts = new Map<string, number>();
  for (const tile of tiles) counts.set(normalTile(tile), (counts.get(normalTile(tile)) || 0) + 1);
  let score = 0;
  for (const [tile, count] of counts) {
    score += count >= 3 ? 18 : count === 2 ? 9 : 0;
    if (tile[0] === 'z') {
      if (count === 1) score -= [5, 6, 7, observation.seat + 1, observation.roundWind + 1].includes(Number(tile[1])) ? 1 : 4;
    } else {
      const rank = Number(tile[1]);
      score += (counts.has(tile[0] + (rank + 1)) ? 6 : 0) + (counts.has(tile[0] + (rank + 2)) ? 2 : 0);
      if (rank > 1 && rank < 9) score += .35;
    }
  }
  if (discard[1] === '0') score -= 2;
  return score;
}

export function safeOpenYaku(hand: Hand, observation: BotObservation): boolean {
  if (hand.menqian) return true;
  const values = new Set([`z${observation.seat + 1}`, `z${observation.roundWind + 1}`, 'z5', 'z6', 'z7']);
  if (hand._fulou.some((meld: string) => values.has(meld.slice(0, 2)))) return true;
  const tiles = [...parseConcealed(hand.toString()), ...hand._fulou.flatMap(parseMeld)];
  if (observation.allowOpenTanyao && tiles.every(tile => tile[0] !== 'z' && ![1, 9].includes(Number(tile[1]) || 5))) return true;
  const suits = new Set(tiles.filter(tile => tile[0] !== 'z').map(tile => tile[0]));
  if (suits.size === 1) return true;
  const counts = new Map<string, number>();
  parseConcealed(hand.toString()).forEach(tile => counts.set(normalTile(tile), (counts.get(normalTile(tile)) || 0) + 1));
  return hand._fulou.every((meld: string) => new Set(parseMeld(meld).map(normalTile)).size === 1)
    && [...counts.values()].filter(count => count >= 2).length + hand._fulou.length >= 5;
}

function handValue(hand: Hand, observation: BotObservation, riichi: boolean, shanten: number, effective: string[]): number {
  if (shanten === 0) {
    const values: number[] = [];
    const param = Majiang.Util.hule_param({ menfeng: observation.seat, zhuangfeng: observation.roundWind,
      lizhi: riichi || hand.lizhi ? 1 : 0, baopai: observation.doraIndicators,
      changbang: observation.honba, lizhibang: observation.riichiSticks });
    for (const tile of effective) {
      try {
        const result = Majiang.Util.hule(hand.clone().zimo(tile), null, param);
        if (result?.defen) values.push(result.defen);
      } catch { /* A capped copy count can make a hypothetical draw impossible. */ }
    }
    if (values.length) return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  const tiles = [...parseConcealed(hand.toString()), ...hand._fulou.flatMap(parseMeld)];
  const counts = new Map<string, number>();
  for (const tile of tiles) counts.set(normalTile(tile), (counts.get(normalTile(tile)) || 0) + 1);
  const honors = new Set([`z${observation.seat + 1}`, `z${observation.roundWind + 1}`, 'z5', 'z6', 'z7']);
  let han = hand.menqian ? .7 : .1;
  if (riichi || hand.lizhi) han += 1;
  for (const honor of honors) han += (counts.get(honor) || 0) >= 3 ? 1 : (counts.get(honor) || 0) === 2 ? .42 : 0;
  if (tiles.every(tile => tile[0] !== 'z' && ![1, 9].includes(Number(tile[1]) || 5))) han += 1;
  const suited = tiles.filter(tile => tile[0] !== 'z');
  const suitCounts = ['m', 'p', 's'].map(suit => suited.filter(tile => tile[0] === suit).length);
  const concentration = Math.max(...suitCounts) / Math.max(1, suited.length);
  if (concentration === 1) han += tiles.length === suited.length ? hand.menqian ? 6 : 5 : hand.menqian ? 3 : 2;
  else if (concentration > .8) han += hand.menqian ? .75 : .45;
  const pairs = [...counts.values()].filter(count => count >= 2).length;
  if (hand.menqian && pairs >= 5) han += .7;
  for (const indicator of observation.doraIndicators) han += counts.get(normalTile(Majiang.Shan.zhenbaopai(indicator))) || 0;
  han += tiles.filter(tile => tile[1] === '0').length;
  return Math.min(16000, 1000 * Math.pow(2, Math.max(0, han - 1))) * (observation.seat === 0 ? 1.5 : 1);
}

export function basicMetrics(hand: Hand, key: string, discard: string, observation: BotObservation, known: number[], riichi = false, calibrated = false): RiichiCandidate {
  const shanten = Majiang.Util.xiangting(hand);
  const effective: string[] = Majiang.Util.tingpai(hand) || [];
  const ukeire = effective.reduce((sum, tile) => sum + Math.max(0, (observation.tileLimits?.[tileIndex(tile)] ?? 4) - known[tileIndex(tile)]), 0);
  const ready = calibrated && shanten === 0 ? readyHandMetrics(hand, observation, known, discard.slice(0, 2), riichi) : undefined;
  const candidate = { key, tile: discard.slice(0, 2), shanten, ukeire,
    estimatedValue: ready?.estimatedValue ?? handValue(hand, observation, riichi, shanten, effective),
    shapeScore: shapeValue(hand, discard, observation) };
  if (!calibrated) return candidate;
  return { ...candidate, riichi, ...ready };
}

/** Two future own draws sampled from unseen tile counts, never from the actual wall. */
function lookAhead(hand: Hand, observation: BotObservation, known: number[], budget: number) {
  const random = seededRandom(`${observation.seed}:lookahead`);
  const originalShanten = Majiang.Util.xiangting(hand);
  let nodes = 0, total = 0, trials = 0;
  const shantenCache = new Map<string, number>();
  const distance = (candidate: Hand) => {
    const key = candidate.toString();
    const cached = shantenCache.get(key);
    if (cached != null) return cached;
    if (nodes >= budget) return originalShanten;
    nodes++;
    const result = Majiang.Util.xiangting(candidate);
    shantenCache.set(key, result);
    return result;
  };
  for (let trial = 0; trial < 4 && nodes < budget; trial++) {
    let simulated = hand.clone();
    // A riichi hand must retain its lock, so subsequent get_dapai only returns tsumogiri.
    const available = known.map((count, index) => Math.max(0, (observation.tileLimits?.[index] ?? 4) - count));
    let completion = false;
    for (let depth = 0; depth < 2 && nodes < budget; depth++) {
      const amount = available.reduce((sum, count) => sum + count, 0);
      if (!amount) break;
      let drawIndex = 0, target = Math.floor(random() * amount);
      for (; drawIndex < 33; drawIndex++) { if (target < available[drawIndex]) break; target -= available[drawIndex]; }
      available[drawIndex]--;
      const drawn = simulated.clone().zimo(TILE_TYPES[drawIndex]);
      if (distance(drawn) < 0) { completion = true; simulated = drawn; break; }
      const discards: string[] = drawn.get_dapai() || [];
      let best: Hand | null = null, bestScore = -Infinity;
      for (const discard of discards) {
        if (nodes >= budget) break;
        const next = drawn.clone().dapai(discard);
        const score = -distance(next) * 100 + shapeValue(next, discard, observation);
        if (score > bestScore) { bestScore = score; best = next; }
      }
      if (best) simulated = best;
      else break;
    }
    const remainingShanten = simulated._zimo ? originalShanten : distance(simulated);
    total += completion ? 800 : (originalShanten - remainingShanten) * 240 + shapeValue(simulated, '', observation) * .35;
    trials++;
  }
  return { value: trials ? total / trials : 0, nodes };
}

export function chooseRiichiAction(observation: BotObservation, actions: BotAction[], difficulty: Difficulty, aiVersion = AI_VERSION): BotDecision {
  if (!actions.length) throw new Error('AI cannot decide without legal actions.');
  const calibrated = aiVersion >= 6 && observation.playerCount === 4 && (difficulty === 'advanced' || difficulty === 'expert');
  const rank = (candidates: RiichiCandidate[], phase: 'discard' | 'response' = 'discard') => calibrated
    ? rankRiichiCandidates(observation, candidates, difficulty, phase)
    : rankPublicCandidates(observation, candidates, difficulty);
  const quick = (action: BotAction, strategy: BotDecision['strategy']): BotDecision => ({ key: action.key, difficulty, strategy, candidates: [], searchNodes: 0, searchBudget: 0 });
  const win = actions.find(action => action.type === 'ron' || action.type === 'tsumo');
  if (win) return quick(win, 'win');
  const hand = Majiang.Shoupai.fromString(observation.ownHand);
  const known = visibleCounts(observation);
  const currentShanten = Majiang.Util.xiangting(hand);
  const pass = actions.find(action => action.type === 'pass');
  const discards = actions.filter(action => action.discard);
  const metrics: RiichiCandidate[] = [];
  const hands = new Map<string, Hand>();
  const cache = new Map<string, RiichiCandidate>();
  for (const action of discards) {
    const discard = action.discard!.replace('*', '');
    const cacheKey = discard + (action.type === 'riichi' ? '*' : '');
    let candidate = cache.get(cacheKey);
    const next = hand.clone().dapai(discard);
    if (!candidate) {
      candidate = basicMetrics(next, action.key, discard, observation, known, action.type === 'riichi', calibrated);
      cache.set(cacheKey, candidate);
    }
    metrics.push({ ...candidate, key: action.key });
    if (action.type === 'riichi') next._lizhi = true;
    hands.set(action.key, next);
  }
  if (metrics.length) {
    let result = rank(metrics);
    if (difficulty === 'expert' && calibrated) {
      const bestShanten = Math.min(...metrics.map(candidate => candidate.shanten));
      const unique: RiichiCandidate[] = [];
      const seen = new Set<string>();
      if (evaluateDanger(observation, 'z1', known).maximumThreat < .6) {
        for (const ranked of result.candidates) {
          const candidate = metrics.find(item => item.key === ranked.key)!;
          if (candidate.shanten !== bestShanten || candidate.shanten <= 0) continue;
          const identity = normalTile(candidate.tile || '');
          if (!seen.has(identity)) { seen.add(identity); unique.push(candidate); }
          if (unique.length === 3) break;
        }
      }
      let nodes = 0;
      for (const candidate of unique) {
        const search = improvingDrawQuality(hands.get(candidate.key)!, observation, known, Math.floor(SEARCH_NODES / unique.length));
        nodes += search.nodes;
        for (const item of metrics) {
          if (item.shanten === candidate.shanten && normalTile(item.tile || '') === normalTile(candidate.tile || '')) item.lookahead = search.value;
        }
      }
      if (unique.length) {
        result = rank(metrics);
        result.searchNodes = nodes;
        result.searchBudget = SEARCH_NODES;
      }
    } else if (difficulty === 'expert') {
      // Search the best three distinct discard identities; riichi/dama share the sampled trajectory.
      const unique: GenericCandidate[] = [];
      const seen = new Set<string>();
      for (const ranked of result.candidates) {
        const candidate = metrics.find(item => item.key === ranked.key)!;
        const identity = normalTile(candidate.tile || '');
        if (!seen.has(identity)) { seen.add(identity); unique.push(candidate); }
        if (unique.length === 3) break;
      }
      let nodes = 0;
      for (const candidate of unique) {
        const search = lookAhead(hands.get(candidate.key)!, observation, known, Math.floor(SEARCH_NODES / unique.length));
        nodes += search.nodes;
        for (const item of metrics) if (normalTile(item.tile || '') === normalTile(candidate.tile || '')) item.lookahead = search.value;
      }
      result = rank(metrics);
      result.searchNodes = nodes;
      result.searchBudget = SEARCH_NODES;
    }
    const best = result.candidates[0];
    // Keep the historical choice intact for deterministic replays of old opponents.
    if (aiVersion < 4) {
      const kan = actions.find(action => action.type === 'kan' && action.meld);
      if (kan && difficulty !== 'novice') {
        const threat = observation.players.some(player => player.id !== observation.ownId && (player.riichi || player.melds.length >= 3));
        const next = hand.clone().gang(kan.meld);
        if (!threat && observation.tilesLeft > 12 && Majiang.Util.xiangting(next) <= best.shanten && safeOpenYaku(next, observation)) return quick(kan, 'call');
      }
    } else if (actions.some(action => action.type === 'kan' && action.meld) && observation.tilesLeft > 12 && !observation.players.some(player => player.id !== observation.ownId && (player.riichi || player.melds.length >= 3))) {
      // Compare the hand before the replacement draw to the best available discard.
      const baseline = [...metrics].sort((a, b) => a.shanten - b.shanten || b.ukeire - a.ukeire)[0];
      let baselineWaits: string[] | undefined;
      for (const kan of actions.filter(action => action.type === 'kan' && action.meld)) {
        const next = hand.clone().gang(kan.meld);
        const distance = Majiang.Util.xiangting(next);
        const viableYaku = safeOpenYaku(next, observation)
          || calibrated && distance === 0 && readyHandMetrics(next, observation, known, '', false).ukeire > 0;
        if (distance > baseline.shanten || !viableYaku) continue;
        if (distance === 0 && baseline.shanten === 0) {
          baselineWaits ??= Majiang.Util.tingpai(hands.get(baseline.key)!) || [];
          const waits = Majiang.Util.tingpai(next) || [];
          if (baselineWaits!.some(tile => !waits.includes(tile))) continue;
        }
        return quick(kan, 'call');
      }
    }
    return result;
  }
  const callCandidates: { action: BotAction; metric: RiichiCandidate }[] = [];
  for (const action of actions.filter(item => item.meld && ['chi', 'pon', 'kan'].includes(item.type))) {
    const next = hand.clone().fulou(action.meld);
    // v2 checked before the mandatory discard, which rejected calls when the
    // only no-yaku obstacle was exactly the tile about to be discarded.
    // Keep that branch intact for deterministic reconstruction of old opponents.
    if (!calibrated && (aiVersion < 3 || action.type === 'kan') && !safeOpenYaku(next, observation)) continue;
    if (action.type === 'kan') {
      if (calibrated) {
        if (observation.tilesLeft > 12 && !observation.players.some(player => player.id !== observation.ownId && player.riichi)
          && Majiang.Util.xiangting(next) <= currentShanten) {
          const metric = basicMetrics(next, action.key, '', observation, known, false, true);
          if (metric.shanten === 0 ? metric.ukeire > 0 : safeOpenYaku(next, observation)) callCandidates.push({ action, metric });
        }
        continue;
      }
      if (observation.tilesLeft > 12 && !observation.players.some(player => player.id !== observation.ownId && player.riichi)
        && Majiang.Util.xiangting(next) < currentShanten) return quick(action, 'call');
      continue;
    }
    for (const discard of next.get_dapai() || []) {
      const after = next.clone().dapai(discard);
      if (!calibrated && aiVersion >= 3 && !safeOpenYaku(after, observation)) continue;
      const candidate = basicMetrics(after, action.key, discard, observation, known, false, calibrated);
      if (calibrated && (candidate.shanten === 0 ? candidate.ukeire === 0 : !safeOpenYaku(after, observation))) continue;
      if (candidate.shanten < currentShanten) callCandidates.push({ action, metric: candidate });
    }
  }
  if (callCandidates.length) {
    if (calibrated && pass) {
      const baseline = basicMetrics(hand, pass.key, '', observation, known, false, true);
      const ranked = rank([...callCandidates.map(item => item.metric), baseline], 'response');
      return { ...ranked, strategy: ranked.key === pass.key ? 'pass' : 'call' };
    }
    const ranked = rank(callCandidates.map(item => item.metric));
    const best = ranked.candidates[0];
    const danger = best.tile ? evaluateDanger(observation, best.tile, known) : { maximumThreat: 0 };
    if (!(difficulty === 'advanced' || difficulty === 'expert') || danger.maximumThreat < .65 || best.shanten === 0 && best.estimatedValue >= 3900) {
      return { ...ranked, strategy: 'call' };
    }
  }
  return quick(pass || actions[0], 'pass');
}
