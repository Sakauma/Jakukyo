import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const args = Object.fromEntries(process.argv.slice(2).map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; }));
if (!args.runDir) throw new Error('runDir required');
const root = resolve(args.runDir), frozen = JSON.parse(readFileSync(join(root, 'reports/frozen-candidate.json')));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
if (hash(frozen.enginePath) !== frozen.engineSha256 || hash(join(root, 'data/final-plan.json')) !== frozen.planSha256) throw new Error('Frozen final provenance changed');
const parameters = [join(import.meta.dirname, 'rules-eval.mjs'), `runDir=${root}`, `plan=${join(root, 'data/final-plan.json')}`,
  'prefix=final-v1', `frozenCandidate=${frozen.candidate}`, `candidates=${join(root, 'data/final-candidates.json')}`, `engine=${frozen.enginePath}`];
const logPath = join(root, 'logs/final-evaluation.log'), log = createWriteStream(logPath);
const child = spawn(process.execPath, parameters, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const state = { pid: child.pid, status: 'running', beganAt: new Date().toISOString(), candidate: frozen.candidate,
  seedTables: frozen.seedTables, planSha256: frozen.planSha256, engineSha256: frozen.engineSha256, logPath,
  monitoring: 'progress and process status only; read scores after the exact fixed evaluation completes' };
const statePath = join(root, 'reports/final-process.json');
writeFileSync(statePath, JSON.stringify(state, null, 2)); console.log(JSON.stringify(state));
child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
let code = 1;
try { [code] = await once(child, 'exit'); }
catch (error) { state.error = String(error); }
log.end(); await once(log, 'finish');
if (hash(frozen.enginePath) !== frozen.engineSha256 || hash(join(root, 'data/final-plan.json')) !== frozen.planSha256) { code = 1; state.error = 'Final provenance changed during evaluation'; }
state.status = code === 0 ? 'complete' : 'failed'; state.exitCode = code; state.endedAt = new Date().toISOString();
writeFileSync(statePath, JSON.stringify(state, null, 2)); console.log(JSON.stringify(state));
if (code !== 0) { process.stderr.write(readFileSync(logPath, 'utf8')); process.exitCode = code ?? 1; }
