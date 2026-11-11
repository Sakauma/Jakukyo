import { chooseRegionalAction } from '../regional';
import type { RegionalBotInput } from '../regional';
import type { BotDecision, CandidateMetrics } from '../types';
import { mcrActionIndex, mcrLegalMask, MCR_MODEL_IDENTITY } from './mcrFeatures';
import { inferMcrPolicy } from './mcrRuntime';

function dominates(left: CandidateMetrics, right: CandidateMetrics): boolean {
  return left.shanten <= right.shanten && left.ukeire >= right.ukeire && left.estimatedValue >= right.estimatedValue
    && left.risk <= right.risk && left.score >= right.score && (left.shanten < right.shanten || left.ukeire > right.ukeire
      || left.estimatedValue > right.estimatedValue || left.risk < right.risk || left.score > right.score);
}

/** Model priors allocate refinement and select among the algorithm's undominated legal candidates. */
export async function chooseMcrHybridAction(input: RegionalBotInput): Promise<BotDecision> {
  const baseline = chooseRegionalAction(input);
  if (baseline.strategy === 'win') return baseline;
  if (!input.modelFeatures) throw new Error('国标模型缺少本局特征缓存。');
  const logits = await inferMcrPolicy(input.modelFeatures, mcrLegalMask(input.actions));
  const ordered = input.actions.filter(action => mcrActionIndex(action) >= 0)
    .sort((a, b) => logits[mcrActionIndex(b)] - logits[mcrActionIndex(a)] || a.key.localeCompare(b.key));
  const semantic = new Set<number>();
  const keys = [baseline.key];
  const width = input.difficulty === 'expert' ? 4 : 2;
  for (const action of ordered) {
    const index = mcrActionIndex(action);
    if (semantic.has(index)) continue;
    semantic.add(index);
    keys.push(action.key);
    if (semantic.size === width) break;
  }
  const focused = new Set(keys);
  const refined = chooseRegionalAction({ ...input, focusKeys: [...focused] });
  const distinct = new Map<string, CandidateMetrics>();
  for (const candidate of refined.candidates) {
    if (focused.has(candidate.key) && !distinct.has(candidate.key)) distinct.set(candidate.key, candidate);
  }
  const candidates = [...distinct.values()];
  const frontier = candidates.filter(candidate => !candidates.some(other => other.key !== candidate.key && dominates(other, candidate)));
  frontier.sort((a, b) => {
    const left = input.actions.find(action => action.key === a.key)!;
    const right = input.actions.find(action => action.key === b.key)!;
    return logits[mcrActionIndex(right)] - logits[mcrActionIndex(left)] || b.score - a.score || a.key.localeCompare(b.key);
  });
  const key = frontier[0]?.key || baseline.key;
  const selected = input.actions.find(action => action.key === key)!;
  return { ...refined, key, strategy: selected.type === 'pass' ? 'pass' : ['chi', 'pon', 'kan'].includes(selected.type) ? 'call' : 'search',
    searchNodes: baseline.searchNodes + refined.searchNodes, searchBudget: baseline.searchBudget + refined.searchBudget,
    provider: 'mcr-model-hybrid', modelId: MCR_MODEL_IDENTITY.id };
}
