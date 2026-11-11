import InlineRegionalWorker from './regionalWorker?worker&inline';
import { chooseRegionalAction } from './regional';
import type { RegionalBotInput } from './regional';
import type { BotDecision } from './types';

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
        const timer = setTimeout(() => { if(this.jobs.has(id))this.failWorker(); }, 4000);
        this.jobs.set(id, { input, resolve, timer });
        try { this.worker!.postMessage({ id, input }); }
        catch { this.failWorker(); }
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
    const jobs = [...this.jobs.values()];
    this.jobs.clear();
    for (const job of jobs) {
      clearTimeout(job.timer);
      job.resolve(chooseRegionalAction(job.input));
    }
  }

  cancel(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.jobs.values()) {
      clearTimeout(job.timer);
      job.resolve(null);
    }
    this.jobs.clear();
  }
}
