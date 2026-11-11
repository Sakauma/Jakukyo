import InlineRegionalWorker from './regionalWorker?worker&inline';
import { chooseRegionalAction } from './regional';
import type { RegionalBotInput } from './regional';
import type { BotDecision } from './types';
import { loadMcrAssets } from './models/mcrAssets';

interface RegionalJob {
  input: RegionalBotInput;
  resolve: (decision: BotDecision | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** The worker receives the same self/public projection used by synchronous replays. */
export class RegionalDecisionService {
  private worker: Worker | null = null;
  private unavailable = false;
  private nextId = 0;
  private jobs = new Map<number, RegionalJob>();
  private assetsWorker: Worker | null = null;
  private assetsPromise: Promise<void> | null = null;

  get available(): boolean { return typeof Worker !== 'undefined' && !this.unavailable; }

  choose(input: RegionalBotInput): Promise<BotDecision | null> {
    if (typeof Worker === 'undefined' || this.unavailable) return Promise.resolve(chooseRegionalAction(input));
    try {
      if (!this.worker) {
        const worker = new InlineRegionalWorker();
        this.worker = worker;
        worker.onmessage = event => {
          if(this.worker!==worker)return;
          const job = this.jobs.get(event.data.id);
          if (!job) return;
          clearTimeout(job.timer);
          this.jobs.delete(event.data.id);
          const decision = event.data.decision as BotDecision | undefined;
          const legal = decision && job.input.actions.some(action => action.key === decision.key);
          job.resolve(legal ? decision : chooseRegionalAction(job.input));
        };
        worker.onerror = () => { if(this.worker===worker)this.failWorker(); };
      }
      return new Promise(resolve => {
        const id = ++this.nextId;
        const hybrid = (input.aiVersion ?? 6) >= 7 && input.profile.id === 'mcr' && ['advanced', 'expert'].includes(input.difficulty);
        const timer = setTimeout(() => { if(this.jobs.has(id))this.failWorker(); }, hybrid ? 20000 : 4000);
        this.jobs.set(id, { input, resolve, timer });
        const worker = this.worker!;
        const send = () => {
          if (this.worker !== worker || !this.jobs.has(id)) return;
          try { worker.postMessage({ id, input }); }
          catch { this.failWorker(); }
        };
        if (hybrid) {
          if (this.assetsWorker !== worker) {
            this.assetsWorker = worker;
            this.assetsPromise = loadMcrAssets().then(assets => {
              if (this.worker === worker) worker.postMessage({ id: 0, assets }, [assets.graph, assets.weightsGzip, assets.wasmGzip]);
            });
          }
          void this.assetsPromise!.then(send, () => {
            const job = this.jobs.get(id);
            if (job) { clearTimeout(job.timer); this.jobs.delete(id); job.resolve(chooseRegionalAction(input)); }
          });
        } else send();
      });
    } catch {
      this.unavailable = true;
      return Promise.resolve(chooseRegionalAction(input));
    }
  }

  private failWorker(): void {
    this.unavailable = true;
    this.worker?.terminate();
    this.worker = null;
    this.assetsWorker = null; this.assetsPromise = null;
    const jobs = [...this.jobs.values()];
    this.jobs.clear();
    for (const job of jobs) {
      clearTimeout(job.timer);
      job.resolve(chooseRegionalAction(job.input));
    }
  }

  cancel(preserveWorker = false): void {
    if (!preserveWorker) {
      this.worker?.terminate(); this.worker = null;
      this.assetsWorker = null; this.assetsPromise = null;
      this.unavailable = false;
    } else if (this.worker && this.jobs.size) {
      try { this.worker.postMessage({ cancelThrough: this.nextId }); }
      catch { this.worker.terminate(); this.worker = null; this.assetsWorker = null; this.assetsPromise = null; }
    }
    for (const job of this.jobs.values()) {
      clearTimeout(job.timer);
      job.resolve(null);
    }
    this.jobs.clear();
  }
}
