import { chooseRegionalAction } from '../regional';
import type { RegionalBotInput } from '../regional';
import type { BotDecision } from '../types';
import { encodeSichuanFeatures, sichuanActionIndex, sichuanLegalMask } from './sichuanFeatures';
import { createSichuanPolicy } from './sichuanRuntime';
import type { SichuanPolicyData } from './sichuanRuntime';
import { refineSichuanDiscards } from './sichuanSearch';
import { createSichuanProposalPolicy } from './sichuanProposal';
import weights from './sichuan/weights.json';
import source from './sichuan/source.json';
import rulesWeights from './sichuan/rules-v2-weights.json';
import rulesSource from './sichuan/rules-v2-source.json';
import proposalWeights from './sichuan/proposal-weights.json';
import proposalSource from './sichuan/proposal-source.json';
import distillWeights from './sichuan/distill-weights.json';
import distillSource from './sichuan/distill-source.json';

export const SICHUAN_LEGACY_MODEL_IDENTITY = Object.freeze({
  id: source.id, sha256: source.parametersSha256, featureVersion: 1, policyVersion: 1,
});
export const SICHUAN_AI9_MODEL_IDENTITY = Object.freeze({
  id: rulesSource.id, sha256: rulesSource.parametersSha256, featureVersion: 2, policyVersion: 1,
});
export const SICHUAN_AI10_MODEL_IDENTITY = Object.freeze({
  id: proposalSource.id, sha256: proposalSource.parametersSha256, featureVersion: 3, policyVersion: 1,
});
export const SICHUAN_MODEL_IDENTITY = Object.freeze({
  id: distillSource.id, sha256: distillSource.parametersSha256, featureVersion: 3, policyVersion: 1,
});

export function sichuanModelIdentity(aiVersion: number) {
  if (aiVersion >= 11) return SICHUAN_MODEL_IDENTITY;
  if (aiVersion === 10) return SICHUAN_AI10_MODEL_IDENTITY;
  if (aiVersion === 9) return SICHUAN_AI9_MODEL_IDENTITY;
  return SICHUAN_LEGACY_MODEL_IDENTITY;
}

function supportsLegacyTable(input: Pick<RegionalBotInput, 'aiVersion' | 'profile' | 'rulesVersion' | 'exchangeThree' | 'sichuan'>): boolean {
  return (input.aiVersion ?? 0) >= 8 && input.profile.id === 'sichuan-blood' && input.rulesVersion === 2
    && input.exchangeThree === false
    && input.sichuan?.version === 2 && input.sichuan.fanCap === 4 && input.sichuan.selfDraw === 'base'
    && input.sichuan.menqingZhongzhang === false;
}

export function supportsSichuanModelTable(input: Pick<RegionalBotInput, 'aiVersion' | 'profile' | 'rulesVersion' | 'exchangeThree' | 'sichuan'>): boolean {
  if ((input.aiVersion ?? 0) < 9) return supportsLegacyTable(input);
  const options = input.sichuan;
  return ['sichuan-blood', 'sichuan-river'].includes(input.profile.id) && input.rulesVersion === 2
    && typeof input.exchangeThree === 'boolean' && options?.version === 2
    && [3, 4, 5, 6, 8, 'none'].includes(options.fanCap)
    && ['base', 'fan'].includes(options.selfDraw) && typeof options.menqingZhongzhang === 'boolean';
}

export function supportsSichuanModel(input: RegionalBotInput): boolean {
  return supportsSichuanModelTable(input) && ['advanced', 'expert'].includes(input.difficulty);
}

/** The prior allocates additional bounded search. Algorithm scores determine the final action. */
export function createSichuanHybridPolicy(model: SichuanPolicyData, modelId = model.featureVersion === 1 ? SICHUAN_LEGACY_MODEL_IDENTITY.id : model.featureVersion === 2 ? SICHUAN_AI9_MODEL_IDENTITY.id : SICHUAN_MODEL_IDENTITY.id, priority: 'model' | 'algorithm' = 'model'): (input: RegionalBotInput) => BotDecision {
  if (model.featureVersion === 3) return createSichuanProposalPolicy(model, modelId, priority);
  let predict: ReturnType<typeof createSichuanPolicy> | undefined;
  return input => {
    const baseline = chooseRegionalAction(input);
    const supported = model.featureVersion === 1 ? supportsLegacyTable(input) : (input.aiVersion ?? 0) >= 9 && supportsSichuanModelTable(input);
    if (!supported || !['advanced', 'expert'].includes(input.difficulty) || baseline.strategy === 'win') return baseline;
    try {
      const mask = sichuanLegalMask(input.actions);
      if (mask.reduce((sum, value) => sum + value, 0) <= 1) return baseline;
      predict ??= createSichuanPolicy(model);
      const { logits } = predict(encodeSichuanFeatures(input, model.featureVersion === 1 ? 1 : 2));
      const ordered = [...input.actions].sort((left, right) =>
        logits[sichuanActionIndex(right)] - logits[sichuanActionIndex(left)] || left.key.localeCompare(right.key));
      if (model.featureVersion === 2) {
        const algorithmOrder = baseline.candidates.flatMap(candidate => input.actions.filter(action => action.key === candidate.key));
        const refined = refineSichuanDiscards(input, baseline, priority === 'model' ? ordered : algorithmOrder);
        return { ...refined, provider: 'sichuan-model-hybrid', modelId };
      }
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

const legacyPolicy = createSichuanHybridPolicy(weights);
const rulesPolicy = createSichuanHybridPolicy(rulesWeights);
const proposalPolicy = createSichuanHybridPolicy(proposalWeights, SICHUAN_AI10_MODEL_IDENTITY.id);
const distilledPolicy = createSichuanHybridPolicy(distillWeights);

export function chooseSichuanHybridAction(input: RegionalBotInput): BotDecision {
  const version = input.aiVersion ?? 0;
  if (version >= 11) return distilledPolicy(input);
  if (version === 10) return proposalPolicy(input);
  return version === 9 ? rulesPolicy(input) : legacyPolicy(input);
}
