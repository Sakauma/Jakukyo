import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { resolve, join } from 'node:path';
import { makeBalancedPlan } from './rules-matrix.mjs';
const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const at = value.indexOf('='); return at < 0 ? [value, true] : [value.slice(0, at), value.slice(at + 1)];
}));
if (!args.runDir) throw new Error('runDir is required');
const root = resolve(args.runDir), start = Number(args.start ?? 0), rounds = Number(args.rounds ?? 4);
if (!Number.isSafeInteger(start) || !Number.isSafeInteger(rounds) || start < 0 || rounds <= start) throw new Error('Invalid PPO round range');
const state = { beganAt: new Date().toISOString(), start, rounds, active: null, completed: [] };
const stateFile = join(root, 'reports', 'ppo-state.json');
async function run(executable, parameters, stage, round) {
  const logPath = join(root, 'logs', `${stage}-${round}.log`), log = createWriteStream(logPath);
  const child = spawn(executable, parameters, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  state.active = { stage, round, pid: child.pid, log: logPath, beganAt: new Date().toISOString() };
  await writeFile(stateFile, JSON.stringify(state, null, 2));
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const [code] = await once(child, 'exit'); log.end();
  if (code !== 0) throw new Error(`${stage} round ${round} failed with exit ${code}`);
}
try {
  for (let round = start; round < rounds; round++) {
    const prior = round ? `rules-ppo-${round - 1}` : 'best-bc', prefix = `selfplay-${round}`, plan = join(root, 'data', prefix + '-plan.json');
    await writeFile(plan, JSON.stringify(makeBalancedPlan(`sichuan-rules-ppo-20261113-round-${round}`, 40), null, 2));
    await run(process.execPath, [join(import.meta.dirname, 'rules-run.mjs'), `runDir=${root}`, `plan=${plan}`, `prefix=${prefix}`,
      'mode=actor', 'workers=4', `model=${join(root, 'models', prior + '.json')}`], 'selfplay', round);
    await run(args.python ?? join(root, 'pyenv/Scripts/python.exe'), [join(import.meta.dirname, 'train.py'), 'ppo', '--run-dir', root,
      '--feature-version', '2', '--seed', '20261113', '--epochs', '4', '--batch', '512', '--resume', join(root, 'models', prior + '.pt'),
      '--data', join(root, 'data', prefix + '.jsonl'), '--output', join(root, 'models', `rules-ppo-${round}.pt`)], 'ppo', round);
    const result = JSON.parse(await readFile(join(root, 'models', `rules-ppo-${round}.report.json`), 'utf8'));
    const completed = { round, samples: result.samples, parametersSha256: result.parameters_sha256, logprobMaxError: result.rollout_logprob_max_error, validation: result.validation };
    state.completed.push(completed); state.active = null; await writeFile(stateFile, JSON.stringify(state, null, 2)); console.log(JSON.stringify(completed));
  }
  state.completedAt = new Date().toISOString();
} catch (error) { state.error = String(error); throw error; }
finally { await writeFile(stateFile, JSON.stringify(state, null, 2)); }
