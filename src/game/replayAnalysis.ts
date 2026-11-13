import Majiang from '@kobalab/majiang-core';
import { basicMetrics, chooseRiichiAction } from './ai/riichi';
import { rankRiichiCandidates } from './ai/riichiEvaluation';
import { chooseRegionalAction } from './ai/regional';
import { AI_VERSION } from './ai/types';
import type { BotAction, BotDecision, BotObservation, CandidateMetrics } from './ai/types';
import { evaluateDanger, normalTile, tileIndex, visibleCounts } from './ai/evaluator';
import { chooseTanyaoHybridAction } from './ai/models/tanyaoHybrid';
import { encodeTanyaoFeatures } from './ai/models/tanyaoFeatures';
import { chooseMcrHybridAction } from './ai/models/mcrHybrid';
import { chooseSichuanHybridAction } from './ai/models/sichuanHybrid';
import { prepareSichuanProposal } from './ai/models/sichuanProposal';
import type { ReplayAnalysisInput, ReplayDecisionAction, ReplayDecisionPoint } from './types';

export type ReplayRisk = 'low' | 'medium' | 'high';
export interface ReplayActionAssessment {
  action: ReplayDecisionAction;
  shanten: number | null;
  ukeire: number | null;
  followupTile?: string;
  risk: ReplayRisk | null;
  riskContext: 'discard' | 'followup' | 'addedKan' | 'none';
  reasons: string[];
}
export interface ReplayDecisionAnalysis {
  actual: ReplayActionAssessment;
  recommended: ReplayActionAssessment;
  sameChoice: boolean;
  strategy: BotDecision['strategy'];
  provider: BotDecision['provider'];
  modelId?: string;
  aiVersion: number;
}

export function replayObservation(point: ReplayDecisionPoint): BotObservation {
  return point.input.kind === 'riichi' ? point.input.observation : point.input.input.observation;
}

export function replayDecisionCategory(point: ReplayDecisionPoint): string {
  if (point.actions.some(action => action.type === 'ron' || action.type === 'tsumo')) return '和牌选择';
  if (point.actions.some(action => action.type === 'kan')) return '杠牌选择';
  if (point.actions.some(action => action.type === 'pon' || action.type === 'chi')) return '鸣牌选择';
  if (point.actions.some(action => action.type === 'riichi')) return '立直选择';
  if (point.actions.some(action => action.type === 'kita')) return '拔北选择';
  const observation = replayObservation(point);
  const threatened = observation.players.some(player => player.id !== observation.ownId && player.active !== false
    && (player.riichi || player.melds.filter(meld => /[+=-]/.test(meld)).length >= 3));
  return threatened ? '攻守选择' : '出牌选择';
}

/** The original legal actions and table rules stay attached to the historical position. */
export function currentReplayInput(point: ReplayDecisionPoint): ReplayAnalysisInput {
  if (point.input.kind === 'riichi') return point.input;
  return { kind: 'regional', input: { ...point.input.input, difficulty: 'expert', aiVersion: AI_VERSION, focusKeys: undefined } };
}

/** Called inside the analysis worker after its optional model assets are ready. */
export async function chooseReplayRecommendation(point: ReplayDecisionPoint, modelReady = true): Promise<BotDecision> {
  const input = currentReplayInput(point);
  if (input.kind === 'riichi') {
    if (modelReady) {
      try {
        return await chooseTanyaoHybridAction(input.observation, input.actions, 'expert', encodeTanyaoFeatures(input.observation, input.context));
      } catch { /* The same bounded algorithm remains available when model inference fails. */ }
    }
    return { ...chooseRiichiAction(input.observation, input.actions, 'expert', AI_VERSION), provider: 'algorithm' };
  }
  if (input.input.profile.id === 'mcr' && modelReady) {
    try { return await chooseMcrHybridAction(input.input); }
    catch { /* Regional inference uses the game's normal algorithm fallback. */ }
  }
  return chooseSichuanHybridAction(input.input);
}

function completedMetric(key: string): CandidateMetrics {
  return { key, shanten: -1, ukeire: 0, estimatedValue: 0, risk: 0, lossIfDealIn: 0, score: 0 };
}

function measureRiichiAction(input: Extract<ReplayAnalysisInput, { kind: 'riichi' }>, action: BotAction): CandidateMetrics | undefined {
  if (action.type === 'ron' || action.type === 'tsumo') return completedMetric(action.key);
  const hand = Majiang.Shoupai.fromString(input.observation.ownHand);
  const known = visibleCounts(input.observation);
  const states: Array<{ hand: any; discard: string }> = [];
  if (action.discard) states.push({ hand: hand.clone().dapai(action.discard.replace('*', '')), discard: action.discard });
  else if (action.type === 'pass') states.push({ hand, discard: '' });
  else if (action.meld) {
    const after = action.concealedKan ? hand.clone().gang(action.meld) : hand.clone().fulou(action.meld);
    if (action.type === 'kan') states.push({ hand: after, discard: '' });
    else for (const discard of after.get_dapai() || []) states.push({ hand: after.clone().dapai(discard), discard });
  }
  if (!states.length) return undefined;
  const metrics = states.map(state => basicMetrics(state.hand, action.key, state.discard, input.observation, known, action.type === 'riichi', true));
  return rankRiichiCandidates(input.observation, metrics, 'expert', action.discard ? 'discard' : 'response').candidates[0];
}

function measureAction(input: ReplayAnalysisInput, key: string, decision: BotDecision): CandidateMetrics | undefined {
  const actions = input.kind === 'riichi' ? input.actions : input.input.actions;
  const action = actions.find(item => item.key === key);
  if (!action) return undefined;
  if (action.type === 'ron' || action.type === 'tsumo') return completedMetric(key);
  const current = decision.candidates.find(candidate => {
    if (candidate.key !== key) return false;
    // Discards describe their resulting hand; calls include a following discard,
    // while a kong, north extraction or pass must stay before any replacement draw.
    if (action.type === 'discard' || action.type === 'riichi') return candidate.tile === action.tile;
    if (action.type === 'chi' || action.type === 'pon') return !!candidate.tile;
    return !candidate.tile;
  });
  if (current) return current;
  if (input.kind === 'riichi') return measureRiichiAction(input, action as BotAction);
  const single = { ...input.input, actions: [action], focusKeys: undefined };
  const currentSichuanDiscard = (single.aiVersion ?? 0) >= 10 && single.rulesVersion === 2
    && ['sichuan-blood', 'sichuan-river'].includes(single.profile.id) && action.type === 'discard';
  const measured = currentSichuanDiscard ? prepareSichuanProposal(single).decision : chooseRegionalAction(single);
  return measured.candidates.find(candidate => candidate.key === key);
}

function exposedTile(input: ReplayAnalysisInput, action: ReplayDecisionAction, metric?: CandidateMetrics): string | undefined {
  if (metric?.tile) return metric.tile;
  if (action.type !== 'kan') return undefined;
  if (input.kind === 'regional') return input.input.actions.find(item => item.key === action.key)?.kind === 'added' ? action.tile : undefined;
  const original = input.actions.find(item => item.key === action.key);
  return original?.concealedKan && original.meld && /[+=-]/.test(original.meld) ? original.meld[0] + original.meld.slice(-1) : undefined;
}

function riskReasons(point: ReplayDecisionPoint, action: ReplayDecisionAction, tile?: string): string[] {
  if (action.type === 'ron' || action.type === 'tsumo') return ['当前满足和牌条件'];
  if (!tile) return [action.type === 'pass' ? '保留当前手牌' : action.type === 'kan' ? '杠后补牌，再选择出牌' : action.type === 'kita' ? '拔北后补牌，再选择出牌' : '按当前牌形继续'];
  const observation = replayObservation(point), key = normalTile(tile);
  const reasons: string[] = [];
  for (const player of observation.players) {
    if (player.id === observation.ownId || player.active === false) continue;
    const name = ['东家', '南家', '西家', '北家'][player.seat];
    if (player.voidSuit === tile[0]) { reasons.push(`${name}定缺此花色`); continue; }
    const open = player.melds.filter(meld => /[+=-]/.test(meld)).length;
    const seen = player.discards.some(discard => normalTile(discard.tile) === key);
    if (observation.discardFuriten && seen && (player.riichi || open >= 2)) reasons.push(`${name}已打过此牌，可作现物`);
    else if (player.riichi) reasons.push(`${name}已立直，此牌非现物`);
    else if (open >= 3) reasons.push(`${name}已有${open}副鸣牌`);
  }
  const seen = visibleCounts(observation)[tileIndex(tile)] ?? 0;
  reasons.push(`自己与公开区可见同牌${seen}张`);
  return reasons;
}

function assess(point: ReplayDecisionPoint, input: ReplayAnalysisInput, key: string, decision: BotDecision): ReplayActionAssessment {
  const action = point.actions.find(item => item.key === key);
  if (!action) throw new Error('分析动作与当时的合法操作不一致。');
  const metric = measureAction(input, key, decision);
  const tile = exposedTile(input, action, metric);
  const noRon = input.kind === 'regional' && input.input.profile.selfDrawOnly && action.type !== 'kan';
  const risk = tile && !noRon ? evaluateDanger(replayObservation(point), tile).risk : null;
  const followup = !!metric?.tile && ['chi', 'pon'].includes(action.type);
  return {
    action,
    shanten: metric && metric.metricsComplete !== false && Number.isFinite(metric.shanten) ? metric.shanten : null,
    ukeire: metric && metric.metricsComplete !== false && Number.isFinite(metric.ukeire) ? metric.ukeire : null,
    ...(followup ? { followupTile: metric!.tile } : {}),
    risk: risk == null ? null : risk >= .12 ? 'high' : risk >= .025 ? 'medium' : 'low',
    riskContext: !tile || noRon ? 'none' : followup ? 'followup' : action.type === 'kan' ? 'addedKan' : 'discard',
    reasons: noRon && tile ? ['当前桌规只允许自摸', `自己与公开区可见同牌${visibleCounts(replayObservation(point))[tileIndex(tile)] ?? 0}张`] : riskReasons(point, action, tile),
  };
}

export function isKeyReplayDecision(point: ReplayDecisionPoint, analysis: ReplayDecisionAnalysis): boolean {
  if (point.actions.some(action => ['chi', 'pon', 'kan', 'riichi', 'ron', 'tsumo', 'kita'].includes(action.type))) return true;
  if (analysis.sameChoice) return false;
  return analysis.actual.shanten !== analysis.recommended.shanten
    || analysis.actual.ukeire !== analysis.recommended.ukeire
    || analysis.actual.risk !== analysis.recommended.risk;
}

function sameAction(left: ReplayDecisionAction, right: ReplayDecisionAction): boolean {
  return left.key === right.key || left.type === right.type && left.tile === right.tile
    && [...(left.tiles ?? [])].sort().join() === [...(right.tiles ?? [])].sort().join();
}

export function buildReplayAnalysis(point: ReplayDecisionPoint, decision: BotDecision): ReplayDecisionAnalysis {
  const input = currentReplayInput(point);
  const actual = assess(point, input, point.actualKey, decision);
  const recommended = decision.key === point.actualKey ? actual : assess(point, input, decision.key, decision);
  return { actual, recommended, sameChoice: sameAction(actual.action, recommended.action), strategy: decision.strategy,
    provider: decision.provider ?? 'algorithm', modelId: decision.modelId, aiVersion: AI_VERSION };
}
