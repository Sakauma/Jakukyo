import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { collectLicenses } from '../desktop/collect-licenses.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output')) {
  throw new Error('Usage: npm run build:offline -- [--output path/to/Jakukyo-offline.html]');
}
const destination = resolve(args[1] ?? join(root, 'release', 'Jakukyo-offline.html'));
if (!destination.toLowerCase().endsWith('.html')) throw new Error('The offline output must be one .html file.');

// Vite emits into memory; only the final self-contained document is written.
const result = await build({ root, mode: 'offline', build: { write: false, reportCompressedSize: false } });
const outputs = (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output);
const byName = new Map(outputs.map(output => [output.fileName, output]));
const htmlOutput = byName.get('index.html');
if (!htmlOutput || htmlOutput.type !== 'asset') throw new Error('Vite did not produce index.html.');
const asText = output => typeof output.source === 'string' ? output.source : Buffer.from(output.source).toString('utf8');
const chunks = outputs.filter(output => output.type === 'chunk');
for (const chunk of chunks) {
  if (chunk.imports.length || chunk.dynamicImports.length) throw new Error(`Unbundled JavaScript import in ${chunk.fileName}.`);
}

const embedded = new Set(['index.html']);
const fragments = [];
const fragment = content => {
  const marker = `<!--jakukyo-offline-fragment-${fragments.length}-->`;
  fragments.push({ marker, content });
  return marker;
};
const escapeClosingTag = (text, tag) => text.replace(new RegExp(`</${tag}`, 'gi'), match => match.replace('/', '\\/'));
const outputFor = reference => byName.get(reference.replace(/^\.\//, '').replace(/^\//, ''));
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2];

let scriptCount = 0, styleCount = 0;
let html = asText(htmlOutput).replace(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>\s*<\/script>/gi, (_tag, _quote, reference) => {
  const output = outputFor(reference);
  if (!output || output.type !== 'chunk') throw new Error(`Cannot inline script ${reference}.`);
  embedded.add(output.fileName);
  scriptCount++;
  return fragment(`<script type="module">${escapeClosingTag(output.code, 'script')}</script>`);
});

html = html.replace(/<link\b[^>]*>/gi, tag => {
  if (attribute(tag, 'rel') !== 'stylesheet') throw new Error(`Unsupported linked resource: ${tag}`);
  const reference = attribute(tag, 'href');
  const output = reference && outputFor(reference);
  if (!output || output.type !== 'asset' || !output.fileName.endsWith('.css')) throw new Error(`Cannot inline stylesheet ${reference}.`);
  const css = asText(output);
  if (/@import\b/i.test(css)) throw new Error('An external CSS import remains.');
  for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)) {
    const url = (match[1] ?? match[2] ?? match[3]).trim();
    if (!/^(data:|#)/i.test(url)) throw new Error(`A stylesheet resource was not embedded: ${url}`);
  }
  embedded.add(output.fileName);
  styleCount++;
  return fragment(`<style>${escapeClosingTag(css, 'style')}</style>`);
});

if (scriptCount !== 1 || !styleCount) throw new Error('Expected one bundled script and embedded styles.');
for (const match of html.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi)) {
  if (!/^(data:|#)/i.test(match[2])) throw new Error(`An HTML resource was not embedded: ${match[2]}`);
}
for (const output of outputs) {
  if (!embedded.has(output.fileName)) throw new Error(`A separate build resource remains: ${output.fileName}`);
}

const code = chunks.map(chunk => chunk.code).join('\n');
const tileDirectory = join(root, 'src', 'table', 'assets', 'tiles');
const tileFiles = (await readdir(tileDirectory)).filter(name => name.endsWith('.png'));
for (const name of tileFiles) {
  const dataUrl = `data:image/png;base64,${(await readFile(join(tileDirectory, name))).toString('base64')}`;
  if (!code.includes(dataUrl)) throw new Error(`Tile artwork is not embedded: ${name}`);
}
const workerSource = await readFile(join(root, 'src', 'game', 'ai', 'service.ts'), 'utf8');
if (!workerSource.includes('?worker&inline')) throw new Error('The AI Worker must use Vite inline Worker packaging.');

for (const { marker, content } of fragments) html = html.replace(marker, () => content);
const licenses = {
  project: await readFile(join(root, 'LICENSE'), 'utf8'),
  thirdParty: await collectLicenses(root, { electronRuntime: false }),
};
// Inert JSON keeps the complete notices in the document without changing the UI.
const licenseJson = JSON.stringify(licenses).replace(/</g, '\\u003c');
html = html.replace('</body>', () => `<script type="application/json" id="jakukyo-licenses">${licenseJson}</script>\n  </body>`);
if (!html.includes('id="jakukyo-licenses"')) throw new Error('The offline document is missing its license notices.');

await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, html, 'utf8');
console.log(JSON.stringify({
  output: destination,
  bytes: Buffer.byteLength(html),
  sha256: createHash('sha256').update(html).digest('hex'),
  embeddedScripts: scriptCount,
  embeddedStylesheets: styleCount,
  embeddedTileImages: tileFiles.length,
  separateResources: 0,
  externalModuleImports: 0,
  worker: 'inline',
  licenses: 'embedded',
}, null, 2));
