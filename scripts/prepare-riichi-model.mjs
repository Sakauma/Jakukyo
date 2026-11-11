import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { EnvHttpProxyAgent } = require('undici');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modelDirectory = join(root, 'src/game/ai/models/riichi');
const source = JSON.parse(await readFile(join(modelDirectory, 'source.json'), 'utf8'));
const layout = JSON.parse(await readFile(join(modelDirectory, 'layout.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function verify(bytes, expected) {
  if (bytes.length !== expected.bytes || hash(bytes) !== expected.sha256) throw new Error('Pinned riichi model resource verification failed.');
}
async function writeAtomic(destination, bytes) {
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, bytes); await rename(temporary, destination);
}
const started = performance.now();
verify(await readFile(join(modelDirectory, 'graph.onnx')), source.graph);
const cacheDirectory = join(root, '.cache/models');
await mkdir(cacheDirectory, { recursive: true });
const cachePath = join(cacheDirectory, 'tanyao-bc-v2-g186.pkl');
let checkpoint;
try { checkpoint = await readFile(cachePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
let downloaded = false;
if (!checkpoint || checkpoint.length !== source.weights.bytes || hash(checkpoint) !== source.weights.sha256) {
  const dispatcher = new EnvHttpProxyAgent();
  try {
    const response = await fetch(source.weights.url, { dispatcher, signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('Riichi model download failed.');
    checkpoint = Buffer.from(await response.arrayBuffer()); verify(checkpoint, source.weights);
    await writeAtomic(cachePath, checkpoint); downloaded = true;
  } finally { await dispatcher.close(); }
}
verify(checkpoint, source.weights);
const weights = Buffer.alloc(source.deployment.bytes);
// The fixed-hash publisher checkpoint is sliced as bytes. No pickle code is evaluated.
for (const entry of layout.entries) {
  const raw = checkpoint.subarray(entry.offset, entry.offset + entry.bytes);
  verify(raw, entry);
  if (entry.targetBytes !== raw.length || entry.targetOffset < 0 || entry.targetOffset + raw.length > weights.length) throw new Error('Riichi tensor layout is invalid.');
  if (entry.transpose) {
    if (entry.transpose.join() !== '2,1,0') throw new Error('Unsupported riichi tensor transpose.');
    const [width, inputs, outputs] = entry.shape;
    for (let position = 0; position < width; position++) {
      for (let input = 0; input < inputs; input++) {
        for (let channel = 0; channel < outputs; channel++) {
          const sourceOffset = ((position * inputs + input) * outputs + channel) * 4;
          const destination = entry.targetOffset + ((channel * inputs + input) * width + position) * 4;
          weights.writeUInt32LE(raw.readUInt32LE(sourceOffset), destination);
        }
      }
    }
  } else raw.copy(weights, entry.targetOffset);
}
verify(weights, source.deployment);
const outputDirectory = join(root, 'src/generated/ai');
await mkdir(outputDirectory, { recursive: true });
const compressed = gzipSync(weights, { level: 9, mtime: 0 });
await writeAtomic(join(outputDirectory, 'tanyao-weights.bin.gz'), compressed);
console.log(JSON.stringify({ model: source.id, downloaded, elapsedMs: Math.round(performance.now() - started),
  artifact: { file: 'tanyao-weights.bin.gz', bytes: compressed.length, sha256: hash(compressed) } }));
