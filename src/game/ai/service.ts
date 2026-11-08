import InlineBotWorker from './worker?worker&inline';
import { chooseRiichiAction } from './riichi';
import type { BotAction, BotDecision, BotObservation, Difficulty } from './types';
import { AI_VERSION } from './types';

interface Job {
  observation: BotObservation;
  actions: BotAction[];
  difficulty: Difficulty;
  aiVersion: number;
  resolve(decision: BotDecision | null): void;
  reject(error: unknown): void;
}

/** Dedicated browser worker receives only the sanitized observation; no game object crosses this boundary. */
export class BotDecisionService {
  private worker: Worker | null = null;
  private unavailable = false;
  private nextId = 0;
  private jobs = new Map<number, Job>();

  choose(observation: BotObservation, actions: BotAction[], difficulty: Difficulty, aiVersion = AI_VERSION): Promise<BotDecision | null> {
    if (typeof Worker === 'undefined' || this.unavailable) return Promise.resolve(chooseRiichiAction(observation, actions, difficulty, aiVersion));
    try {
      if (!this.worker) {
        this.worker = new InlineBotWorker();
        this.worker.onmessage = event => {
          const job = this.jobs.get(event.data.id);
          if (!job) return;
          this.jobs.delete(event.data.id);
          if (event.data.error) job.reject(new Error(event.data.error));
          else job.resolve(event.data.decision);
        };
        this.worker.onerror = () => {
          this.unavailable = true;
          this.worker?.terminate();
          this.worker = null;
          for (const [id, job] of this.jobs) {
            this.jobs.delete(id);
            try { job.resolve(chooseRiichiAction(job.observation, job.actions, job.difficulty, job.aiVersion)); }
            catch (error) { job.reject(error); }
          }
        };
      }
      return new Promise((resolve, reject) => {
        const id = ++this.nextId;
        this.jobs.set(id, { observation, actions, difficulty, aiVersion, resolve, reject });
        try { this.worker!.postMessage({ id, observation, actions, difficulty, aiVersion }); }
        catch (error) { this.jobs.delete(id); reject(error); }
      });
    } catch {
      this.unavailable = true;
      return Promise.resolve(chooseRiichiAction(observation, actions, difficulty, aiVersion));
    }
  }

  cancel(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.jobs.values()) job.resolve(null);
    this.jobs.clear();
  }
}
