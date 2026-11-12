import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const options = Object.fromEntries(process.argv.slice(2).map(value => {
  const index = value.indexOf('='); return index < 0 ? [value, true] : [value.slice(0, index), value.slice(index + 1)];
}));
if (options['--help']) {
  console.log('node continue-ppo.mjs runDir=PATH [python=PYTHON.exe] [start=0] [rounds=4] [games=16]\nCollects complete self-play hands, then runs four PPO epochs per round with batch 256.\nrounds is the exclusive total endpoint. start=1 rounds=4 executes rounds 1, 2 and 3.\nRound zero starts from best-bc.pt. Subsequent rounds restore the preceding checkpoint and optimizer.\nAll data, logs and checkpoints are written inside runDir. Python defaults to runDir/pyenv/Scripts/python.exe.');
  process.exit(0);
}
if (!options.runDir) throw new Error('runDir is required');
const root = resolve(options.runDir);
const python = options.python ?? join(root, 'pyenv/Scripts/python.exe');
const start = Number(options.start ?? 0), rounds = Number(options.rounds ?? 4), games = Number(options.games ?? 16);
if (!Number.isSafeInteger(start) || start < 0) throw new Error('start must be a nonnegative integer');
if (!Number.isSafeInteger(rounds) || rounds <= start) throw new Error('rounds must be a positive exclusive endpoint greater than start');
if (!Number.isSafeInteger(games) || games <= 0) throw new Error('games must be a positive integer');
function run(executable, args, log) {
  const result = spawnSync(executable, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  writeFileSync(log, (result.stdout ?? '') + (result.stderr ?? ''));
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr ?? `Exit ${result.status}`);
}
for (let round = start; round < rounds; round++) {
  const prior = round ? `rl-${round - 1}` : 'best-bc';
  const prefix = `sc-v2-selfplay-${round}`;
  run(process.execPath, [join(import.meta.dirname, 'rollout.mjs'), `count=${games}`, `prefix=${prefix}`,
    `runDir=${root}`,
    `engine=${join(root, 'engine.mjs')}`, `output=${join(root, 'data', prefix + '.jsonl')}`,
    `model=${join(root, 'models', prior + '.json')}`], join(root, `rollout-${round}.log`));
  run(python, [join(import.meta.dirname, 'train.py'), 'ppo', '--run-dir', root, '--resume', join(root, 'models', prior + '.pt'),
    '--data', join(root, 'data', prefix + '.jsonl'), '--output', join(root, 'models', `rl-${round}.pt`),
    '--epochs', '4', '--batch', '256'], join(root, `rl-${round}.log`));
  const report = JSON.parse(readFileSync(join(root, 'models', `rl-${round}.report.json`), 'utf8'));
  console.log(JSON.stringify({ round, games, samples: report.samples, validation: report.validation,
    logprobError: report.rollout_logprob_max_error, parametersSha256: report.parameters_sha256 }));
}
