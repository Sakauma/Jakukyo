import { chooseRegionalAction } from '../regional';
import type { RegionalBotInput } from '../regional';
import type { BotDecision } from '../types';
import { encodeSichuanFeatures, sichuanActionIndex, sichuanLegalMask } from './sichuanFeatures';
import { createSichuanPolicy } from './sichuanRuntime';
import type { SichuanPolicyData } from './sichuanRuntime';
import weights from './sichuan/weights.json';
import source from './sichuan/source.json';

export const SICHUAN_MODEL_IDENTITY = Object.freeze({
  id: source.id, sha256: source.parametersSha256, featureVersion: 1, policyVersion: 1,
});

export function supportsSichuanModelTable(input: Pick<RegionalBotInput, 'aiVersion' | 'profile' | 'rulesVersion' | 'exchangeThree' | 'sichuan'>): boolean {
  return (input.aiVersion ?? 0) >= 8 && input.profile.id === 'sichuan-blood' && input.rulesVersion === 2
    && input.exchangeThree === false
    && input.sichuan?.version === 2 && input.sichuan.fanCap === 4 && input.sichuan.selfDraw === 'base'
    && input.sichuan.menqingZhongzhang === false;
}

export function supportsSichuanModel(input: RegionalBotInput): boolean {
  return supportsSichuanModelTable(input) && ['advanced', 'expert'].includes(input.difficulty);
}

/** The prior allocates additional bounded search. Algorithm scores determine the final action. */
export function createSichuanHybridPolicy(model: SichuanPolicyData, modelId = SICHUAN_MODEL_IDENTITY.id): (input: RegionalBotInput) => BotDecision {
  let predict: ReturnType<typeof createSichuanPolicy> | undefined;
  return input => {
    const baseline = chooseRegionalAction(input);
    if (!supportsSichuanModel(input) || baseline.strategy === 'win') return baseline;
    try {
      const mask = sichuanLegalMask(input.actions);
      if (mask.reduce((sum, value) => sum + value, 0) <= 1) return baseline;
      predict ??= createSichuanPolicy(model);
      const { logits } = predict(encodeSichuanFeatures(input));
      const ordered = [...input.actions].sort((left, right) =>
        logits[sichuanActionIndex(right)] - logits[sichuanActionIndex(left)] || left.key.localeCompare(right.key));
      const focused = new Set([baseline.key]);
      const semantic = new Set<number>();
      const width = input.difficulty === 'expert' ? 4 : 2;
      for (const action of ordered) {
        const index = sichuanActionIndex(action);
        if (semantic.has(index)) continue;
        semantic.add(index);
        focused.add(action.key);
        if (semantic.size === width) break;
      }
      const refined = chooseRegionalAction({ ...input, focusKeys: [...focused] });
      const bestByAction = new Map<string, typeof refined.candidates[number]>();
      for (const candidate of refined.candidates) if (!bestByAction.has(candidate.key)) bestByAction.set(candidate.key, candidate);
      const candidates = [...bestByAction.values()];
      const maximumScore = Math.max(...candidates.map(candidate => candidate.score));
      const tied = candidates.filter(candidate => maximumScore - candidate.score <= 0.0001);
      tied.sort((left, right) => {
        const leftAction = input.actions.find(action => action.key === left.key)!;
        const rightAction = input.actions.find(action => action.key === right.key)!;
        return logits[sichuanActionIndex(rightAction)] - logits[sichuanActionIndex(leftAction)]
          || right.score - left.score || left.key.localeCompare(right.key);
      });
      const baselineAction = input.actions.find(action => action.key === baseline.key)!;
      const key = ['pon', 'kan'].includes(baselineAction.type) ? baseline.key : tied[0]?.key ?? baseline.key;
      const selected = input.actions.find(action => action.key === key)!;
      return { ...refined, key, strategy: selected.type === 'pass' ? 'pass' : ['pon', 'kan'].includes(selected.type) ? 'call' : refined.strategy,
        searchNodes: baseline.searchNodes + refined.searchNodes, searchBudget: baseline.searchBudget + refined.searchBudget,
        provider: 'sichuan-model-hybrid', modelId };
    } catch {
      return baseline;
    }
  };
}

export const chooseSichuanHybridAction = createSichuanHybridPolicy(weights);
