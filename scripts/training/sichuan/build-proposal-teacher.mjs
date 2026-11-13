import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { buildEngine } from './build-engine.mjs';
import { makeBalancedPlan } from './rules-matrix.mjs';
const args = Object.fromEntries(process.argv.slice(2).map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; }));
if (!args.runDir || !args.source || !args.dependencies || !args.incumbent) throw new Error('runDir/source/dependencies/incumbent required');
const root = resolve(args.runDir), source = resolve(args.source);
for (const name of ['data', 'models', 'reports', 'logs', 'engines', 'evaluation']) await mkdir(join(root, name), { recursive: true });
const enginePath = join(root, 'engine.mjs');
await buildEngine(source, enginePath, true, args.dependencies, [`export * from ${JSON.stringify(join(source, 'scripts/training/sichuan/proposalTeacher.ts'))};`]);
await writeFile(join(root, 'baseline-engine.mjs'), await readFile(args.incumbent));
await writeFile(join(root, 'models/warm.json'), await readFile(join(source, 'src/game/ai/models/sichuan/proposal-weights.json')));
for (const [split, count] of [['train', 120], ['val', 40], ['select', 80], ['final', 340]]) {
  const namespace = `sichuan-distill-${split}-20261113-v1`;
  const plan = makeBalancedPlan(namespace, count).map((entry, index) => ({ ...entry, candidateSeat: index % 4 }));
  await writeFile(join(root, `data/${split}-plan.json`), JSON.stringify(plan));
  if (split === 'train') await writeFile(join(root, 'data/pilot-plan.json'), JSON.stringify(plan.filter((_, index) => index % 120 < 8)));
}
console.log(JSON.stringify({ root, enginePath, pilotGames: 64, trainingGames: 960, validationGames: 320 }));
