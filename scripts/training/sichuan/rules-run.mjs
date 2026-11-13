import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const at = value.indexOf('='); return at < 0 ? [value, true] : [value.slice(0, at), value.slice(at + 1)];
}));
if (!args.runDir || !args.plan || !args.prefix) throw new Error('runDir, plan and prefix are required');
if (!/^[a-zA-Z0-9_-]+$/.test(args.prefix)) throw new Error('prefix must be a file name');
const root = resolve(args.runDir), planBytes = await readFile(args.plan), plan = JSON.parse(planBytes);
const engineSha256 = createHash('sha256').update(await readFile(args.engine ?? join(root, 'engine.mjs'))).digest('hex');
const baselineEngineSha256 = createHash('sha256').update(await readFile(args.incumbent ?? join(root, 'baseline-engine.mjs'))).digest('hex');
const workers = Math.min(Number(args.workers ?? 4), plan.length);
if (!Number.isSafeInteger(workers) || workers <= 0) throw new Error('Invalid worker count');
const directory = join(root, 'data', args.prefix), logDirectory = join(root, 'logs');
await mkdir(directory, { recursive: true }); await mkdir(logDirectory, { recursive: true });
const state = { prefix: args.prefix, mode: args.mode ?? 'teacher', beganAt: new Date().toISOString(), count: plan.length,
  engineSha256, baselineEngineSha256,
  opponents: args.opponents ?? 'incumbent', prior: args.prior ?? 'model',
  planSha256: createHash('sha256').update(planBytes).digest('hex'), workers: [] };
const stateFile = join(root, 'reports', args.prefix + '-state.json'), children = [];
let stateWrite = Promise.resolve();
const persistState = () => {
  stateWrite = stateWrite.then(async () => {
    const temporary = `${stateFile}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2)); await rename(temporary, stateFile);
  });
  return stateWrite;
};
const timer = setInterval(() => { void persistState(); }, 10000);
const began = performance.now();
try {
  await Promise.all(Array.from({ length: workers }, async (_, index) => {
    const subset = plan.filter((_, at) => at % workers === index), shard = join(directory, `shard-${index}.jsonl`), shardPlan = join(directory, `plan-${index}.json`);
    await writeFile(shardPlan, JSON.stringify(subset));
    const parameters = [args.script ?? join(import.meta.dirname, 'rules-rollout.mjs'), `runDir=${root}`, `plan=${shardPlan}`, `output=${shard}`, `mode=${state.mode}`];
    for (const name of ['model', 'seat', 'engine', 'incumbent', 'opponents', 'prior', 'labelLimit', 'maxStates', 'labelCache']) if (args[name] != null) parameters.push(`${name}=${args[name]}`);
    for (const name of ['metricsOnly', 'greedy']) if (args[name]) parameters.push(name);
    const log = createWriteStream(join(logDirectory, `${args.prefix}-${index}.log`));
    const child = spawn(process.execPath, ['--max-old-space-size=512', ...parameters], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    const worker = { index, pid: child.pid, total: subset.length, completed: 0, status: 'running', output: shard };
    state.workers.push(worker);
    let pending = '';
    child.stdout.on('data', bytes => {
      log.write(bytes); pending += bytes.toString();
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) { try { const progress = JSON.parse(line); if (progress.completed != null) worker.completed = progress.completed; } catch {} }
    });
    child.stderr.pipe(log, { end: false });
    const [code] = await once(child, 'exit'); log.end();
    worker.status = code === 0 ? 'complete' : 'failed'; worker.exitCode = code;
    await persistState();
    if (code !== 0) throw new Error(`Rollout worker ${index} exited ${code}`);
  }));
  const reports = await Promise.all(Array.from({ length: workers }, (_, index) => readFile(join(directory, `shard-${index}.summary.json`), 'utf8').then(JSON.parse)));
  const destination = join(root, 'data', args.prefix + '.jsonl'), output = createWriteStream(destination);
  for (let index = 0; index < workers; index++) for await (const chunk of createReadStream(join(directory, `shard-${index}.jsonl`))) if (!output.write(chunk)) await once(output, 'drain');
  output.end(); await once(output, 'finish');
  const report = { ...state, elapsedSeconds: (performance.now() - began) / 1000, output: destination, parametersSha256: reports[0].parametersSha256,
    decisions: reports.reduce((sum, item) => sum + item.decisions, 0), teacherNodes: reports.reduce((sum, item) => sum + item.teacherNodes, 0),
    legalErrors: reports.reduce((sum, item) => sum + item.legalErrors, 0), summaries: reports.flatMap(item => item.summaries) };
  await writeFile(destination.replace('.jsonl', '.summary.json'), JSON.stringify(report, null, 2));
  state.completedAt = new Date().toISOString(); state.output = destination;
  console.log(JSON.stringify({ ...report, summaries: undefined }));
} catch (error) {
  state.error = String(error); for (const child of children) if (child.exitCode == null) child.kill(); throw error;
} finally { clearInterval(timer); await persistState(); }
