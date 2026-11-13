import { shanten } from '../../variants/hand';
import { scoreHand } from '../../variants/rules';
import { countsOf, coreString } from '../../variants/tiles';
import { normalizeSichuanOptions, sichuanFlowerPigPayment } from '../../variants/sichuan';
import { visibleCounts } from '../evaluator';
import { ordinaryContext, routeValue, withPublicLossValues } from '../regional';
import type { RegionalBotAction, RegionalBotInput } from '../regional';
import { rankRegionalCandidates, regionalAwardValue, regionalPublicObservation } from '../regionalEvaluation';
import type { RegionalCandidate } from '../regionalEvaluation';
import type { BotDecision, CandidateMetrics } from '../types';

class ValueBudget {
  used = 0;
  complete = true;
  constructor(readonly limit: number) {}
  spend(cost = 1): boolean {
    if (this.used + cost > this.limit) { this.complete = false; return false; }
    this.used += cost;
    return true;
  }
}

interface HandValue extends RegionalCandidate {
  legalReady: boolean;
  maximumRon: number;
  voidTiles: number;
}

export interface SichuanValueState {
  decision: BotDecision;
  actions: RegionalBotAction[];
  values: Map<string, HandValue>;
  available: number[];
  input: RegionalBotInput;
}

function measureHand(input: RegionalBotInput, hand: string[], key: string, tile: string | undefined,
  available: number[], budget: ValueBudget, shallow?: CandidateMetrics): HandValue {
  const distance = (tiles: string[]) => budget.spend() ? shanten(tiles, input.player.melds, 4, undefined, true, false) : Infinity;
  const structural = distance(hand);
  const voidTiles = hand.filter(tile => tile[0] === input.player.voidSuit).length;
  let ukeire = shallow?.ukeire ?? 0, ronUkeire = 0, tsumoUkeire = 0, ronTotal = 0, tsumoTotal = 0, maximumRon = 0;
  let legalReady = false;
  const owned = countsOf([...hand, ...input.player.melds.flatMap(meld => meld.tiles)]);
  const player = { ...input.player, hand };
  if (structural === 0 && !voidTiles) {
    ukeire = 0;
    for (let index = 0; index < 27 && budget.complete; index++) {
      if (owned[index] >= (input.observation.tileLimits?.[index] ?? 4)) continue;
      const draw = 'mps'[Math.floor(index / 9)] + (index % 9 + 1);
      if (distance([...hand, draw]) >= 0) continue;
      if (!budget.spend(2)) break;
      const internal = { spend: () => budget.spend(1 / 128) };
      const ron = scoreHand(ordinaryContext(input, player, draw, false), undefined, internal);
      const tsumo = scoreHand(ordinaryContext(input, { ...player, hand: [...hand, draw] }, draw, true), undefined, internal);
      const ronAward = ron ? regionalAwardValue(input, ron, false) : 0;
      const tsumoAward = tsumo ? regionalAwardValue(input, tsumo, true) : 0;
      if (ronAward || tsumoAward) legalReady = true;
      maximumRon = Math.max(maximumRon, ronAward);
      const copies = available[index];
      if (ronAward || tsumoAward) ukeire += copies;
      if (ronAward) { ronUkeire += copies; ronTotal += copies * ronAward; }
      if (tsumoAward) { tsumoUkeire += copies; tsumoTotal += copies * tsumoAward; }
    }
  } else if (!shallow) {
    for (let index = 0; index < 27 && budget.complete; index++) {
      if (!available[index]) continue;
      const draw = 'mps'[Math.floor(index / 9)] + (index % 9 + 1);
      if (distance([...hand, draw]) < structural) ukeire += available[index];
    }
  }
  const ronValue = ronUkeire ? ronTotal / ronUkeire : 0;
  const tsumoValue = tsumoUkeire ? tsumoTotal / tsumoUkeire : 0;
  const estimatedValue = structural === 0 ? ronValue * .65 + tsumoValue * .35
    : shallow?.estimatedValue ?? routeValue(input, hand, input.player.melds);
  return { key, tile, shanten: structural === 0 && (!ukeire || !legalReady) ? 1 : structural, ukeire, estimatedValue,
    ronUkeire, tsumoUkeire, ronValue, tsumoValue, legalReady, maximumRon, voidTiles, metricsComplete: budget.complete };
}

/** Hidden opponents' final readiness remains an estimate. The acting hand's qualification and payout are exact. */
function terminalValue(input: RegionalBotInput, value: HandValue): number {
  const own = input.observation.players.find(player => player.id === input.observation.ownId);
  if (value.voidTiles) return -sichuanFlowerPigPayment(normalizeSichuanOptions(input.sichuan, 2)) * (input.observation.playerCount - 1);
  if (own?.hasWon) return 0;
  const eligible = input.observation.players.filter(player => player.id !== input.observation.ownId && player.active !== false && !player.hasWon);
  const notReadyProbability = .5;
  if (value.legalReady) return value.maximumRon * eligible.length * notReadyProbability;
  return -eligible.reduce((sum, player) => sum + (player.expectedDealInValue ?? input.observation.expectedDealInValue ?? 2), 0) * (1 - notReadyProbability);
}

function rankValues(input: RegionalBotInput, values: HandValue[]): BotDecision {
  const ranked = rankRegionalCandidates(input, values);
  const byKey = new Map(values.map(value => [value.key, value]));
  const noOwnDraw = input.observation.tilesLeft < (input.observation.activePlayerCount ?? input.observation.playerCount);
  const candidates = ranked.candidates.map(candidate => {
    const value = byKey.get(candidate.key)!;
    const score = noOwnDraw ? terminalValue(input, value) - candidate.risk * candidate.lossIfDealIn * (value.legalReady ? 1.1 : 1.25) : candidate.score;
    return { ...candidate, score, shanten: value.legalReady ? 0 : candidate.shanten,
      estimatedValue: value.legalReady && !value.ukeire ? value.maximumRon : candidate.estimatedValue };
  });
  candidates.sort((left, right) => right.score - left.score);
  return { ...ranked, key: candidates[0].key, candidates };
}

export function prepareSichuanValues(input: RegionalBotInput, baseline: BotDecision): SichuanValueState {
  const available = visibleCounts(input.observation).slice(0, 27).map((count, index) => Math.max(0, (input.observation.tileLimits?.[index] ?? 4) - count));
  const empty = { decision: baseline, actions: [], values: new Map<string, HandValue>(), available, input };
  const anchorAction = input.actions.find(action => action.key === baseline.key);
  if (anchorAction?.type !== 'discard') return empty;
  input = { ...input, observation: regionalPublicObservation({ ...input, observation: withPublicLossValues(input) }) };
  const budget = new ValueBudget(1200), values = new Map<string, HandValue>();
  for (const candidate of baseline.candidates) {
    const action = input.actions.find(action => action.key === candidate.key);
    if (action?.type !== 'discard' || action.index == null) continue;
    const hand = input.player.hand.filter((_, index) => index !== action.index);
    values.set(action.key, measureHand(input, hand, action.key, action.tile, available, budget, candidate));
  }
  const accounting = { searchNodes: baseline.searchNodes + Math.ceil(budget.used), searchBudget: baseline.searchBudget + budget.limit };
  if (!budget.complete || !values.size) return { ...empty, decision: { ...baseline, ...accounting } };
  const decision = { ...rankValues(input, [...values.values()]), ...accounting };
  const anchor = decision.candidates.find(candidate => candidate.key === decision.key)!;
  const rootAction = input.actions.find(action => action.key === decision.key)!;
  const seen = new Set<string>(rootAction.tile ? [rootAction.tile] : []);
  const alternatives = decision.candidates.flatMap(candidate => {
    const action = input.actions.find(action => action.key === candidate.key)!;
    if (action.key === decision.key || !action.tile || seen.has(action.tile) || anchor.score - candidate.score > 3 || candidate.shanten !== anchor.shanten) return [];
    seen.add(action.tile); return [action];
  });
  const anchorValue = values.get(decision.key)!;
  const canSearch = !anchorValue.legalReady && anchorValue.shanten <= 3
    && input.observation.tilesLeft >= (input.observation.activePlayerCount ?? input.observation.playerCount);
  const actions = canSearch && alternatives.length ? [rootAction, ...alternatives] : [];
  return { decision, actions, values, available, input };
}

function continuationValue(state: SichuanValueState, action: RegionalBotAction, budget: ValueBudget): number {
  const input = state.input, hand = input.player.hand.filter((_, index) => index !== action.index);
  const initial = shanten(hand, input.player.melds, 4, undefined, true, false);
  let total = 0, effective = 0;
  for (let index = 0; index < 27 && budget.complete; index++) {
    const copies = state.available[index];
    if (!copies) continue;
    const draw = 'mps'[Math.floor(index / 9)] + (index % 9 + 1);
    if (!budget.spend()) break;
    const drawn = [...hand, draw];
    if (shanten(drawn, input.player.melds, 4, undefined, true, false) >= initial) continue;
    const mustVoid = drawn.some(tile => tile[0] === input.player.voidSuit);
    const unique = [...new Set(drawn)].filter(tile => !mustVoid || tile[0] === input.player.voidSuit);
    const actions = unique.map(tile => ({ key: `future:${tile}`, type: 'discard', tile, index: drawn.indexOf(tile) }));
    const nextInput = { ...input, drawn: draw, player: { ...input.player, hand: drawn }, actions,
      observation: { ...input.observation, ownHand: coreString(drawn, input.player.melds, draw),
        tilesLeft: Math.max(0, input.observation.tilesLeft - (input.observation.activePlayerCount ?? input.observation.playerCount)),
        players: input.observation.players.map(player => player.id === input.observation.ownId
          ? { ...player, discards: [...player.discards, { tile: action.tile! }] } : player) } };
    const remaining = [...state.available]; remaining[index]--;
    const states = actions.map(action => {
      const hand = drawn.filter((_, at) => at !== action.index);
      const distance = budget.spend() ? shanten(hand, input.player.melds, 4, undefined, true, false) : Infinity;
      return { action, hand, distance };
    });
    const minimum = Math.min(...states.map(state => state.distance));
    const values = states.filter(state => state.distance === minimum)
      .map(state => measureHand(nextInput, state.hand, state.action.key, state.action.tile, remaining, budget));
    if (!budget.complete) break;
    total += copies * rankValues(nextInput, values).candidates[0].score;
    effective += copies;
  }
  return effective ? total / effective : 0;
}

/** The proposal is the sole learned choice. Every remaining operation is fixed by public state. */
export function applySichuanValueProposal(state: SichuanValueState, proposalKey?: string): BotDecision {
  const baseline = state.decision, proposal = state.actions.find(action => action.key === proposalKey);
  const anchor = state.input.actions.find(action => action.key === baseline.key);
  const value = state.values.get(baseline.key);
  if (!proposal || proposal.key === baseline.key || !anchor || !value || value.legalReady || value.shanten > 3 || !state.input.observation.tilesLeft) return baseline;
  const allowance = state.input.difficulty === 'expert' ? 2400 : 1200;
  const first = new ValueBudget(allowance), second = new ValueBudget(allowance);
  const anchorValue = continuationValue(state, anchor, first), proposedValue = continuationValue(state, proposal, second);
  const accounting = { searchNodes: baseline.searchNodes + Math.ceil(first.used + second.used), searchBudget: baseline.searchBudget + allowance * 2 };
  if (!first.complete || !second.complete) return { ...baseline, ...accounting };
  const own = state.values.get(proposal.key)!;
  const probability = Math.min(value.ukeire, own.ukeire) / Math.max(1, state.available.reduce((sum, copies) => sum + copies, 0));
  const lookahead = (proposedValue - anchorValue) * probability;
  const candidates = baseline.candidates.map(candidate => candidate.key === proposal.key ? { ...candidate, score: candidate.score + lookahead, lookahead } : candidate);
  const anchorMetric = baseline.candidates.find(candidate => candidate.key === baseline.key)!;
  const winner = candidates.reduce((best, candidate) => candidate.score > best.score + 1e-9 ? candidate : best, anchorMetric);
  candidates.sort((left, right) => right.score - left.score);
  return { ...baseline, ...accounting, key: winner.key, strategy: 'search', candidates };
}
