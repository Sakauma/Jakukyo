import graphUrl from './mcr/graph.onnx?url';
import weightsUrl from '../../../generated/ai/mcr-weights.bin.gz?url';
import wasmUrl from '../../../generated/ai/ort-wasm-simd-threaded.wasm.gz?url';

export interface McrModelAssets {
  graph: ArrayBuffer;
  weightsGzip: ArrayBuffer;
  wasmGzip: ArrayBuffer;
}

export async function assetBytes(url: string): Promise<ArrayBuffer> {
  if (url.startsWith('data:')) {
    const content = atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(content.length);
    for (let index = 0; index < content.length; index++) bytes[index] = content.charCodeAt(index);
    return bytes.buffer;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error('本地模型资源读取失败。');
  return response.arrayBuffer();
}

export function loadWasmAsset(): Promise<ArrayBuffer> { return assetBytes(wasmUrl); }

/** Large resources live in the main bundle once, then transfer to its single worker. */
export async function loadMcrAssets(): Promise<McrModelAssets> {
  const [graph, weightsGzip, wasmGzip] = await Promise.all([assetBytes(graphUrl), assetBytes(weightsUrl), loadWasmAsset()]);
  return { graph, weightsGzip, wasmGzip };
}
