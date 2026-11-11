import * as ort from 'onnxruntime-web/wasm';
import source from './riichi/source.json';
import type { McrModelAssets } from './mcrAssets';
import type { TanyaoFeatures } from './tanyaoFeatures';

let modelSession: Promise<ort.InferenceSession> | undefined;
async function unpack(data: ArrayBuffer): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
async function verify(bytes: Uint8Array, expected: string): Promise<void> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  if (Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') !== expected) throw new Error('立直模型资源校验失败。');
}
export function initializeTanyaoModel(assets: McrModelAssets): Promise<ort.InferenceSession> {
  modelSession ??= (async () => {
    const [weights, wasm] = await Promise.all([unpack(assets.weightsGzip), unpack(assets.wasmGzip)]);
    const graph = new Uint8Array(assets.graph);
    await Promise.all([verify(graph, source.graph.sha256), verify(weights, source.deployment.sha256), verify(wasm, source.runtime.wasmSha256)]);
    ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false; ort.env.wasm.wasmBinary = wasm;
    return ort.InferenceSession.create(graph, { executionProviders: ['wasm'], graphOptimizationLevel: 'all',
      externalData: [{ path: 'tanyao-bc-v2-g186-weights.bin', data: weights }] });
  })();
  return modelSession;
}
export async function inferTanyaoPolicy(features: TanyaoFeatures): Promise<Float32Array> {
  if (!modelSession || features.planes.length !== 34 * 36 || features.scalars.length !== 32) throw new Error('立直模型输入未就绪。');
  const session = await modelSession;
  const result = await session.run({ planes: new ort.Tensor('float32', features.planes, [1, 34, 36]), scalars: new ort.Tensor('float32', features.scalars, [1, 32]) });
  const logits = result.logits.data as Float32Array;
  if (logits.length !== 87 || logits.some(value => !Number.isFinite(value))) throw new Error('立直模型输出无效。');
  return Float32Array.from(logits);
}
