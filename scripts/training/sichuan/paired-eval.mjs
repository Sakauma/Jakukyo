import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';

const options = Object.fromEntries(process.argv.slice(2).map(value => {
  const index = value.indexOf('='); return index < 0 ? [value, true] : [value.slice(0, index), value.slice(index + 1)];
}));
if (options['--help']) {
  console.log('node paired-eval.mjs runDir=PATH [count=4] [prefix=sc-v2-compare] [model=CHECKPOINT_NAME]\nRuns the pure v7 algorithm and four seat rotations of each hybrid on identical seeded walls.\nThe default comparison uses best-bc.json and rl-3.json from runDir/models.\nmodel=NAME evaluates one checkpoint. Reports and raw paired results are retained inside runDir.');
  process.exit(0);
}
if (!options.runDir) throw new Error('runDir is required');
const root = resolve(options.runDir), count = Number(options.count ?? 4), prefix = options.prefix ?? 'sc-v2-compare';
if (!Number.isSafeInteger(count) || count <= 0) throw new Error('count must be a positive integer');
const directory = join(root, 'evaluation', prefix);
mkdirSync(directory, { recursive: true });
function rollout(name, seat, model) {
  const output = join(directory, `${name}-${seat}.jsonl`);
  const args = [join(import.meta.dirname, 'rollout.mjs'), `engine=${join(root, 'engine.mjs')}`,
    `runDir=${root}`,
    `count=${count}`, `prefix=${prefix}`, `output=${output}`, `seat=${seat}`, 'greedy', 'quiet'];
  if (model) args.push(`model=${join(root, 'models', model + '.json')}`, 'hybrid');
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr ?? `Exit ${result.status}`);
  writeFileSync(join(directory, `${name}-${seat}.log`), result.stdout + result.stderr);
  return JSON.parse(readFileSync(output.replace('.jsonl', '.summary.json'), 'utf8'));
}
const baseline = rollout('algorithm', 0, null);
const names = options.model ? [[options.model, options.model]] : [['bc-hybrid', 'best-bc'], ['rl-hybrid', 'rl-3']];
const variants = [];
for (const [name, checkpoint] of names) {
  const rotations = [];
  let focused = 0, changed = 0, protectedCalls = 0;
  for (let seat = 0; seat < 4; seat++) {
    const report = rollout(name, seat, checkpoint);
    assert.equal(report.legalErrors, 0);
    for (let game = 0; game < count; game++) {
      const result = report.summaries[game], original = baseline.summaries[game];
      assert.equal(result.seed, original.seed);
      assert.equal(result.wallSha256, original.wallSha256);
      focused += result.modelStats.focusedDecisions;
      changed += result.modelStats.changedActions;
      protectedCalls += result.modelStats.protectedCalls;
      rotations.push({ seed: result.seed, seat, wallSha256: result.wallSha256, baselineNet: original.deltas[seat],
        net: result.deltas[seat], difference: result.deltas[seat] - original.deltas[seat],
        won: result.winners.includes(seat), kind: result.kind, modelStats: result.modelStats });
    }
  }
  const bySeed = baseline.summaries.map(original => {
    const games = rotations.filter(game => game.seed === original.seed);
    return { seed: original.seed, net: games.reduce((sum, game) => sum + game.net, 0) / 4,
      difference: games.reduce((sum, game) => sum + game.difference, 0) / 4 };
  });
  const summary = { name, checkpoint, seedUnits: count, games: rotations.length,
    meanNet: rotations.reduce((sum, game) => sum + game.net, 0) / rotations.length,
    meanPairedDifference: rotations.reduce((sum, game) => sum + game.difference, 0) / rotations.length,
    winRate: rotations.filter(game => game.won).length / rotations.length,
    focusedDecisions: focused, changedActions: changed, protectedCalls, bySeed, rotations };
  variants.push(summary);
  console.log(JSON.stringify({ ...summary, rotations: undefined }));
}
const report = { prefix, pairingUnit: 'full seed wall, averaged over four model seats against three v7 expert algorithms',
  count, baseline: baseline.summaries, variants, legalErrors: 0,
  selection: 'compare mean paired net, then validation teacher cross-entropy to break a tie' };
writeFileSync(join(root, `${prefix}-report.json`), JSON.stringify(report, null, 2));
