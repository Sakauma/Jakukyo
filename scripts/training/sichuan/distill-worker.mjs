import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const args = Object.fromEntries(process.argv.slice(2).map(value => { const at = value.indexOf('='); return at < 0 ? [value, true] : [value.slice(0, at), value.slice(at + 1)]; }));
if (!args.runDir || !args.plan || !args.output) throw new Error('runDir/plan/output required');
const root = resolve(args.runDir), enginePath = args.engine ?? resolve(root, 'engine.mjs'), incumbentPath = args.incumbent ?? resolve(root, 'baseline-engine.mjs');
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const engineSha256 = sha(enginePath), baselineEngineSha256 = sha(incumbentPath);
const engine = await import(pathToFileURL(enginePath)), incumbent = await import(pathToFileURL(incumbentPath));
const model = JSON.parse(readFileSync(args.model ?? resolve(root, 'models/warm.json')));
const policy = engine.createSichuanHybridPolicy(model, 'distill-collection');
const plan = JSON.parse(readFileSync(args.plan));
const limit = Number(args.labelLimit ?? Infinity), maximumPerGame = Number(args.maxStates ?? 4);
const output = resolve(args.output); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, '');
engine.RegionalSession.prototype.schedule = function () {};
const timings = [], summaries = [], statusCounts = {}, groups = {}, targets = {}, margins = [];
let labels = 0, decisions = 0, teacherNodes = 0, nonAnchor = 0, runtimeFallbacks = 0;
const began = performance.now();
for (const entry of plan) {
  if (!entry.seed.startsWith('sichuan-distill-train-') && !entry.seed.startsWith('sichuan-distill-val-')) throw new Error('Teacher accepts training/validation namespaces');
  const { seed, configuration, candidateSeat } = entry;
  const session = new engine.RegionalSession({ mode: configuration.mode, seed, difficulty: 'expert', autoPlay: true,
    autoExchangeThree: true, speed: 0, matchLength: 'single', rulesVersion: 2,
    variantOptions: { exchangeThree: configuration.exchangeThree, sichuan: configuration.sichuan } });
  session.cancel(); session.publish = function () {};
  const buckets = new Set(); let gameLabels = 0;
  session.botChoice = function (player, actions) {
    const input = this.regionalBotInput(player, actions); decisions++;
    const decision = player.id === candidateSeat ? policy(input) : incumbent.chooseSichuanHybridAction({ ...input, aiVersion: 8 });
    const wall = input.observation.tilesLeft, bucket = wall > 36 ? 0 : wall > 24 ? 1 : wall > 12 ? 2 : 3;
    if (player.id === candidateSeat && labels < limit && wall <= 48 && buckets.size < maximumPerGame && !buckets.has(bucket)) {
      const original = JSON.stringify(input), started = performance.now();
      const result = engine.labelSichuanProposals(input), milliseconds = performance.now() - started;
      if (JSON.stringify(input) !== original) throw new Error('Teacher mutated live public input');
      statusCounts[result.status] = (statusCounts[result.status] ?? 0) + 1;
      if (result.status === 'complete') buckets.add(bucket);
      if (result.status === 'complete') {
        labels++; gameLabels++; timings.push(milliseconds); teacherNodes += result.nodes; margins.push(result.margin);
        if (result.target !== result.anchor) nonAnchor++;
        groups[result.groups] = (groups[result.groups] ?? 0) + 1;
        targets[result.target] = (targets[result.target] ?? 0) + 1;
        runtimeFallbacks += result.candidates.filter(candidate => !candidate.runtimeComplete).length;
        const { input: publicInput, features, mask, status, ...row } = result;
        const publicStateHash = createHash('sha256').update(JSON.stringify(publicInput)).digest('hex');
        appendFileSync(output, JSON.stringify({ ...row, engineSha256, baselineEngineSha256, parametersSha256: model.parametersSha256,
          splitGroup: seed, configuration, candidateSeat, bucket, publicStateHash, publicInput,
          f: Buffer.from(features.buffer).toString('base64'), m: [...mask.keys()].filter(index => mask[index]),
          milliseconds, samplingVersion: 2, samplingEligibility: 'two to four distinct runtime executed actions',
          collectionBehavior: 'greedy frozen warm proposal versus three formal AI8 opponents' }) + '\n');
      }
    }
    const choice = actions.find(action => action.key === decision.key);
    if (!choice) throw new Error('Collection policy produced an illegal action');
    this.commitBotChoice(player.id, choice.key, decision.provider); return choice;
  };
  let ticks = 0; while (session.stage !== 'settlement' && ticks++ < 1800) session.tick();
  if (session.stage !== 'settlement') throw new Error('Incomplete teacher collection hand');
  summaries.push({ seed, configuration, candidateSeat, ticks, labels: gameLabels }); session.dispose();
  console.log(JSON.stringify({ completed: summaries.length, total: plan.length, labels, seconds: (performance.now() - began) / 1000 }));
}
timings.sort((a, b) => a - b);
const report = { mode: 'distill', engineSha256, baselineEngineSha256, parametersSha256: model.parametersSha256,
  count: plan.length, decisions, teacherNodes, legalErrors: 0, labels, nonAnchorTargets: nonAnchor, statusCounts,
  groups, targets, runtimeFallbacks, marginMean: margins.reduce((sum, margin) => sum + margin, 0) / Math.max(1, margins.length),
  milliseconds: { median: timings[Math.floor(timings.length * .5)], p95: timings[Math.floor(timings.length * .95)], maximum: timings.at(-1) },
  elapsedSeconds: (performance.now() - began) / 1000, summaries };
writeFileSync(output.replace(/\.jsonl$/, '.summary.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, summaries: undefined }));
