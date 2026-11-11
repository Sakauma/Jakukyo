import InlineWorker from './tanyaoWorker?worker&inline';
import { chooseRiichiAction } from './riichi';
import type { BotAction, BotDecision, BotObservation, Difficulty } from './types';
import { encodeTanyaoFeatures } from './models/tanyaoFeatures';
import type { TanyaoContext } from './models/tanyaoFeatures';
import { loadTanyaoAssets } from './models/tanyaoAssets';

interface Job {
  observation: BotObservation; actions: BotAction[]; difficulty: Difficulty; group: 'opponent' | 'autoplay';
  resolve(decision: BotDecision | null): void; timer: ReturnType<typeof setTimeout>;
}

/** One v7 model worker serves opponents and human autoplay with independent cancellation. */
export class TanyaoDecisionService {
  private worker: Worker | null = null;
  private assetsPromise: Promise<void> | null = null;
  private unavailable = false;
  private nextId = 0;
  private jobs = new Map<number, Job>();
  choose(observation: BotObservation, actions: BotAction[], difficulty: Difficulty, context: TanyaoContext,
    group: Job['group'] = 'opponent'): Promise<BotDecision | null> {
    const fallback = () => ({ ...chooseRiichiAction(observation, actions, difficulty, 7), provider: 'algorithm' as const });
    if (typeof Worker === 'undefined' || this.unavailable) return Promise.resolve(fallback());
    try {
      const features = encodeTanyaoFeatures(observation, context);
      if (!this.worker) {
        const worker = new InlineWorker(); this.worker = worker;
        worker.onmessage = event => {
          if (this.worker !== worker) return;
          const job = this.jobs.get(event.data.id); if (!job) return;
          this.jobs.delete(event.data.id); clearTimeout(job.timer);
          const decision = event.data.decision as BotDecision | undefined;
          job.resolve(decision && job.actions.some(action => action.key === decision.key) ? decision : this.fallback(job));
        };
        worker.onerror = () => { if (this.worker === worker) this.fail(); };
        this.assetsPromise = loadTanyaoAssets().then(assets => {
          if (this.worker === worker) worker.postMessage({ assets }, [assets.graph, assets.weightsGzip, assets.wasmGzip]);
        });
      }
      const worker = this.worker;
      return new Promise(resolve => {
        const id = ++this.nextId;
        const timer = setTimeout(() => { if (this.jobs.has(id)) this.fail(); }, 20000);
        this.jobs.set(id, { observation, actions, difficulty, group, resolve, timer });
        void this.assetsPromise!.then(() => {
          if (this.worker !== worker || !this.jobs.has(id)) return;
          try { worker.postMessage({ id, observation, actions, difficulty, features }); } catch { this.fail(); }
        }, () => { if (this.worker === worker) this.fail(); });
      });
    } catch { return Promise.resolve(fallback()); }
  }
  private fallback(job: Job): BotDecision { return { ...chooseRiichiAction(job.observation, job.actions, job.difficulty, 7), provider: 'algorithm' }; }
  private fail(): void {
    this.unavailable = true; this.worker?.terminate(); this.worker = null; this.assetsPromise = null;
    const jobs = [...this.jobs.values()]; this.jobs.clear();
    for (const job of jobs) { clearTimeout(job.timer); job.resolve(this.fallback(job)); }
  }
  cancel(group?: Job['group']): void {
    const ids: number[] = [];
    for (const [id, job] of this.jobs) {
      if (group && job.group !== group) continue;
      ids.push(id); this.jobs.delete(id); clearTimeout(job.timer); job.resolve(null);
    }
    if (ids.length && this.worker) {
      try { this.worker.postMessage({ cancelIds: ids }); } catch { this.fail(); }
    }
  }
  dispose(): void { this.cancel(); this.worker?.terminate(); this.worker = null; this.assetsPromise = null; this.unavailable = false; }
}
