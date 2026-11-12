import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function buildEngine(source, output, features = true, dependencyPath) {
  source = resolve(source);
  output = resolve(output);
  const projectLockBytes = await readFile(join(source, 'package-lock.json'));
  const projectLock = JSON.parse(projectLockBytes);
  const dependencyRoot = resolve(dependencyPath ?? join(dirname(output), 'js'));
  const { build } = await import(pathToFileURL(join(dependencyRoot, 'node_modules/esbuild/lib/main.js')));
  const isolatedLock = JSON.parse(await readFile(join(dependencyRoot, 'package-lock.json'), 'utf8'));
  const dependencies = {};
  for (const name of ['@kobalab/majiang-core', 'gb-mahjong-js', 'esbuild']) {
    const expected = projectLock.packages[`node_modules/${name}`];
    const installed = isolatedLock.packages[`node_modules/${name}`];
    const actual = JSON.parse(await readFile(join(dependencyRoot, 'node_modules', name, 'package.json'), 'utf8'));
    if (!expected || expected.version !== installed?.version || expected.integrity !== installed.integrity || actual.version !== expected.version) {
      throw new Error(`Headless dependency differs from project lock: ${name}`);
    }
    dependencies[name] = { version: actual.version, integrity: installed.integrity };
  }
  await mkdir(dirname(output), { recursive: true });
  const exports = [
    `export { RegionalSession } from ${JSON.stringify(join(source, 'src/game/variants/session.ts'))};`,
    `export { createGameSession } from ${JSON.stringify(join(source, 'src/game/runtime.ts'))};`,
    `export { RiichiSession } from ${JSON.stringify(join(source, 'src/game/index.ts'))};`,
    `export { chooseRegionalAction } from ${JSON.stringify(join(source, 'src/game/ai/regional.ts'))};`,
    `export { createRecordStore } from ${JSON.stringify(join(source, 'src/records/store.ts'))};`,
  ];
  if (features) {
    exports.push(`export * from ${JSON.stringify(join(source, 'src/game/ai/models/sichuanFeatures.ts'))};`);
    exports.push(`export * from ${JSON.stringify(join(source, 'src/game/ai/models/sichuanRuntime.ts'))};`);
    exports.push(`export * from ${JSON.stringify(join(source, 'src/game/ai/models/sichuanHybrid.ts'))};`);
  }
  await build({
    stdin: { contents: exports.join('\n'), resolveDir: source, loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: output,
    nodePaths: [join(dependencyRoot, 'node_modules')],
    plugins: [{ name: 'headless-assets', setup(builder) {
      builder.onResolve({ filter: /\?(worker&inline|url)$/ }, args => ({ path: args.path, namespace: 'headless' }));
      builder.onLoad({ filter: /.*/, namespace: 'headless' }, args => ({
        contents: args.path.includes('worker') ? 'export default class HeadlessWorker {}' : 'export default "headless-asset"', loader: 'js',
      }));
    } }],
  });
  await writeFile(output.replace(/\.mjs$/, '.dependencies.json'), JSON.stringify({
    projectLockSha256: createHash('sha256').update(projectLockBytes).digest('hex'), dependencies,
  }, null, 2));
  return output;
}

if (process.argv[1] === import.meta.filename) {
  if (process.argv.includes('--help')) {
    console.log('node build-engine.mjs SOURCE OUTPUT.mjs [DEPENDENCY_ROOT]\nBundles the headless engine and verifies dependency versions and SRI against SOURCE/package-lock.json.\nDEPENDENCY_ROOT contains node_modules and package-lock.json. A project copy after npm ci can be used directly.\nThe default dependency root is the js folder beside OUTPUT.mjs.');
    process.exit(0);
  }
  if (!process.argv[2] || !process.argv[3]) throw new Error('SOURCE OUTPUT.mjs [DEPENDENCY_ROOT] are required');
  console.log(await buildEngine(process.argv[2], process.argv[3], true, process.argv[4]));
}
