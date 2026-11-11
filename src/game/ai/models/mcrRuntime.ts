import * as ort from 'onnxruntime-web/wasm';
import source from './mcr/source.json';
import { MCR_ACTION_SIZE, MCR_FEATURE_SIZE } from './mcrFeatures';
import type { McrModelAssets } from './mcrAssets';

let modelSession: Promise<ort.InferenceSession> | undefined;

async function unpack(data: ArrayBuffer): Promise<Uint8Array> {
  const decompressed = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(decompressed).arrayBuffer());
}

async function verify(bytes: Uint8Array, expected: string): Promise<void> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== expected) throw new Error('本地模型资源校验失败。');
}

export function initializeMcrModel(assets: McrModelAssets): Promise<ort.InferenceSession> {
  modelSession ??= (async () => {
    const [weights, wasm] = await Promise.all([unpack(assets.weightsGzip), unpack(assets.wasmGzip)]);
    const graph = new Uint8Array(assets.graph);
    await Promise.all([
      verify(graph, '73622a9f16a13d1950bd4ebb9df204c969f05d04811812fcb113a3b06f2bfac4'),
      verify(weights, '17c0b27836de89019981b75338b22dd1fa1598de9fcff714117737a2b4205a77'),
      verify(wasm, source.runtime.wasm.sha256),
    ]);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmBinary = wasm;
    return ort.InferenceSession.create(graph, { executionProviders: ['wasm'], graphOptimizationLevel: 'all',
      externalData: [{ path: 'mcr-kdens-s0-weights.bin', data: weights }] });
  })();
  return modelSession;
}

export async function inferMcrPolicy(features: Float32Array, mask: Float32Array): Promise<Float32Array> {
  if (!modelSession) throw new Error('本地模型尚未加载。');
  if (features.length !== MCR_FEATURE_SIZE || mask.length !== MCR_ACTION_SIZE) throw new Error('国标模型输入尺寸错误。');
  const session = await modelSession;
  const result = await session.run({ observation: new ort.Tensor('float32', features, [1, 38, 4, 9]),
    mask: new ort.Tensor('float32', mask, [1, 235]) });
  const values = result.logits.data as Float32Array;
  if (values.length !== MCR_ACTION_SIZE || values.some(value => !Number.isFinite(value))) throw new Error('国标模型输出无效。');
  return Float32Array.from(values, (value, index) => mask[index] ? value : -1e9);
}
