import type { MeldView, SichuanOptions } from '../types';
import { decompose, shanten } from '../variants/hand';
import { isMcrWinningShape, scoreHand } from '../variants/rules';
import type { HandScore, RuleProfile, ScoringPlayer, ScoreContext } from '../variants/rules';
import { coreHand, countsOf, norm } from '../variants/tiles';
import { normalizeSichuanOptions } from '../variants/sichuan';
import { evaluateDanger, rankPublicCandidates, samplePublicDraws, tileIndex, visibleCounts } from './evaluator';
import { safeOpenYaku } from './riichi';
import type { BotDecision, BotObservation, Difficulty, GenericCandidate } from './types';
import Majiang from '@kobalab/majiang-core';
import { regionalAwardValue, regionalPublicObservation, rankRegionalCandidates } from './regionalEvaluation';
import type { RegionalCandidate } from './regionalEvaluation';

export interface RegionalBotAction {
  key: string;
  type: string;
  tile?: string;
  tiles?: string[];
  consume?: string[];
  index?: number;
  meldIndex?: number;
  kind?: 'concealed' | 'added' | 'open';
}

/** Every field is this player's own state, a legal action, or public table data. */
export interface RegionalBotInput {
  aiVersion?: number;
  observation: BotObservation;
  player: ScoringPlayer;
  profile: RuleProfile;
  actions: RegionalBotAction[];
  difficulty: Difficulty;
  drawn: string | null;
  wildcard?: string;
  sichuan?: SichuanOptions;
  rulesVersion?: 1 | 2;
  exchangeThree?: boolean;
  furiten?: { temporary: boolean; permanent: boolean };
  modelFeatures?: Float32Array;
  focusKeys?: string[];
}

const DECISION_BUDGET: Record<Difficulty, number> = {
  novice: 640,
  standard: 1200,
  advanced: 1800,
  expert: 2400,
};
const KNITTED_PATTERNS = [
  ['m', 'p', 's'], ['m', 's', 'p'], ['p', 'm', 's'],
  ['p', 's', 'm'], ['s', 'm', 'p'], ['s', 'p', 'm'],
].map(suits => [[1, 4, 7], [2, 5, 8], [3, 6, 9]]
  .flatMap((ranks, index) => ranks.map(rank => suits[index] + rank)));

class DecisionBudget {
  used = 0;
  exhausted = false;
  constructor(readonly limit: number) {}
  spend(cost: number, ceiling = this.limit): boolean {
    if (this.used + cost > ceiling) {
      if (this.used + cost > this.limit) this.exhausted = true;
      return false;
    }
    this.used += cost;
    return true;
  }
}

interface HandMetrics extends GenericCandidate {
  hand: string[];
  melds: MeldView[];
  waits: string[];
  qualificationKnown: boolean;
}

function copyPlayer(player: ScoringPlayer, hand: string[], melds: MeldView[]): ScoringPlayer {
  return { ...player, hand, melds, flowers: [...player.flowers] };
}

function shapeValue(hand: string[], melds: MeldView[]): number {
  const counts = countsOf(hand);
  let result = melds.length * 12;
  for (let index = 0; index < counts.length; index++) {
    const count = counts[index];
    if (!count) continue;
    result += count >= 3 ? 12 : count === 2 ? 7 : 0;
    if (index < 27) {
      if (index % 9 < 8 && counts[index + 1]) result += 3;
      if (index % 9 < 7 && counts[index + 2]) result += 1;
    }
  }
  return result;
}

function shallowDistance(input: RegionalBotInput, hand: string[], melds: MeldView[]): number {
  const natural = hand.filter(tile => !input.wildcard || norm(tile) !== norm(input.wildcard));
  const counts = countsOf(natural);
  let formed = melds.length, partial = 0, pair = 0;
  for (let index = 0; index < counts.length && formed < input.profile.sets; index++) {
    while (counts[index] >= 3 && formed < input.profile.sets) { counts[index] -= 3; formed++; }
    if (index < 27 && index % 9 < 7) {
      while (counts[index] && counts[index + 1] && counts[index + 2] && formed < input.profile.sets) {
        counts[index]--; counts[index + 1]--; counts[index + 2]--; formed++;
      }
    }
  }
  for (let index = 0; index < counts.length; index++) {
    if (counts[index] >= 2) {
      counts[index] -= 2;
      if (!pair) pair = 1; else partial++;
    }
    for (const gap of [1, 2]) {
      if (index < 27 && index % 9 + gap < 9 && counts[index] && counts[index + gap]) {
        counts[index]--; counts[index + gap]--; partial++;
      }
    }
  }
  const estimate = input.profile.sets * 2 - formed * 2 - Math.min(partial, input.profile.sets - formed) - pair - (hand.length - natural.length);
  return Math.max(hand.length % 3 === 2 ? -1 : 0, estimate);
}

function ordinaryContext(input: RegionalBotInput, player: ScoringPlayer, tile: string, selfDraw: boolean): ScoreContext {
  const waitingHand = [...player.hand];
  if (selfDraw) {
    const winningIndex = waitingHand.lastIndexOf(tile);
    if (winningIndex >= 0) waitingHand.splice(winningIndex, 1);
  }
  const index = tileIndex(tile);
  const publicCopies = visibleCounts(input.observation)[index] - countsOf(waitingHand)[index];
  return {
    profile: input.profile,
    player: { ...player, ippatsu: false },
    selfDraw,
    winningTile: tile,
    seat: input.observation.seat,
    roundWind: input.observation.roundWind,
    wildcard: input.wildcard,
    dora: input.observation.doraIndicators,
    ura: [],
    lastTile: false,
    kongDraw: false,
    robbingKong: false,
    firstDraw: false,
    heavenlyWin: undefined,
    kongDiscard: false,
    visibleWinningCopies: Math.max(0, publicCopies),
    sichuan: input.sichuan,
    rulesVersion: input.rulesVersion,
  };
}

function awardValue(input: RegionalBotInput, score: HandScore, selfDraw: boolean): number {
  const payers = Math.max(1, (input.observation.activePlayerCount ?? input.observation.playerCount) - 1);
  if (input.profile.id === 'sanma') return score.base;
  if (input.profile.id === 'mcr') return payers * 8 + score.fan * (selfDraw ? payers : 1);
  const perPayer = score.base + (score.sichuanScore?.selfDrawBonus ?? 0);
  return perPayer * (selfDraw ? payers : 1);
}

function combinedValue(ron: number, tsumo: number): number {
  if (!ron) return tsumo * .65;
  if (!tsumo) return ron;
  return ron * .65 + tsumo * .35;
}

/** A bounded route estimate is used until a complete legal wait can be scored. */
function routeValue(input: RegionalBotInput, hand: string[], melds: MeldView[]): number {
  const all = [...hand, ...melds.flatMap(meld => meld.tiles)];
  if (!input.profile.id.startsWith('sichuan')) {
    if (input.profile.id === 'sanma') return input.player.riichi ? 3900 : 2000;
    if (input.profile.id === 'mcr' || input.profile.id === 'hongkong') {
      const counts = countsOf(all);
      const closed = melds.every(meld => meld.concealed);
      const honors = all.filter(tile => tile[0] === 'z').length;
      const dominant = Math.max(...['m', 'p', 's'].map(suit => all.filter(tile => tile[0] === suit).length));
      const pureProgress = Math.max(0, (dominant / Math.max(1, all.length) - .6) / .4);
      const mixedProgress = Math.max(0, ((dominant + honors) / Math.max(1, all.length) - .65) / .35);
      const pungGroups = counts.reduce((total, count) => total + (count >= 3 ? 1 : count === 2 ? .4 : 0), 0);
      const pungProgress = melds.every(meld => meld.type !== 'chi') ? Math.min(1, pungGroups / 4) : 0;
      const mcr = input.profile.id === 'mcr';
      let fan = closed ? mcr ? 4 : 1 : .5;
      fan += Math.max((mcr ? 24 : 7) * pureProgress * pureProgress,
        honors ? (mcr ? 6 : 3) * mixedProgress * mixedProgress : 0,
        (mcr ? 6 : 3) * pungProgress * pungProgress);
      for (const index of [31, 32, 33, 27 + input.observation.seat, 27 + input.observation.roundWind % 4]) {
        fan += counts[index] >= 3 ? mcr ? 2 : 1 : counts[index] === 2 ? .45 : 0;
      }
      const confidence = Math.min(1, (fan / input.profile.minimumFan) ** 2);
      const payers = Math.max(1, (input.observation.activePlayerCount ?? input.observation.playerCount) - 1);
      const ron = mcr ? payers * 8 + Math.max(8, fan) : 2 ** Math.min(10, fan);
      const tsumo = mcr ? payers * (8 + Math.max(8, fan)) : ron * payers;
      return combinedValue(ron, tsumo) * confidence;
    }
    return input.profile.minimumFan ? Math.max(1, 2 ** input.profile.minimumFan) : 4;
  }
  const options = normalizeSichuanOptions(input.sichuan, 2);
  const counts = countsOf(all);
  const suitCount = ['m', 'p', 's'].map(suit => all.filter(tile => tile[0] === suit).length);
  const concentration = Math.max(...suitCount) / Math.max(1, all.length);
  const pureProgress = Math.max(0, Math.min(1, (concentration - .6) / .4));
  const pairs = counts.reduce((total, count) => total + Math.floor(count / 2), 0);
  const triplets = counts.filter(count => count >= 3).length;
  const roots = counts.filter(count => count === 4).length;
  const noSequences = melds.every(meld => meld.type !== 'chi');
  const pungProgress = noSequences ? Math.min(1, (triplets + (pairs - triplets) * .45) / 4) : 0;
  let ordinaryFan = 2 * pureProgress + pungProgress + roots;
  if (options.menqingZhongzhang) {
    if (melds.every(meld => meld.concealed)) ordinaryFan += .8;
    const middle = all.filter(tile => [2, 3, 4, 5, 6, 7, 8].includes(Number(norm(tile)[1]))).length;
    ordinaryFan += Math.max(0, (middle / Math.max(1, all.length) - .75) * 4);
  }
  let expectedFan = ordinaryFan;
  if (!melds.length) {
    const pairProgress = Math.min(1, pairs / 7);
    const sevenFan = roots ? 4 + roots - 1 + pureProgress : 2 + 2 * pureProgress;
    expectedFan = Math.max(expectedFan, sevenFan * pairProgress * pairProgress);
  }
  if (noSequences) {
    const generals = all.filter(tile => [2, 5, 8].includes(Number(norm(tile)[1]))).length / Math.max(1, all.length);
    expectedFan = Math.max(expectedFan, 3 * Math.max(0, (generals - .65) / .35) + 2 * pureProgress + roots);
  }
  const capped = (fan: number) => options.fanCap === 'none' ? fan : Math.min(options.fanCap, fan);
  const ron = 2 ** capped(expectedFan);
  const tsumoFan = expectedFan + (options.selfDraw === 'fan' ? 1 : 0);
  const perPayer = 2 ** capped(tsumoFan) + (options.selfDraw === 'base' ? 1 : 0);
  const payers = Math.max(1, (input.observation.activePlayerCount ?? input.observation.playerCount) - 1);
  return combinedValue(ron, perPayer * payers);
}

function withPublicLossValues(input: RegionalBotInput): BotObservation {
  if (!input.profile.id.startsWith('sichuan')) return input.observation;
  const options = normalizeSichuanOptions(input.sichuan, 2);
  const players = input.observation.players.map(player => {
    const exposed = player.melds.flatMap(meld => (meld.match(/\d/g) ?? []).map(rank => meld[0] + rank));
    const suits = new Set(exposed.map(tile => tile[0]));
    const roots = player.melds.filter(meld => (meld.match(/\d/g) ?? []).length === 4).length;
    const pungs = player.melds.filter(meld => new Set(meld.match(/\d/g) ?? []).size === 1).length;
    let fan = 1 + roots;
    if (player.melds.length >= 2 && suits.size === 1) fan += 2;
    if (pungs >= 2) fan += 1;
    if (options.menqingZhongzhang && !player.melds.some(meld => /[+=-]/.test(meld))) fan += .5;
    const effectiveFan = options.fanCap === 'none' ? fan : Math.min(options.fanCap, fan);
    return { ...player, expectedDealInValue: 2 ** effectiveFan };
  });
  return { ...input.observation, players };
}

function fallbackDecision(input: RegionalBotInput): BotDecision {
  const action = input.actions.find(item => item.type === 'ron' || item.type === 'tsumo')
    ?? input.actions.find(item => item.type === 'pass')
    ?? input.actions.find(item => item.type === 'discard')
    ?? input.actions[0];
  if (!action) throw new Error('AI cannot decide without legal actions.');
  return { key: action.key, difficulty: input.difficulty, strategy: action.type === 'pass' ? 'pass' : 'efficiency', candidates: [], searchNodes: 0, searchBudget: DECISION_BUDGET[input.difficulty] };
}

export function chooseRegionalAction(input: RegionalBotInput): BotDecision {
  if ((input.aiVersion ?? 6) >= 7) {
    try { return evaluateRegionalV7(input); }
    catch { return { ...fallbackDecision(input), provider: 'algorithm' }; }
  }
  try { return evaluateRegionalAction(input); }
  catch { return fallbackDecision(input); }
}

function evaluateRegionalAction(input: RegionalBotInput): BotDecision {
  const complex = input.profile.sets > 4 || !!input.wildcard;
  const minimumBudget = complex ? 2000 : input.profile.id === 'mcr' ? 2400 : 0;
  const budget = new DecisionBudget(Math.max(minimumBudget, DECISION_BUDGET[input.difficulty]));
  const observation = withPublicLossValues(input);
  const known = visibleCounts(observation);
  const universe = (observation.tileLimits ?? Array<number>(34).fill(4))
    .flatMap((limit, index) => limit > 0 ? ['mpsz'[Math.floor(index / 9)] + (index % 9 + 1)] : []);
  const distanceCost = complex ? 32 : 1;
  const shapeCost = input.profile.id === 'mcr' ? 8 : complex ? 16 : 1;
  const handBudget = { spend: () => budget.spend(1 / 128) };
  const distanceCache = new Map<string, number>();
  const shapeCache = new Map<string, string[]>();
  const valueCache = new Map<string, { value: number; waits: string[]; legalWaits: string[]; complete: boolean; legal: boolean }>();
  const handKey = (hand: string[], melds: MeldView[]) => `${hand.slice().sort().join('')}|${JSON.stringify(melds)}`;
  const distance = (hand: string[], melds: MeldView[], ceiling = budget.limit): number | undefined => {
    const key = handKey(hand, melds);
    const cached = distanceCache.get(key);
    if (cached !== undefined) return cached;
    if (!budget.spend(distanceCost, ceiling)) return undefined;
    const result = shanten(hand, melds, input.profile.sets, input.wildcard, input.profile.sevenPairs, input.profile.orphans, handBudget);
    distanceCache.set(key, result);
    return result;
  };
  const mcrPotentialWaits = (hand: string[], melds: MeldView[]): Set<string> => {
    const possible = new Set<string>();
    // Standard, pairs and orphans use the shared decomposition before GB validation.
    for (const tile of universe) {
      if (!budget.spend(1)) return possible;
      if (decompose([...hand, tile], melds, 4, undefined, false, handBudget).length) possible.add(tile);
    }
    if (melds.length > 1) return possible;
    const counts = countsOf(hand);
    const unique = hand.every(tile => counts[tileIndex(tile)] === 1);
    for (const pattern of KNITTED_PATTERNS) {
      if (!melds.length && unique && hand.every(tile => tile[0] === 'z' || pattern.includes(norm(tile)))) {
        for (const tile of [...pattern, ...Array.from({ length: 7 }, (_, index) => `z${index + 1}`)]) {
          if (!counts[tileIndex(tile)]) possible.add(tile);
        }
      }
      const missing = pattern.filter(tile => !counts[tileIndex(tile)]);
      if (missing.length > 1) continue;
      const rest = [...hand];
      for (const tile of pattern) {
        const index = rest.findIndex(candidate => norm(candidate) === tile);
        if (index >= 0) rest.splice(index, 1);
      }
      const candidates = missing.length ? missing : universe;
      for (const tile of candidates) {
        if (!budget.spend(1)) return possible;
        const tail = missing.length ? rest : [...rest, tile];
        if (decompose(tail, [], 1 - melds.length, undefined, false, handBudget).length) possible.add(tile);
      }
    }
    return possible;
  };
  const shapeWaits = (hand: string[], melds: MeldView[]): { waits: string[]; complete: boolean } => {
    const key = handKey(hand, melds);
    const cached = shapeCache.get(key);
    if (cached) return { waits: cached, complete: true };
    const owned = countsOf([...hand, ...melds.flatMap(meld => meld.tiles)]);
    const waits: string[] = [];
    const possible = input.profile.id === 'mcr' ? mcrPotentialWaits(hand, melds) : undefined;
    if (budget.exhausted) return { waits, complete: false };
    for (const tile of universe) {
      if (owned[tileIndex(tile)] >= 4) continue;
      if (possible && !possible.has(tile)) continue;
      if (!budget.spend(shapeCost)) return { waits, complete: false };
      const complete = input.profile.id === 'mcr'
        ? isMcrWinningShape(hand, melds, tile)
        : decompose([...hand, tile], melds, input.profile.sets, input.wildcard, false, handBudget)
          .some(form => (!form.sevenPairs || input.profile.sevenPairs) && (!form.orphans || input.profile.orphans));
      if (complete) waits.push(tile);
      if (budget.exhausted) return { waits, complete: false };
    }
    shapeCache.set(key, waits);
    return { waits, complete: true };
  };
  const value = (hand: string[], melds: MeldView[], riichi: boolean): { value: number; waits: string[]; legalWaits: string[]; complete: boolean; legal: boolean } => {
    const key = `${handKey(hand, melds)}|${riichi}`;
    const cached = valueCache.get(key);
    if (cached) return cached;
    const shape = shapeWaits(hand, melds);
    const legalWaits: string[] = [];
    let total = 0, amount = 0, legal = false, complete = shape.complete;
    for (const tile of shape.waits) {
      const remaining = Math.max(0, (observation.tileLimits?.[tileIndex(tile)] ?? 4) - known[tileIndex(tile)]);
      if (!remaining) continue;
      if (!budget.spend(complex ? 32 : input.profile.id === 'mcr' ? 16 : 8)) { complete = false; break; }
      const player = { ...copyPlayer(input.player, hand, melds), riichi };
      const ron = scoreHand(ordinaryContext(input, player, tile, false), undefined, handBudget);
      const tsumo = scoreHand(ordinaryContext(input, { ...player, hand: [...hand, tile] }, tile, true), undefined, handBudget);
      if (budget.exhausted) complete = false;
      const ronValue = ron ? awardValue(input, ron, false) : 0;
      const tsumoValue = tsumo ? awardValue(input, tsumo, true) : 0;
      if (ronValue || tsumoValue) { legal = true; legalWaits.push(tile); }
      total += combinedValue(ronValue, tsumoValue) * remaining;
      amount += remaining;
    }
    const estimate = amount ? total / amount : routeValue(input, hand, melds);
    const result = { value: complete && !legal ? 0 : estimate, waits: shape.waits, legalWaits, complete, legal };
    valueCache.set(key, result);
    return result;
  };
  const canBeSpecialMcr = (hand: string[], melds: MeldView[]) => {
    if (input.profile.id !== 'mcr' || melds.length > 1) return false;
    const counts = countsOf(hand);
    const unique = hand.every(tile => counts[tileIndex(tile)] === 1);
    return KNITTED_PATTERNS.some(pattern => pattern.filter(tile => !counts[tileIndex(tile)]).length <= 1
      || !melds.length && unique && hand.every(tile => tile[0] === 'z' || pattern.includes(norm(tile))));
  };
  const metricsFor = (hand: string[], melds: MeldView[], key: string, tile?: string, riichi = input.player.riichi, scoreReady = true): HandMetrics | undefined => {
    const measured = distance(hand, melds);
    if (measured === undefined && scoreReady) return undefined;
    const count = measured ?? shallowDistance(input, hand, melds);
    let effectiveDistance = count;
    let estimatedValue = routeValue(input, hand, melds);
    let ukeire = 0;
    let waits: string[] = [], qualificationKnown = false;
    if (scoreReady && (count === 0 || canBeSpecialMcr(hand, melds))) {
      const evaluated = value(hand, melds, riichi);
      waits = evaluated.waits;
      qualificationKnown = evaluated.complete;
      estimatedValue = evaluated.value;
      ukeire = evaluated.legalWaits.reduce((total, tile) => total + Math.max(0,
        (observation.tileLimits?.[tileIndex(tile)] ?? 4) - known[tileIndex(tile)]), 0);
      if (waits.length) effectiveDistance = evaluated.complete && !evaluated.legal ? 1 : 0;
    }
    return { key, tile, hand, melds, shanten: effectiveDistance, ukeire, estimatedValue,
      shapeScore: shapeValue(hand, melds), waits, qualificationKnown };
  };
  const addUkeire = (metrics: HandMetrics[], ceiling: number) => {
    for (const tile of universe) {
      const remaining = Math.max(0, (observation.tileLimits?.[tileIndex(tile)] ?? 4) - known[tileIndex(tile)]);
      if (!remaining) continue;
      for (const metric of metrics) {
        if (metric.waits.length || metric.qualificationKnown) continue;
        const next = distance([...metric.hand, tile], metric.melds, ceiling);
        if (next !== undefined && next < metric.shanten) metric.ukeire += remaining;
      }
    }
  };
  const resultFor = (metrics: HandMetrics[], strategy?: BotDecision['strategy']) => {
    const result = rankPublicCandidates(observation, metrics, input.difficulty);
    return { ...result, ...(strategy ? { strategy } : {}), searchNodes: Math.ceil(budget.used), searchBudget: budget.limit };
  };
  const quick = input.actions.find(action => action.type === 'ron' || action.type === 'tsumo')
    ?? input.actions.find(action => action.type === 'kita');
  if (quick) return { ...fallbackDecision({ ...input, actions: [quick] }), strategy: quick.type === 'kita' ? 'call' : 'win' };

  const seen = new Set<string>();
  const discards = input.actions.filter(action => {
    if (action.type !== 'discard' && action.type !== 'riichi') return false;
    const identity = `${action.type}:${action.tile}:${input.drawn && action.index === input.player.hand.length - 1 ? 'draw' : 'hand'}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  if (discards.length) {
    // Score every distinct legal discard before spending on optional lookahead.
    const metrics = discards.flatMap(action => {
      if (action.index == null) return [];
      const hand = input.player.hand.filter((_, index) => index !== action.index);
      const metric = metricsFor(hand, input.player.melds, action.key, action.tile, action.type === 'riichi' || input.player.riichi, false);
      return metric ? [metric] : [];
    });
    if (!metrics.length) return fallbackDecision(input);
    // The mandatory shape pass above makes every legal discard comparable.
    // Kan evaluation precedes optional value and lookahead work so it cannot be starved.
    const baseline = [...metrics].sort((a, b) => a.shanten - b.shanten || b.ukeire - a.ukeire)[0];
    const threatened = observation.players.some(player => player.id !== observation.ownId && player.active !== false
      && (player.riichi || player.melds.filter(meld => /[+=-]/.test(meld)).length >= 3));
    for (const action of input.actions.filter(item => item.type === 'kan' && (item.kind === 'concealed' || item.kind === 'added'))) {
      if (observation.tilesLeft <= (input.profile.id === 'sanma' ? 12 : 4)) continue;
      if (threatened && (action.kind === 'added' || input.profile.id === 'sanma')) continue;
      const transformed = afterCall(input.player, action);
      if (!transformed) continue;
      const next = metricsFor(transformed.hand, transformed.melds, action.key);
      if (!next || next.shanten > baseline.shanten) continue;
      if (baseline.shanten === 0) {
        const beforeWaits = shapeWaits(baseline.hand, baseline.melds);
        const afterWaits = shapeWaits(next.hand, next.melds);
        if (!beforeWaits.complete || !afterWaits.complete || beforeWaits.waits.some(tile => !afterWaits.waits.includes(tile))) continue;
      }
      return resultFor([next], 'call');
    }
    for (let index = 0; index < metrics.length; index++) {
      const metric = metrics[index];
      if (metric.shanten !== 0 && !canBeSpecialMcr(metric.hand, metric.melds)) continue;
      const action = discards.find(item => item.key === metric.key)!;
      const evaluated = metricsFor(metric.hand, metric.melds, metric.key, metric.tile, action.type === 'riichi' || input.player.riichi);
      if (evaluated) metrics[index] = evaluated;
    }
    addUkeire(metrics, Math.floor(budget.limit * .72));
    const ranked = resultFor(metrics);
    if (input.difficulty === 'expert' && !budget.exhausted && budget.used < budget.limit * .95) {
      const best = ranked.candidates.slice(0, 3);
      const sequences = samplePublicDraws(observation, 2, 2);
      for (const candidate of best) {
        const metric = metrics.find(item => item.key === candidate.key)!;
        if (metric.shanten === 0 || metric.qualificationKnown) continue;
        let gain = 0, trials = 0;
        for (const sequence of sequences) {
          let hand = [...metric.hand], latest = metric.shanten;
          for (const tile of sequence) {
            const drawn = [...hand, tile];
            let bestDistance = latest, kept: string[] | undefined;
            const indices = legalDiscardIndices(input.player, drawn);
            indices.sort((a, b) => Number(b === drawn.length - 1) - Number(a === drawn.length - 1));
            for (const index of indices) {
              const after = drawn.filter((_, at) => at !== index);
              const next = distance(after, metric.melds);
              if (next !== undefined && (!kept || next < bestDistance)) { bestDistance = next; kept = after; }
            }
            if (!kept) break;
            hand = kept;
            latest = bestDistance;
          }
          gain += metric.shanten - latest;
          trials++;
        }
        metric.lookahead = gain / Math.max(1, trials) * (input.profile.id === 'sanma' ? 350 : .35);
      }
      return resultFor(metrics);
    }
    return { ...ranked, searchNodes: Math.ceil(budget.used), searchBudget: budget.limit };
  }

  const pass = input.actions.find(action => action.type === 'pass');
  const baseline = metricsFor(input.player.hand, input.player.melds, pass?.key ?? input.actions[0].key);
  if (!baseline) return fallbackDecision(input);
  const candidates = [baseline];
  addUkeire(candidates, Math.floor(budget.limit * .25));
  for (const action of input.actions.filter(item => ['chi', 'pon', 'kan'].includes(item.type))) {
    if (input.profile.id === 'sanma' && observation.players.some(player => player.id !== observation.ownId && player.riichi)) continue;
    const transformed = afterCall(input.player, action);
    if (!transformed) continue;
    const options: HandMetrics[] = [];
    const indices = action.type === 'kan' ? [-1] : legalDiscardIndices(input.player, transformed.hand);
    for (const index of indices) {
      const after = index < 0 ? transformed.hand : transformed.hand.filter((_, at) => at !== index);
      if (input.profile.id === 'sanma' && !safeOpenYaku(coreHand(after, transformed.melds), observation)) continue;
      const metric = metricsFor(after, transformed.melds, action.key, index < 0 ? undefined : transformed.hand[index]);
      if (metric && !(metric.qualificationKnown && metric.waits.length && metric.estimatedValue === 0)) options.push(metric);
    }
    if (!options.length) continue;
    addUkeire(options, Math.floor(budget.limit * .9));
    const ranked = rankPublicCandidates(observation, options, input.difficulty);
    const best = options.find(option => option.key === ranked.key && option.tile === ranked.candidates[0].tile) ?? options[0];
    const needsOpen = ['wuhan', 'northeast'].includes(input.profile.id) && input.player.melds.every(meld => meld.concealed);
    const minimumAward = input.profile.id === 'mcr' ? 32 : 2 ** input.profile.minimumFan;
    if (input.profile.minimumFan > 0 && best.estimatedValue < minimumAward * .2) continue;
    if (best.shanten > baseline.shanten && !needsOpen) continue;
    if (evaluateDanger(observation, best.tile ?? action.tile ?? 'z1').maximumThreat >= .65 && best.shanten > 0 && input.difficulty !== 'novice') continue;
    candidates.push(best);
  }
  const result = resultFor(candidates);
  return { ...result, strategy: result.key === pass?.key ? 'pass' : 'call' };
}

function evaluateRegionalV7(input: RegionalBotInput): BotDecision {
  if (!input.actions.length) throw new Error('AI cannot decide without legal actions.');
  const win = input.actions.find(action => action.type === 'ron' || action.type === 'tsumo');
  if (win) return { key: win.key, difficulty: input.difficulty, strategy: 'win', candidates: [], searchNodes: 0, searchBudget: 0, provider: 'algorithm' };
  const observation = regionalPublicObservation({ ...input, observation: withPublicLossValues(input) });
  input = { ...input, observation };
  const known = visibleCounts(observation);
  const universe = (observation.tileLimits || Array<number>(34).fill(4))
    .flatMap((limit, index) => limit ? ['mpsz'[Math.floor(index / 9)] + (index % 9 + 1)] : []);
  interface State { action: RegionalBotAction; hand: string[]; melds: MeldView[]; player: ScoringPlayer; discard?: string; immediateGain: number }
  const states: State[] = [];
  const add = (action: RegionalBotAction, hand: string[], melds: MeldView[], discard?: string, kita = input.player.kita) => {
    const player = { ...copyPlayer(input.player, hand, melds), kita,
      riichi: input.player.riichi || action.type === 'riichi' };
    const payers = Math.max(1, (observation.activePlayerCount ?? observation.playerCount) - 1);
    const immediateGain = input.profile.id.startsWith('sichuan') && action.type === 'kan'
      ? action.kind === 'open' ? 2 : action.kind === 'concealed' ? payers * 2 : payers : 0;
    states.push({ action, hand, melds, player, discard, immediateGain });
  };
  for (const action of input.actions) {
    if (action.type === 'discard' || action.type === 'riichi') {
      if (action.index != null) add(action, input.player.hand.filter((_, index) => index !== action.index), input.player.melds, action.tile);
    } else if (action.type === 'pass') add(action, [...input.player.hand], input.player.melds);
    else if (action.type === 'kita') {
      const hand = [...input.player.hand], north = hand.indexOf('z4');
      if (north >= 0) { hand.splice(north, 1); add(action, hand, input.player.melds, undefined, input.player.kita + 1); }
    } else if (['chi', 'pon', 'kan'].includes(action.type)) {
      const after = afterCall(input.player, action);
      if (!after) continue;
      if (action.type === 'kan') add(action, after.hand, after.melds);
      else for (const index of legalDiscardIndices(input.player, after.hand)) {
        add(action, after.hand.filter((_, at) => at !== index), after.melds, after.hand[index]);
      }
    }
  }
  const distinct = new Map<string, State>();
  for (const state of states) {
    const action = state.action;
    const signature = [action.type, action.kind, state.hand.slice().sort().join(''), JSON.stringify(state.melds), state.discard,
      state.player.riichi, state.player.kita].join('|');
    const previous = distinct.get(signature);
    if (!previous || action.key.localeCompare(previous.action.key) < 0) distinct.set(signature, state);
  }
  const choices = [...distinct.values()].sort((a, b) => a.action.key.localeCompare(b.action.key) || (a.discard || '').localeCompare(b.discard || ''));
  if (!choices.length) return { ...fallbackDecision(input), provider: 'algorithm' };
  const complex = input.profile.sets > 4 || !!input.wildcard;
  const limit = Math.max(complex ? 2400 : input.profile.id === 'mcr' ? 2400 : 0, DECISION_BUDGET[input.difficulty]);
  const focused = new Set(input.focusKeys || []);
  const focusCount = choices.filter(state => focused.has(state.action.key)).length;
  const baseBudget = focusCount ? limit / 2 : limit;
  let used = 0;
  const metrics: RegionalCandidate[] = choices.map(state => {
    // Each complete candidate receives its own allowance. Input enumeration never owns the shared remainder.
    const allowance = Math.floor(baseBudget / choices.length + (focused.has(state.action.key) ? (limit - baseBudget) / focusCount : 0));
    const budget = new DecisionBudget(allowance);
    const handBudget = { spend: () => budget.spend(1 / 128) };
    const distance = (tiles: string[]) => {
      if (!budget.spend(1)) return undefined;
      const result = shanten(tiles, state.melds, input.profile.sets, input.wildcard, input.profile.sevenPairs, input.profile.orphans, handBudget);
      return budget.exhausted ? undefined : result;
    };
    const measured = distance(state.hand);
    // A 3n+1 wildcard hand can return -1 from the structural estimate. It still needs a real winning draw.
    const structural = Math.max(0, measured ?? shallowDistance(input, state.hand, state.melds));
    let effectiveDistance = structural;
    let ukeire = 0, ronUkeire = 0, tsumoUkeire = 0, ronValue = 0, tsumoValue = 0;
    let estimatedValue = routeValue(input, state.hand, state.melds);
    const specialWaits = new Set<string>();
    if (input.profile.id === 'mcr' && state.melds.length <= 1) {
      const counts = countsOf(state.hand);
      const unique = state.hand.every(tile => counts[tileIndex(tile)] === 1);
      for (const pattern of KNITTED_PATTERNS) {
        if (!state.melds.length && unique && state.hand.every(tile => tile[0] === 'z' || pattern.includes(norm(tile)))) {
          for (const tile of [...pattern, ...Array.from({ length: 7 }, (_, index) => `z${index + 1}`)]) {
            if (!counts[tileIndex(tile)]) specialWaits.add(tile);
          }
        }
        const missing = pattern.filter(tile => !counts[tileIndex(tile)]);
        if (missing.length > 1) continue;
        const tail = [...state.hand];
        for (const tile of pattern) {
          const index = tail.findIndex(owned => norm(owned) === tile);
          if (index >= 0) tail.splice(index, 1);
        }
        for (const tile of missing.length ? missing : universe) {
          const completed = missing.length ? tail : [...tail, tile];
          if (decompose(completed, [], 1 - state.melds.length, undefined, false, handBudget).length) specialWaits.add(tile);
        }
      }
    }
    const specialMcr = specialWaits.size > 0;
    if (structural === 0 || specialMcr) {
      let possible = universe;
      if (!complex) {
        const hand = coreHand(state.hand, state.melds);
        possible = Majiang.Util.tingpai(hand, (candidate: any) => Math.min(Majiang.Util.xiangting_yiban(candidate),
          input.profile.sevenPairs ? Majiang.Util.xiangting_qidui(candidate) : Infinity,
          input.profile.orphans ? Majiang.Util.xiangting_guoshi(candidate) : Infinity)) || [];
        possible = [...new Set([...possible, ...specialWaits])].sort();
      }
      const owned = countsOf([...state.hand, ...state.melds.flatMap(meld => meld.tiles)]);
      const waits: string[] = [];
      for (const tile of possible) {
        if (owned[tileIndex(tile)] >= (observation.tileLimits?.[tileIndex(tile)] ?? 4)) continue;
        if (!budget.spend(input.profile.id === 'mcr' ? 4 : 1)) break;
        const shape = input.profile.id === 'mcr' ? isMcrWinningShape(state.hand, state.melds, tile)
          : decompose([...state.hand, tile], state.melds, input.profile.sets, input.wildcard, false, handBudget)
            .some(form => (!form.sevenPairs || input.profile.sevenPairs) && (!form.orphans || input.profile.orphans));
        if (shape) waits.push(tile);
        if (budget.exhausted) break;
      }
      const ownRiver = observation.players.find(player => player.id === observation.ownId)?.discards || [];
      const furiten = input.profile.id === 'sanma' && (input.furiten?.temporary || input.furiten?.permanent
        || waits.some(tile => norm(state.discard || '') === tile || ownRiver.some(discard => norm(discard.tile) === tile)));
      let ronTotal = 0, tsumoTotal = 0;
      for (const tile of waits) {
        const remaining = Math.max(0, (observation.tileLimits?.[tileIndex(tile)] ?? 4) - known[tileIndex(tile)]);
        if (!remaining) continue;
        if (!budget.spend(input.profile.id === 'mcr' ? 8 : 2)) break;
        const ron = furiten ? null : scoreHand(ordinaryContext(input, state.player, tile, false), undefined, handBudget);
        const tsumoPlayer = { ...state.player, hand: [...state.hand, tile] };
        const tsumo = scoreHand(ordinaryContext(input, tsumoPlayer, tile, true), undefined, handBudget);
        if (budget.exhausted) break;
        const ronAward = ron ? regionalAwardValue(input, ron, false) : 0;
        const tsumoAward = tsumo ? regionalAwardValue(input, tsumo, true) : 0;
        if (ronAward || tsumoAward) ukeire += remaining;
        if (ronAward) { ronUkeire += remaining; ronTotal += ronAward * remaining; }
        if (tsumoAward) { tsumoUkeire += remaining; tsumoTotal += tsumoAward * remaining; }
      }
      if (!budget.exhausted) {
        ronValue = ronUkeire ? ronTotal / ronUkeire : 0;
        tsumoValue = tsumoUkeire ? tsumoTotal / tsumoUkeire : 0;
        estimatedValue = combinedValue(ronValue, tsumoValue);
        effectiveDistance = ukeire ? 0 : Math.max(1, structural);
      } else {
        // No partial wait prefix becomes a complete legal hand or a zero-fan verdict.
        ukeire = ronUkeire = tsumoUkeire = 0;
        effectiveDistance = Math.max(1, structural);
      }
    } else {
      let complete = true;
      for (const tile of universe) {
        const remaining = Math.max(0, (observation.tileLimits?.[tileIndex(tile)] ?? 4) - known[tileIndex(tile)]);
        if (!remaining) continue;
        const next = distance([...state.hand, tile]);
        if (next === undefined) { complete = false; break; }
        if (next < structural) ukeire += remaining;
      }
      if (!complete) ukeire = 0;
    }
    used += budget.used;
    return { key: state.action.key, tile: state.discard, hand: state.hand, shanten: effectiveDistance, ukeire,
      estimatedValue, shapeScore: shapeValue(state.hand, state.melds), ronUkeire, tsumoUkeire, ronValue, tsumoValue,
      riichiDeclaration: state.action.type === 'riichi', immediateGain: state.immediateGain };
  });
  const ranked = rankRegionalCandidates(input, metrics);
  const selected = input.actions.find(action => action.key === ranked.key)!;
  return { ...ranked, strategy: selected.type === 'pass' ? 'pass' : ['chi', 'pon', 'kan', 'kita'].includes(selected.type) ? 'call' : ranked.strategy,
    searchNodes: Math.ceil(used), searchBudget: limit };
}

function legalDiscardIndices(player: ScoringPlayer, hand: string[]): number[] {
  const mustVoid = !!player.voidSuit && hand.some(tile => tile[0] === player.voidSuit);
  return hand.flatMap((tile, index) => {
    if (mustVoid && tile[0] !== player.voidSuit) return [];
    if (player.riichi && index !== hand.length - 1) return [];
    return [index];
  });
}

function afterCall(player: ScoringPlayer, action: RegionalBotAction): { hand: string[]; melds: MeldView[] } | undefined {
  const hand = [...player.hand];
  const melds = player.melds.map(meld => ({ ...meld, tiles: [...meld.tiles] }));
  const removed: string[] = [];
  const consume = action.kind === 'concealed' ? Array<string>(4).fill(action.tile!)
    : action.kind === 'added' ? [action.tile!] : action.consume ?? [];
  for (const tile of consume) {
    const exact = hand.indexOf(tile);
    const index = exact >= 0 ? exact : hand.findIndex(candidate => norm(candidate) === norm(tile));
    if (index < 0) return undefined;
    removed.push(...hand.splice(index, 1));
  }
  if (action.kind === 'added') {
    const meld = melds[action.meldIndex!];
    if (!meld || meld.type !== 'pon') return undefined;
    meld.type = 'kan';
    meld.tiles.push(...removed);
  } else {
    melds.push({ id: 'candidate', type: action.type === 'kan' ? 'kan' : action.type === 'pon' ? 'pon' : 'chi',
      tiles: action.kind === 'concealed' ? removed : [...(action.tiles ?? [])], concealed: action.kind === 'concealed' });
  }
  return { hand, melds };
}
