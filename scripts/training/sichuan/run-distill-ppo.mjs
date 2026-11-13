import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { resolve, join } from 'node:path';
const args = Object.fromEntries(process.argv.slice(2).map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; }));
if (!args.runDir || !args.python) throw new Error('runDir/python required');
const root = resolve(args.runDir), phase = args.phase ?? 'train';
if (!['train', 'audit'].includes(phase)) throw new Error('Unknown PPO phase');
const parameters = ['-B', join(import.meta.dirname, 'proposal-train.py'), 'train', '--run-dir', root,
  '--init', join(root, 'models/distill/best.pt'), '--anchor-data', join(root, 'data/train-informative.jsonl'),
  '--data', join(root, 'data/onpolicy.jsonl'), '--output', join(root, 'models/distill-ppo.pt'),
  '--engine', join(root, 'engine.mjs'), '--baseline-engine', join(root, 'baseline-engine.mjs'),
  '--epochs', '4', '--expected-hands', '800', '--seed-prefix', 'sichuan-distill-ppo-'];
if (phase === 'audit') parameters.push('--audit-only');
const logPath = join(root, 'logs', `ppo-${phase}.log`), log = createWriteStream(logPath);
const child = spawn(args.python, parameters, { windowsHide: true,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
const state = { phase, pid: child.pid, beganAt: new Date().toISOString(), status: 'running', logPath, epochs: 4 };
const statePath = join(root, 'reports', `ppo-${phase}-process.json`);
writeFileSync(statePath, JSON.stringify(state, null, 2)); console.log(JSON.stringify(state));
child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
const [code] = await once(child, 'exit'); log.end(); await once(log, 'finish');
state.status = code === 0 ? 'complete' : 'failed'; state.exitCode = code; state.endedAt = new Date().toISOString();
writeFileSync(statePath, JSON.stringify(state, null, 2));
if (code !== 0) { process.stderr.write(readFileSync(logPath, 'utf8')); process.exitCode = code ?? 1; }
console.log(JSON.stringify(state));
