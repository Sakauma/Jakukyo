import graphUrl from './riichi/graph.onnx?url';
import weightsUrl from '../../../generated/ai/tanyao-weights.bin.gz?url';
import { assetBytes, loadWasmAsset } from './mcrAssets';
import type { McrModelAssets } from './mcrAssets';

export async function loadTanyaoAssets(): Promise<McrModelAssets> {
  const [graph, weightsGzip, wasmGzip] = await Promise.all([assetBytes(graphUrl), assetBytes(weightsUrl), loadWasmAsset()]);
  return { graph, weightsGzip, wasmGzip };
}
