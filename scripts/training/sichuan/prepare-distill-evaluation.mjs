import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { makeBalancedPlan } from './rules-matrix.mjs';
const args = Object.fromEntries(process.argv.slice(2).map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; }));
if (!args.runDir) throw new Error('runDir required');
const root = resolve(args.runDir), phase = args.phase ?? 'ppo';
if (phase === 'ppo') {
  const plan = makeBalancedPlan('sichuan-distill-ppo-20261113-v1', 100).map((entry, index) => ({ ...entry, candidateSeat: index % 4 }));
  writeFileSync(join(root, 'data/onpolicy-plan.json'), JSON.stringify(plan));
  console.log(JSON.stringify({ hands: plan.length, model: join(root, 'models/distill/best.json') }));
} else if (phase === 'selection') {
  const distilled = join(root, 'models/distill/best.json'), ppo = join(root, 'models/distill-ppo.json');
  for (const path of [distilled, ppo]) if (JSON.parse(readFileSync(path)).featureVersion !== 3) throw new Error('Distilled candidates require feature version 3');
  writeFileSync(join(root, 'data/selection-candidates.json'), JSON.stringify([
    { name: 'distilled', path: distilled, prior: 'model', selectable: true },
    { name: 'distill-ppo', path: ppo, prior: 'model', selectable: true },
    { name: 'terminal-only', path: distilled, prior: 'terminal', selectable: false },
  ]));
} else throw new Error('Unknown preparation phase');
