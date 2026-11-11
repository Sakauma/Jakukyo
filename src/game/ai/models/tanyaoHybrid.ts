import { chooseRiichiAction } from '../riichi';
import type { BotAction, BotDecision, BotObservation, CandidateMetrics, Difficulty } from '../types';
import { tanyaoActionIndex, tanyaoLegalMask, TANYAO_MODEL_IDENTITY } from './tanyaoFeatures';
import type { TanyaoFeatures } from './tanyaoFeatures';
import { inferTanyaoPolicy } from './tanyaoRuntime';

function dominates(left: CandidateMetrics, right: CandidateMetrics): boolean {
  return left.shanten <= right.shanten && left.ukeire >= right.ukeire && left.estimatedValue >= right.estimatedValue
    && left.risk <= right.risk && left.score >= right.score && (left.shanten < right.shanten || left.ukeire > right.ukeire
      || left.estimatedValue > right.estimatedValue || left.risk < right.risk || left.score > right.score);
}

export async function chooseTanyaoHybridAction(observation: BotObservation, actions: BotAction[], difficulty: Difficulty, features: TanyaoFeatures): Promise<BotDecision> {
  const baseline = chooseRiichiAction(observation, actions, difficulty, 7);
  if (baseline.strategy === 'win' || !baseline.candidates.length) return { ...baseline, provider: 'algorithm' };
  const logits = await inferTanyaoPolicy(features);
  const mask = tanyaoLegalMask(actions);
  for (let index = 0; index < logits.length; index++) if (!mask[index]) logits[index] = -1e9;
  const best = new Map<number, CandidateMetrics>();
  for (const candidate of baseline.candidates) {
    const action = actions.find(action => action.key === candidate.key);
    if (!action) continue;
    const index = tanyaoActionIndex(action);
    if (index < 0 || index >= 86) continue;
    const previous = best.get(index);
    // Riichi's shared declaration action retains the algorithm's best legal discard.
    if (!previous || candidate.score > previous.score || candidate.score === previous.score && candidate.key.localeCompare(previous.key) < 0) best.set(index, candidate);
  }
  const pool = [...best.values()];
  const frontier = pool.filter(candidate => !pool.some(other => other.key !== candidate.key && dominates(other, candidate)));
  frontier.sort((a,b) => logits[tanyaoActionIndex(actions.find(action => action.key === b.key)!)] - logits[tanyaoActionIndex(actions.find(action => action.key === a.key)!)]
    || b.score - a.score || a.key.localeCompare(b.key));
  const key = frontier[0]?.key || baseline.key;
  const selected = actions.find(action => action.key === key)!;
  return { ...baseline, key, strategy: selected.type === 'pass' ? 'pass' : ['chi','pon','kan'].includes(selected.type) ? 'call' : 'search',
    provider: 'riichi-model-hybrid', modelId: TANYAO_MODEL_IDENTITY.id };
}
