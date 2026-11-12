import { chooseRegionalAction } from './regional';
import type { RegionalBotInput } from './regional';
import type { BotDecision } from './types';
import { chooseMcrHybridAction } from './models/mcrHybrid';
import { chooseSichuanHybridAction } from './models/sichuanHybrid';
import { initializeMcrModel } from './models/mcrRuntime';
import type { McrModelAssets } from './models/mcrAssets';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<{ id: number; input: RegionalBotInput; assets?: McrModelAssets; cancelThrough?: number }>) => void) | null;
  postMessage(message: unknown): void;
};

let queue = Promise.resolve();
let cancelledThrough = 0;
workerScope.onmessage = event => {
  const { id, input, assets, cancelThrough } = event.data;
  if (cancelThrough != null) { cancelledThrough = Math.max(cancelledThrough, cancelThrough); return; }
  if (assets) { void initializeMcrModel(assets).catch(() => {}); return; }
  queue = queue.then(async () => {
    if (id <= cancelledThrough) return;
    try {
      const hybrid = (input.aiVersion ?? 6) >= 7 && input.profile.id === 'mcr' && ['advanced', 'expert'].includes(input.difficulty);
      let decision: BotDecision;
      try { decision = hybrid ? await chooseMcrHybridAction(input) : chooseSichuanHybridAction(input); }
      catch { decision = chooseRegionalAction(input); }
      if (id > cancelledThrough) workerScope.postMessage({ id, decision });
    } catch (error) {
      if (id > cancelledThrough) workerScope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
  });
};
