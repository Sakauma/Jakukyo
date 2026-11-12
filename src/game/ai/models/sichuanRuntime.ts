import { SICHUAN_ACTIONS, SICHUAN_FEATURES } from './sichuanFeatures';

interface DenseLayerData { input: number; output: number; relu: boolean; weight: string; bias: string }
export interface SichuanPolicyData {
  format: string;
  featureVersion: number;
  policyVersion: number;
  parametersSha256: string;
  layers: DenseLayerData[];
}
export interface SichuanPrediction { logits: Float32Array; value: number }

/** The same float32 dense inference is used by headless self-play and the offline game. */
export function createSichuanPolicy(model: SichuanPolicyData): (features: Float32Array) => SichuanPrediction {
  if (model.format !== 'jakukyo-sichuan-mlp-f32-v1' || model.featureVersion !== 1 || model.policyVersion !== 1
    || model.layers.length !== 3) throw new Error('四川模型格式不兼容。');
  const decode = (encoded: string) => {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, value => value.charCodeAt(0));
    const floats = new Float32Array(bytes.buffer);
    if (floats.some(value => !Number.isFinite(value))) throw new Error('四川模型权重损坏。');
    return floats;
  };
  const dimensions = [SICHUAN_FEATURES, 128, 128, SICHUAN_ACTIONS + 1];
  const layers = model.layers.map((layer, index) => {
    const weight = decode(layer.weight), bias = decode(layer.bias);
    if (layer.input !== dimensions[index] || layer.output !== dimensions[index + 1]
      || weight.length !== layer.input * layer.output || bias.length !== layer.output
      || layer.relu !== (index < 2)) throw new Error('四川模型层尺寸不兼容。');
    return { ...layer, weight, bias };
  });
  return features => {
    if (features.length !== SICHUAN_FEATURES || features.some(value => !Number.isFinite(value))) throw new Error('四川模型观测无效。');
    let hidden = features;
    for (const layer of layers) {
      const output = new Float32Array(layer.output);
      for (let row = 0; row < layer.output; row++) {
        let value = layer.bias[row];
        const offset = row * layer.input;
        for (let column = 0; column < layer.input; column++) value += layer.weight[offset + column] * hidden[column];
        output[row] = layer.relu ? Math.max(0, value) : value;
      }
      hidden = output;
    }
    if (hidden.some(value => !Number.isFinite(value))) throw new Error('四川模型输出无效。');
    return { logits: hidden.subarray(0, SICHUAN_ACTIONS), value: hidden[SICHUAN_ACTIONS] };
  };
}
