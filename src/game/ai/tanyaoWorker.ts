import { chooseRiichiAction } from './riichi';
import type { BotAction, BotObservation, Difficulty } from './types';
import { chooseTanyaoHybridAction } from './models/tanyaoHybrid';
import { initializeTanyaoModel } from './models/tanyaoRuntime';
import type { TanyaoFeatures } from './models/tanyaoFeatures';
import type { McrModelAssets } from './models/mcrAssets';

const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(message: unknown): void };
const pending = new Set<number>(), cancelled = new Set<number>();
let queue = Promise.resolve();
scope.onmessage = (event: MessageEvent<{ id: number; observation: BotObservation; actions: BotAction[]; difficulty: Difficulty;
  features: TanyaoFeatures; assets?: McrModelAssets; cancelIds?: number[] }>) => {
  const { id, observation, actions, difficulty, features, assets, cancelIds } = event.data;
  if (assets) { void initializeTanyaoModel(assets).catch(() => {}); return; }
  if (cancelIds) { for (const job of cancelIds) if (pending.has(job)) cancelled.add(job); return; }
  pending.add(id);
  queue = queue.then(async () => {
    try {
      if (cancelled.has(id)) return;
      let decision;
      try { decision = await chooseTanyaoHybridAction(observation, actions, difficulty, features); }
      catch { decision = { ...chooseRiichiAction(observation, actions, difficulty, 7), provider: 'algorithm' }; }
      if (!cancelled.has(id)) scope.postMessage({ id, decision });
    } catch (error) { if (!cancelled.has(id)) scope.postMessage({ id, error: String(error) }); }
    finally { pending.delete(id); cancelled.delete(id); }
  });
};
