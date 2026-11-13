import InlineAnalysisWorker from './analysisWorker?worker&inline';
import { loadMcrAssets } from '../game/ai/models/mcrAssets';
import { loadTanyaoAssets } from '../game/ai/models/tanyaoAssets';
import type { ReplayDecisionAnalysis } from '../game/replayAnalysis';
import type { ReplayDecisionPoint } from '../game/types';

interface PendingAnalysis {
  resolve: (value: ReplayDecisionAnalysis | null) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ReplayAnalysisService {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, PendingAnalysis>();
  private prepared = new Map<'riichi' | 'mcr', Promise<boolean>>();

  async analyze(point: ReplayDecisionPoint): Promise<ReplayDecisionAnalysis | null> {
    if (typeof Worker === 'undefined') return Promise.reject(new Error('此浏览器暂时无法运行牌谱分析。'));
    if (!this.worker) {
      const worker = new InlineAnalysisWorker();
      this.worker = worker;
      worker.onmessage = event => {
        if (this.worker !== worker) return;
        const task = this.pending.get(event.data.id);
        if (!task) return;
        this.pending.delete(event.data.id);
        clearTimeout(task.timer);
        if (event.data.analysis) task.resolve(event.data.analysis as ReplayDecisionAnalysis);
        else task.reject(new Error(event.data.error || '本次决策分析未能完成。'));
      };
      worker.onerror = () => { if (this.worker === worker) this.fail('牌谱分析暂时中断，请重试。'); };
    }
    const worker = this.worker;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) this.fail('本次分析超时，请重试。');
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      const model = point.input.kind === 'riichi' ? 'riichi' : point.input.input.profile.id === 'mcr' ? 'mcr' : null;
      const ready = model ? this.prepare(model, worker) : Promise.resolve(false);
      void ready.then(modelReady => {
        if (this.worker !== worker || !this.pending.has(id)) return;
        try { worker.postMessage({ id, point, modelReady }); }
        catch { this.fail('无法发送这一步的分析数据，请重试。'); }
      });
    });
  }

  private prepare(model: 'riichi' | 'mcr', worker: Worker): Promise<boolean> {
    let prepared = this.prepared.get(model);
    if (!prepared) {
      prepared = (model === 'riichi' ? loadTanyaoAssets() : loadMcrAssets()).then(assets => {
        if (this.worker !== worker) return false;
        worker.postMessage({ id: 0, model, assets }, [assets.graph, assets.weightsGzip, assets.wasmGzip]);
        return true;
      }).catch(() => false);
      this.prepared.set(model, prepared);
    }
    return prepared;
  }

  cancel(): void {
    for (const task of this.pending.values()) {
      clearTimeout(task.timer);
      task.resolve(null);
    }
    this.pending.clear();
    try { this.worker?.postMessage({ id: 0, cancelThrough: this.sequence }); }
    catch { this.fail('牌谱分析暂时中断，请重试。'); }
  }

  private fail(message: string): void {
    const tasks = [...this.pending.values()];
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.prepared.clear();
    for (const task of tasks) {
      clearTimeout(task.timer);
      task.reject(new Error(message));
    }
  }

  dispose(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
    this.prepared.clear();
  }
}
