import { buildReplayAnalysis, chooseReplayRecommendation } from '../game/replayAnalysis';
import { initializeMcrModel } from '../game/ai/models/mcrRuntime';
import { initializeTanyaoModel } from '../game/ai/models/tanyaoRuntime';
import type { McrModelAssets } from '../game/ai/models/mcrAssets';
import type { ReplayDecisionPoint } from '../game/types';

interface AnalysisMessage {
  id: number;
  point?: ReplayDecisionPoint;
  model?: 'riichi' | 'mcr';
  assets?: McrModelAssets;
  modelReady?: boolean;
  cancelThrough?: number;
}
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<AnalysisMessage>) => void) | null;
  postMessage(value: unknown): void;
};
let queue = Promise.resolve();
let cancelledThrough = 0;
scope.onmessage = event => {
  const message = event.data;
  if (message.cancelThrough != null) {
    cancelledThrough = Math.max(cancelledThrough, message.cancelThrough);
    return;
  }
  if (message.assets) {
    const initialize = message.model === 'riichi' ? initializeTanyaoModel : initializeMcrModel;
    queue = queue.then(async () => { try { await initialize(message.assets!); } catch { /* The request can still use its algorithm fallback. */ } });
    return;
  }
  if (!message.point) return;
  queue = queue.then(async () => {
    if (message.id <= cancelledThrough) return;
    try {
      const decision = await chooseReplayRecommendation(message.point!, message.modelReady);
      const analysis = buildReplayAnalysis(message.point!, decision);
      if (message.id > cancelledThrough) scope.postMessage({ id: message.id, analysis });
    } catch (error) {
      if (message.id > cancelledThrough) scope.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) });
    }
  });
};
