import type { RegionalBotInput } from '../../../src/game/ai/regional';
import { ordinaryContext, routeValue, withPublicLossValues } from '../../../src/game/ai/regional';
import { evaluateDanger, samplePublicDraws, visibleCounts } from '../../../src/game/ai/evaluator';
import { regionalAwardValue, rankRegionalCandidates } from '../../../src/game/ai/regionalEvaluation';
import type { RegionalCandidate } from '../../../src/game/ai/regionalEvaluation';
import { executeSichuanProposal, prepareSichuanProposal, sichuanProposalMask } from '../../../src/game/ai/models/sichuanProposal';
import { encodeSichuanFeatures, sichuanActionIndex } from '../../../src/game/ai/models/sichuanFeatures';
import { shanten } from '../../../src/game/variants/hand';
import { countsOf, coreString } from '../../../src/game/variants/tiles';
import { normalizeSichuanOptions, sichuanFlowerPigPayment } from '../../../src/game/variants/sichuan';
import { scoreHand } from '../../../src/game/variants/rules';

export const PROPOSAL_TEACHER_SPEC = Object.freeze({ version: 1, trials: 16, depth: 2, nodesPerExecutedGroup: 128000, maximumExecutedGroups: 4 });

class TeacherBudget {
  used = 0;
  complete = true;
  spend(cost = 1): boolean {
    if (this.used + cost > PROPOSAL_TEACHER_SPEC.nodesPerExecutedGroup) { this.complete = false; return false; }
    this.used += cost; return true;
  }
}

interface Leaf {
  score: number;
  ready: boolean;
  maximumRon: number;
}

/** The teacher receives only the acting player's state, legal actions and public fields. */
export function captureSichuanPublicInput(input: RegionalBotInput): RegionalBotInput {
  const o = input.observation, p = input.player;
  return {
    aiVersion: input.aiVersion, difficulty: input.difficulty, drawn: input.drawn, rulesVersion: input.rulesVersion,
    exchangeThree: input.exchangeThree, sichuan: input.sichuan ? { ...input.sichuan } : undefined,
    wildcard: input.wildcard, profile: structuredClone(input.profile), furiten: input.furiten ? { ...input.furiten } : undefined,
    player: { hand: [...p.hand], melds: p.melds.map(m => ({ ...m, tiles: [...m.tiles] })), flowers: [...p.flowers],
      voidSuit: p.voidSuit, riichi: p.riichi, doubleRiichi: p.doubleRiichi, ippatsu: p.ippatsu, kita: p.kita, floatCount: p.floatCount },
    actions: input.actions.map(a => ({ key: a.key, type: a.type, tile: a.tile, tiles: a.tiles ? [...a.tiles] : undefined,
      consume: a.consume ? [...a.consume] : undefined, index: a.index, meldIndex: a.meldIndex, kind: a.kind })),
    observation: { ownId: o.ownId, seat: o.seat, roundWind: o.roundWind, roundHand: o.roundHand, finalRound: o.finalRound,
      playerCount: o.playerCount, activePlayerCount: o.activePlayerCount, ownHand: o.ownHand, doraIndicators: [...o.doraIndicators],
      additionalPublicTiles: o.additionalPublicTiles ? [...o.additionalPublicTiles] : undefined, tilesLeft: o.tilesLeft,
      honba: o.honba, riichiSticks: o.riichiSticks, allowOpenTanyao: o.allowOpenTanyao, discardFuriten: o.discardFuriten,
      tileLimits: o.tileLimits ? [...o.tileLimits] : undefined, wildcards: o.wildcards ? [...o.wildcards] : undefined,
      pointScale: o.pointScale, expectedDealInValue: o.expectedDealInValue, dealerValueMultiplier: o.dealerValueMultiplier, seed: o.seed,
      players: o.players.map(player => ({ id: player.id, seat: player.seat, points: player.points, dealer: player.dealer,
        riichi: player.riichi, active: player.active, hasWon: player.hasWon, voidSuit: player.voidSuit,
        expectedDealInValue: player.expectedDealInValue, melds: [...player.melds], discards: player.discards.map(d => ({ ...d })) })) },
  };
}

function stateLeaf(input: RegionalBotInput, available: number[], budget: TeacherBudget): Leaf {
  const hand = input.player.hand, melds = input.player.melds;
  if (!budget.spend()) return { score: 0, ready: false, maximumRon: 0 };
  const structural = shanten(hand, melds, 4, undefined, true, false);
  const voidTiles = hand.some(tile => tile[0] === input.player.voidSuit);
  const owned = countsOf([...hand, ...melds.flatMap(meld => meld.tiles)]);
  let ukeire = 0, ronUkeire = 0, tsumoUkeire = 0, ronTotal = 0, tsumoTotal = 0, maximumRon = 0, ready = false;
  for (let index = 0; index < 27 && budget.complete; index++) {
    if (owned[index] >= (input.observation.tileLimits?.[index] ?? 4)) continue;
    if (structural > 0 && !available[index]) continue;
    if (!budget.spend()) break;
    const tile = 'mps'[Math.floor(index / 9)] + (index % 9 + 1);
    const next = shanten([...hand, tile], melds, 4, undefined, true, false);
    if (structural > 0) { if (next < structural) ukeire += available[index]; continue; }
    if (voidTiles || next >= 0 || !budget.spend(2)) continue;
    const internal = { spend: () => budget.spend(1 / 128) };
    const ron = scoreHand(ordinaryContext(input, input.player, tile, false), undefined, internal);
    const tsumo = scoreHand(ordinaryContext(input, { ...input.player, hand: [...hand, tile] }, tile, true), undefined, internal);
    const r = ron ? regionalAwardValue(input, ron, false) : 0, t = tsumo ? regionalAwardValue(input, tsumo, true) : 0;
    ready ||= r > 0 || t > 0; maximumRon = Math.max(maximumRon, r);
    if (r || t) ukeire += available[index];
    if (r) { ronUkeire += available[index]; ronTotal += r * available[index]; }
    if (t) { tsumoUkeire += available[index]; tsumoTotal += t * available[index]; }
  }
  const ronValue = ronUkeire ? ronTotal / ronUkeire : 0, tsumoValue = tsumoUkeire ? tsumoTotal / tsumoUkeire : 0;
  const metric: RegionalCandidate = { key: 'teacher-state', shanten: structural === 0 && (!ukeire || !ready) ? 1 : structural,
    ukeire, estimatedValue: structural === 0 ? ronValue * .65 + tsumoValue * .35 : routeValue(input, hand, melds),
    ronUkeire, tsumoUkeire, ronValue, tsumoValue, metricsComplete: budget.complete };
  let score = rankRegionalCandidates(input, [metric]).candidates[0].score;
  if (input.observation.tilesLeft < (input.observation.activePlayerCount ?? input.observation.playerCount)) {
    const own = input.observation.players.find(player => player.id === input.observation.ownId);
    const eligible = input.observation.players.filter(player => player.id !== input.observation.ownId && player.active !== false && !player.hasWon);
    if (voidTiles) score = -sichuanFlowerPigPayment(normalizeSichuanOptions(input.sichuan, 2)) * (input.observation.playerCount - 1);
    else if (own?.hasWon) score = 0;
    else if (ready) score = maximumRon * eligible.length * .5;
    else score = -eligible.reduce((sum, player) => sum + (player.expectedDealInValue ?? input.observation.expectedDealInValue ?? 2), 0) * .5;
  }
  return { score, ready, maximumRon };
}

function discard(input: RegionalBotInput, index: number): RegionalBotInput {
  const tile = input.player.hand[index], hand = input.player.hand.filter((_, at) => at !== index);
  return { ...input, drawn: null, actions: [], player: { ...input.player, hand }, observation: { ...input.observation,
    ownHand: coreString(hand, input.player.melds), players: input.observation.players.map(player => player.id === input.observation.ownId
      ? { ...player, discards: [...player.discards, { tile }] } : player) } };
}

function evaluateExecuted(input: RegionalBotInput, key: string, sequences: string[][], available: number[]): { qRef: number; nodes: number; complete: boolean } {
  const action = input.actions.find(action => action.key === key)!;
  const budget = new TeacherBudget();
  if (action.type !== 'discard' || action.index == null) return { qRef: 0, nodes: 0, complete: false };
  const after = discard(input, action.index), initial = stateLeaf(after, available, budget);
  const rootDanger = evaluateDanger(input.observation, action.tile!);
  const rootCost = rootDanger.expectedLoss * (initial.ready ? 1.1 : 1.25);
  let total = 0;
  for (const sequence of sequences) {
    let current = captureSichuanPublicInput(after), remaining = [...available], receipts = 0, costs = rootCost, ended = false;
    for (const draw of sequence) {
      const active = current.observation.activePlayerCount ?? current.observation.playerCount;
      if (current.observation.tilesLeft < active || !budget.complete) break;
      const tileIndex = 'mps'.indexOf(draw[0]) * 9 + Number(draw[1]) - 1;
      remaining[tileIndex]--;
      current.player.hand.push(draw); current.drawn = draw;
      current.observation = { ...current.observation, ownHand: coreString(current.player.hand, current.player.melds, draw),
        tilesLeft: current.observation.tilesLeft - active };
      if (!budget.spend(2)) break;
      const score = scoreHand(ordinaryContext(current, current.player, draw, true), undefined, { spend: () => budget.spend(1 / 128) });
      if (score) {
        receipts += regionalAwardValue(current, score, true);
        if (current.profile.continuing === 'blood') { ended = true; break; }
        current.player.hand.pop(); current.drawn = null;
        current.observation = { ...current.observation, ownHand: coreString(current.player.hand, current.player.melds),
          additionalPublicTiles: [...(current.observation.additionalPublicTiles ?? []), draw],
          players: current.observation.players.map(player => player.id === current.observation.ownId ? { ...player, hasWon: true } : player) };
        continue;
      }
      const mustVoid = current.player.hand.some(tile => tile[0] === current.player.voidSuit);
      const unique = new Set<string>();
      let best: { input: RegionalBotInput; leaf: Leaf; cost: number } | undefined;
      for (let index = 0; index < current.player.hand.length && budget.complete; index++) {
        const tile = current.player.hand[index];
        if (unique.has(tile) || mustVoid && tile[0] !== current.player.voidSuit) continue;
        unique.add(tile);
        const next = discard(current, index), leaf = stateLeaf(next, remaining, budget);
        const danger = evaluateDanger(current.observation, tile);
        const cost = danger.expectedLoss * (leaf.ready ? 1.1 : 1.25);
        if (!best || leaf.score - cost > best.leaf.score - best.cost + 1e-9) best = { input: next, leaf, cost };
      }
      if (!best) { budget.complete = false; break; }
      current = best.input; costs += best.cost;
    }
    if (!budget.complete) break;
    const leaf = ended ? 0 : stateLeaf(current, remaining, budget).score;
    total += receipts - costs + leaf;
  }
  return { qRef: total / Math.max(1, sequences.length), nodes: Math.ceil(budget.used), complete: budget.complete };
}

export function labelSichuanProposals(raw: RegionalBotInput) {
  const input = captureSichuanPublicInput(raw);
  input.observation = withPublicLossValues(input);
  const state = prepareSichuanProposal(input), mask = sichuanProposalMask(state);
  if (state.actions.length < 2) return { status: 'no-choice' as const };
  const anchor = sichuanActionIndex(input.actions.find(action => action.key === state.decision.key)!);
  const executions = state.actions.map(action => {
    const p = sichuanActionIndex(action), decision = executeSichuanProposal(state, p, 'proposal-teacher-runtime');
    return { proposal: p, executed: sichuanActionIndex(input.actions.find(action => action.key === decision.key)!), key: decision.key,
      runtimeComplete: decision.searchBudget === state.decision.searchBudget || decision.candidates.some(candidate => candidate.lookahead != null), runtimeNodes: decision.searchNodes };
  });
  const groups = [...new Set(executions.map(execution => execution.key))];
  if (groups.length === 1) return { status: 'equivalent' as const, groups: 1 };
  if (groups.length > PROPOSAL_TEACHER_SPEC.maximumExecutedGroups) return { status: 'too-many-groups' as const, groups: groups.length };
  const known = visibleCounts(input.observation), available = known.slice(0, 27).map((count, index) => Math.max(0, (input.observation.tileLimits?.[index] ?? 4) - count));
  const sequences = samplePublicDraws(input.observation, PROPOSAL_TEACHER_SPEC.trials, PROPOSAL_TEACHER_SPEC.depth);
  const values = new Map(groups.map(key => [key, evaluateExecuted(input, key, sequences, available)]));
  if ([...values.values()].some(value => !value.complete)) return { status: 'teacher-incomplete' as const, groups: groups.length, nodes: [...values.values()].reduce((sum, value) => sum + value.nodes, 0) };
  const base = values.get(state.decision.key)!;
  const candidates = executions.map(execution => ({ ...execution, teacherComplete: true, qRef: values.get(execution.key)!.qRef,
    delta: execution.executed === anchor ? 0 : values.get(execution.key)!.qRef - base.qRef, teacherNodes: values.get(execution.key)!.nodes }));
  let target = anchor, bestDelta = 0;
  for (const candidate of candidates) if (candidate.delta > bestDelta + 1e-9) { target = candidate.proposal; bestDelta = candidate.delta; }
  return { status: 'complete' as const, schemaVersion: 1, supervision: 'proposal-distill', featureVersion: 3, proposalVersion: 1,
    teacherSpec: PROPOSAL_TEACHER_SPEC, input, features: encodeSichuanFeatures(input, 3), mask, anchor, candidates,
    target, margin: bestDelta, groups: groups.length, nodes: [...values.values()].reduce((sum, value) => sum + value.nodes, 0) };
}
