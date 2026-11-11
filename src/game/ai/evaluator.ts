import type { BotDecision, BotObservation, CandidateMetrics, Difficulty, GenericCandidate, PublicOpponent } from './types';

export const TILE_TYPES = ['m', 'p', 's', 'z'].flatMap(suit => Array.from({ length: suit === 'z' ? 7 : 9 }, (_, index) => `${suit}${index + 1}`));

export function normalTile(tile: string): string { return tile.slice(0, 2).replace('0', '5'); }
export function tileIndex(tile: string): number {
  const suit = 'mpsz'.indexOf(tile[0]);
  const rank = Number(tile[1]) || 5;
  return suit < 0 || rank < 1 || rank > (suit === 3 ? 7 : 9) ? -1 : suit * 9 + rank - 1;
}
export function parseConcealed(hand: string): string[] {
  return (hand.split(',')[0].match(/[mpsz]\d+/g) || []).flatMap(group => [...group.slice(1)].map(rank => group[0] + rank));
}
export function parseMeld(meld: string): string[] { return (meld.match(/\d/g) || []).map(rank => meld[0] + rank); }

export function visibleCounts(observation: BotObservation): number[] {
  const counts = Array<number>(34).fill(0);
  const add = (tile: string) => { const index = tileIndex(tile); if (index >= 0) counts[index]++; };
  parseConcealed(observation.ownHand).forEach(add);
  for (const player of observation.players) {
    player.discards.filter(discard => !discard.called).forEach(discard => add(discard.tile));
    player.melds.flatMap(parseMeld).forEach(add);
  }
  observation.doraIndicators.forEach(add);
  (observation.additionalPublicTiles || []).forEach(add);
  return counts.map((count, index) => Math.min(observation.tileLimits?.[index] ?? 4, count));
}

export function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

/** Shared regional search input: hypothetical own draws drawn without replacement from unseen public counts. */
export function samplePublicDraws(observation: BotObservation, trials = 4, depth = 2): string[][] {
  const known = visibleCounts(observation);
  const random = seededRandom(`${observation.seed}:lookahead`);
  const samples: string[][] = [];
  for (let trial = 0; trial < Math.max(0, Math.min(16, trials)); trial++) {
    const available = known.map((count, index) => Math.max(0, (observation.tileLimits?.[index] ?? 4) - count));
    const sequence: string[] = [];
    for (let step = 0; step < Math.max(0, Math.min(4, depth)); step++) {
      const amount = available.reduce((sum, count) => sum + count, 0);
      if (!amount) break;
      let target = Math.floor(random() * amount), index = 0;
      for (; index < 33; index++) { if (target < available[index]) break; target -= available[index]; }
      available[index]--;
      sequence.push(TILE_TYPES[index]);
    }
    samples.push(sequence);
  }
  return samples;
}

function opponentThreat(opponent: PublicOpponent, tilesLeft: number): number {
  if (opponent.riichi) return 1;
  const open = opponent.melds.filter(meld => /[+=-]/.test(meld)).length;
  if (open >= 3) return .82;
  if (open === 2) return tilesLeft < 28 ? .64 : .43;
  if (open === 1) return tilesLeft < 20 ? .3 : .12;
  return tilesLeft < 16 ? .13 : .025;
}

/** A public-information danger estimate, not a calibrated probability or an opponent-hand reconstruction. */
export function evaluateDanger(observation: BotObservation, tile: string, known = visibleCounts(observation)) {
  let survival = 1;
  let expectedLoss = 0;
  let maximumThreat = 0;
  const key = normalTile(tile), suit = key[0], rank = Number(key[1]);
  for (const opponent of observation.players) {
    if (opponent.id === observation.ownId || opponent.active === false || opponent.voidSuit === suit) continue;
    const threat = opponentThreat(opponent, observation.tilesLeft);
    maximumThreat = Math.max(maximumThreat, threat);
    // Permanent furiten makes every tile in this player's own river safe against their ron.
    if (observation.discardFuriten && opponent.discards.some(discard => normalTile(discard.tile) === key)) continue;
    let danger = suit === 'z' ? .115 : rank >= 3 && rank <= 7 ? .19 : .125;
    const seen = known[tileIndex(tile)] || 0;
    if (suit === 'z') {
      danger *= observation.wildcards?.length ? [1, .95, .8, .65, .45][seen] : [1, .95, .63, .24, 0][seen];
      if ([5, 6, 7, opponent.seat + 1, observation.roundWind + 1].includes(rank)) danger *= 1.2;
    } else {
      const river = new Set(opponent.discards.filter(discard => !discard.riichi).map(discard => normalTile(discard.tile)));
      const leftSuji = rank > 3 && river.has(suit + (rank - 3));
      const rightSuji = rank < 7 && river.has(suit + (rank + 3));
      if (observation.discardFuriten) {
        if (rank <= 3 && rightSuji || rank >= 7 && leftSuji || leftSuji && rightSuji) danger *= .36;
        else if (leftSuji || rightSuji) danger *= .7;
      }
      const possibleShapes = [[rank - 2, rank - 1], [rank - 1, rank + 1], [rank + 1, rank + 2]]
        .filter(shape => shape.every(number => number >= 1 && number <= 9));
      const unblocked = possibleShapes.filter(shape => shape.every(number => known[tileIndex(suit + number)] < (observation.tileLimits?.[tileIndex(suit + number)] ?? 4))).length;
      if (!observation.wildcards?.length) {
        if (unblocked === 0) danger *= .27;
        else if (unblocked < possibleShapes.length) danger *= .65;
      }
      // Public flush signals: two or more open melds in one suit, with no other suited melds.
      const suitedMelds = opponent.melds.filter(meld => /^[mps]/.test(meld));
      if (suitedMelds.length >= 2 && suitedMelds.every(meld => meld[0] === suitedMelds[0][0])) {
        danger *= suit === suitedMelds[0][0] ? 1.6 : .32;
      }
    }
    danger = Math.min(.42, danger * threat);
    const redCount = opponent.melds.join('').split('0').length - 1;
    const scale = observation.pointScale ?? 1;
    const loss = (opponent.expectedDealInValue ?? observation.expectedDealInValue ?? 4000 * scale) * (opponent.dealer ? observation.dealerValueMultiplier ?? 1.5 : 1)
      + redCount * 1200 * scale + observation.honba * 300 * scale;
    survival *= 1 - danger;
    expectedLoss += danger * loss;
  }
  const risk = 1 - survival;
  return { risk, expectedLoss, lossIfDealIn: risk > 0 ? expectedLoss / risk : 0, maximumThreat };
}

function placementProtection(observation: BotObservation): number {
  if (!observation.finalRound) return 1;
  const scores = observation.players.map(player => player.points).sort((a, b) => b - a);
  const own = observation.players.find(player => player.id === observation.ownId)?.points || 0;
  const scale = observation.pointScale ?? 1;
  if (own === scores[0] && scores[0] - scores[1] >= 6000 * scale) return 1.6;
  if (own === scores[scores.length - 1] && scores[scores.length - 2] - own >= 3000 * scale) return .62;
  return 1.1;
}

export function rankPublicCandidates(observation: BotObservation, candidates: GenericCandidate[], difficulty: Difficulty): BotDecision {
  if (!candidates.length) throw new Error('AI requires at least one legal candidate.');
  const known = visibleCounts(observation);
  const activePlayerCount = observation.activePlayerCount ?? observation.playerCount;
  const ownDraws = Math.max(1, observation.tilesLeft / Math.max(1, activePlayerCount));
  const totalTiles = observation.tileLimits?.reduce((sum, value) => sum + value, 0) ?? 136;
  const unseen = Math.max(1, totalTiles - known.reduce((sum, value) => sum + value, 0));
  const scale = observation.pointScale ?? 1;
  const protection = placementProtection(observation);
  const metrics: CandidateMetrics[] = candidates.map(candidate => {
    const threat = candidate.tile ? evaluateDanger(observation, candidate.tile, known) : { risk: 0, expectedLoss: 0, lossIfDealIn: 0, maximumThreat: 0 };
    const probabilityImprove = 1 - Math.pow(1 - Math.min(.9, candidate.ukeire / unseen), Math.min(ownDraws, 8));
    const probabilityWin = candidate.shanten < 0 ? 1 : probabilityImprove * [ .65, .24, .065, .016 ][Math.min(3, Math.max(0, candidate.shanten))];
    const efficiency = (-candidate.shanten * 760 + candidate.ukeire * 10) * scale;
    let score: number;
    if (difficulty === 'novice') score = candidate.shapeScore ?? -candidate.shanten * 80 + candidate.ukeire;
    else if (difficulty === 'standard') score = -candidate.shanten * 10000 + candidate.ukeire * 10 + Math.log2(Math.max(1, candidate.estimatedValue)) * 2;
    else {
      const valueGain = probabilityWin * candidate.estimatedValue;
      const defending = threat.maximumThreat >= .6 && candidate.shanten >= 2 && valueGain < 450 * scale;
      score = efficiency * (defending ? .12 : .72) + valueGain
        - threat.expectedLoss * protection * (defending ? 1.8 : candidate.shanten === 0 ? .75 : 1.25);
      if (difficulty === 'expert') score += candidate.lookahead || 0;
    }
    return { key: candidate.key, tile: candidate.tile, shanten: candidate.shanten, ukeire: candidate.ukeire,
      estimatedValue: candidate.estimatedValue, risk: threat.risk, lossIfDealIn: threat.lossIfDealIn, score,
      ...(candidate.lookahead == null ? {} : { lookahead: candidate.lookahead }) };
  });
  metrics.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const winner = metrics[0];
  const bestShanten = Math.min(...metrics.map(candidate => candidate.shanten));
  const folding = winner.shanten > bestShanten && winner.risk < .025;
  return { key: winner.key, difficulty, strategy: difficulty === 'novice' ? 'shape' : difficulty === 'standard' ? 'efficiency' : folding ? 'fold' : difficulty === 'expert' && candidates.some(candidate => candidate.lookahead != null) ? 'search' : 'attack', candidates: metrics, searchNodes: 0, searchBudget: 0 };
}
