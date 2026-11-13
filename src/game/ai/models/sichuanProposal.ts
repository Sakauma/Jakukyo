import { chooseRegionalAction } from '../regional';
import type { RegionalBotInput } from '../regional';
import type { BotDecision } from '../types';
import { encodeSichuanFeatures, SICHUAN_ACTIONS, sichuanActionIndex } from './sichuanFeatures';
import { createSichuanPolicy } from './sichuanRuntime';
import type { SichuanPolicyData } from './sichuanRuntime';
import { applySichuanValueProposal, prepareSichuanValues } from './sichuanValue';
import type { SichuanValueState } from './sichuanValue';

export const SICHUAN_PROPOSAL_VERSION = 1;
export const SICHUAN_LINEAR_REWARD_VERSION = 3;

export function sichuanProposalMask(state: SichuanValueState): Float32Array {
  const mask = new Float32Array(SICHUAN_ACTIONS);
  for (const action of state.actions) mask[sichuanActionIndex(action)] = 1;
  return mask;
}

export function prepareSichuanProposal(input: RegionalBotInput): SichuanValueState {
  return prepareSichuanValues(input, chooseRegionalAction(input));
}

export function executeSichuanProposal(state: SichuanValueState, proposalIndex: number | undefined, modelId: string): BotDecision {
  const proposal = state.actions.find(action => sichuanActionIndex(action) === proposalIndex);
  const decision = applySichuanValueProposal(state, proposal?.key);
  return { ...decision, provider: 'sichuan-model-hybrid', modelId };
}

/** Training samples one proposal from the same mask whose greedy action is deployed here. */
export function createSichuanProposalPolicy(model: SichuanPolicyData, modelId: string, priority: 'model' | 'algorithm' = 'model'): (input: RegionalBotInput) => BotDecision {
  let predict: ReturnType<typeof createSichuanPolicy> | undefined;
  return input => {
    const baseline = chooseRegionalAction(input);
    const options = input.sichuan;
    const supported = (input.aiVersion ?? 0) >= 10 && ['sichuan-blood', 'sichuan-river'].includes(input.profile.id)
      && input.rulesVersion === 2 && typeof input.exchangeThree === 'boolean' && options?.version === 2
      && [3, 4, 5, 6, 8, 'none'].includes(options.fanCap) && ['base', 'fan'].includes(options.selfDraw)
      && typeof options.menqingZhongzhang === 'boolean';
    if (!supported || !['advanced', 'expert'].includes(input.difficulty) || baseline.strategy === 'win') return baseline;
    try {
      const state = prepareSichuanValues(input, baseline);
      predict ??= createSichuanPolicy(model);
      const { logits } = predict(encodeSichuanFeatures(input, 3));
      const proposal = priority === 'algorithm' ? state.actions.find(action => action.key !== state.decision.key)
        : state.actions.reduce<typeof state.actions[number] | undefined>((best, action) => !best || logits[sichuanActionIndex(action)] > logits[sichuanActionIndex(best)] ? action : best, undefined);
      return executeSichuanProposal(state, proposal ? sichuanActionIndex(proposal) : undefined, modelId);
    } catch {
      return baseline;
    }
  };
}
