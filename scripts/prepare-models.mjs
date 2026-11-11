import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, inflateRawSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { EnvHttpProxyAgent } = require('undici');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modelDirectory = join(root, 'src/game/ai/models/mcr');
const outputDirectory = join(root, 'src/generated/ai');
const layout = JSON.parse(await readFile(join(modelDirectory, 'layout.json'), 'utf8'));
const source = JSON.parse(await readFile(join(modelDirectory, 'source.json'), 'utf8'));

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function verify(bytes, expected, label) {
  if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) {
    throw new Error(`${label} failed its fixed size or SHA-256 verification.`);
  }
}

async function writeAtomic(destination, bytes) {
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, bytes);
  await rename(temporary, destination);
}

async function sourceArchive() {
  const cacheDirectory = join(root, '.cache/models');
  const cachePath = join(cacheDirectory, 'mcr-kdens-s0-fp16.npz');
  await mkdir(cacheDirectory, { recursive: true });
  let cached;
  try {
    cached = await readFile(cachePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (cached && cached.length === source.weights.bytes && sha256(cached) === source.weights.sha256) {
    return { archive: cached, downloaded: false };
  }
  let dispatcher;
  let archive;
  try {
    dispatcher = new EnvHttpProxyAgent();
    const response = await fetch(source.weights.url, { dispatcher, signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('Model download failed.');
    archive = Buffer.from(await response.arrayBuffer());
  } catch {
    throw new Error('Model download failed. Check the network connection and proxy settings.');
  } finally {
    await dispatcher?.close();
  }
  verify(archive, source.weights, 'Publisher NPZ');
  await writeAtomic(cachePath, archive);
  return { archive, downloaded: true };
}

/** NPZ stores NPY arrays in a ZIP archive. Its fixed source hash is checked first. */
function zipEntries(archive) {
  const footer = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (footer < 0 || footer + 22 > archive.length) throw new Error('NPZ ZIP footer is missing.');
  const count = archive.readUInt16LE(footer + 10);
  let position = archive.readUInt32LE(footer + 16);
  const entries = new Map();
  for (let index = 0; index < count; index++) {
    if (archive.readUInt32LE(position) !== 0x02014b50) throw new Error('NPZ central directory is malformed.');
    const nameLength = archive.readUInt16LE(position + 28);
    const extraLength = archive.readUInt16LE(position + 30);
    const commentLength = archive.readUInt16LE(position + 32);
    const name = archive.toString('utf8', position + 46, position + 46 + nameLength);
    entries.set(name, {
      compression: archive.readUInt16LE(position + 10),
      compressedSize: archive.readUInt32LE(position + 20),
      uncompressedSize: archive.readUInt32LE(position + 24),
      localOffset: archive.readUInt32LE(position + 42),
    });
    position += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readNpy(archive, entry) {
  if (!entry) throw new Error('A required model tensor is missing.');
  const offset = entry.localOffset;
  if (archive.readUInt32LE(offset) !== 0x04034b50) throw new Error('NPZ local header is malformed.');
  const dataOffset = offset + 30 + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28);
  const compressed = archive.subarray(dataOffset, dataOffset + entry.compressedSize);
  let data;
  if (entry.compression === 8) data = inflateRawSync(compressed);
  else if (entry.compression === 0) data = compressed;
  else throw new Error(`Unsupported NPZ compression ${entry.compression}.`);
  if (data.length !== entry.uncompressedSize || data.toString('hex', 0, 6) !== '934e554d5059') {
    throw new Error('NPZ tensor header or size is invalid.');
  }
  const version = data[6];
  const headerOffset = version === 1 ? 10 : 12;
  const headerLength = version === 1 ? data.readUInt16LE(8) : data.readUInt32LE(8);
  const header = data.toString('latin1', headerOffset, headerOffset + headerLength);
  const dtype = header.match(/'descr':\s*'([^']+)'/)?.[1];
  const shapeText = header.match(/'shape':\s*\(([^)]*)\)/)?.[1];
  if (dtype !== '<f2' || !/'fortran_order':\s*False/.test(header) || shapeText === undefined) {
    throw new Error('The model requires little-endian FP16 C-order arrays.');
  }
  const shape = shapeText.split(',').map(value => value.trim()).filter(Boolean).map(Number);
  return { shape, bytes: data.subarray(headerOffset + headerLength) };
}

function externalWeights(archive) {
  const entries = zipEntries(archive);
  const result = Buffer.alloc(layout.weights.bytes);
  let completed = 0;
  for (const tensor of layout.tensors) {
    const parsed = readNpy(archive, entries.get(tensor.archiveEntry));
    if (JSON.stringify(parsed.shape) !== JSON.stringify(tensor.shape) || parsed.bytes.length !== tensor.length) {
      throw new Error(`Unexpected dimensions for ${tensor.archiveEntry}.`);
    }
    if (tensor.offset !== completed || tensor.offset + tensor.length > result.length) {
      throw new Error('The external-weight layout is inconsistent.');
    }
    parsed.bytes.copy(result, tensor.offset);
    completed += tensor.length;
  }
  if (completed !== result.length) throw new Error('The external-weight layout is incomplete.');
  verify(result, layout.weights, 'Rebuilt external weights');
  return result;
}

const started = performance.now();
const graph = await readFile(join(modelDirectory, layout.graph.file));
verify(graph, layout.graph, 'ONNX graph');
const ortDirectory = dirname(require.resolve('onnxruntime-web/wasm'));
const wasm = await readFile(join(ortDirectory, source.runtime.wasm.file));
verify(wasm, source.runtime.wasm, 'ONNX Runtime WASM');
const { archive, downloaded } = await sourceArchive();
const weights = externalWeights(archive);
await mkdir(outputDirectory, { recursive: true });
const artifacts = [
  { file: 'mcr-weights.bin.gz', bytes: gzipSync(weights, { level: 9 }) },
  { file: 'ort-wasm-simd-threaded.wasm.gz', bytes: gzipSync(wasm, { level: 9 }) },
];
for (const artifact of artifacts) {
  await writeAtomic(join(outputDirectory, artifact.file), artifact.bytes);
}
console.log(JSON.stringify({
  model: source.id,
  downloaded,
  elapsedMs: Math.round(performance.now() - started),
  artifacts: artifacts.map(artifact => ({ file: artifact.file, bytes: artifact.bytes.length, sha256: sha256(artifact.bytes) })),
}));
