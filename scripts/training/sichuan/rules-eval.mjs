import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const at = value.indexOf('='); return at < 0 ? [value, true] : [value.slice(0, at), value.slice(at + 1)];
}));
if (!args.runDir || !args.plan || !args.prefix || !args.candidates) throw new Error('runDir, plan, prefix and candidates JSON are required');
const root = resolve(args.runDir), planBytes = readFileSync(args.plan), plan = JSON.parse(planBytes);
const candidates = JSON.parse(readFileSync(args.candidates, 'utf8')), planSha256 = createHash('sha256').update(planBytes).digest('hex');
const selectionLimit = args.selectionDealInLimit == null ? undefined : Number(args.selectionDealInLimit);
if (selectionLimit != null && !Number.isFinite(selectionLimit)) throw new Error('Invalid selection deal-in limit');
if (args.frozenCandidate && !candidates.some(candidate => candidate.name === args.frozenCandidate)) throw new Error('Frozen candidate is absent from the evaluation list');
if (args.frozenCandidate && candidates.find(candidate => candidate.name === args.frozenCandidate).selectable === false) throw new Error('An analysis control cannot be the deployed candidate');
const enginePath = args.engine ?? join(root, 'engine.mjs'), incumbentPath = args.incumbent ?? join(root, 'baseline-engine.mjs');
const engineSha256 = createHash('sha256').update(readFileSync(enginePath)).digest('hex');
const baselineEngineSha256 = createHash('sha256').update(readFileSync(incumbentPath)).digest('hex');
mkdirSync(join(root, 'evaluation'), { recursive: true });
function execute(prefix, selectedPlan, mode, model, opponents = 'incumbent') {
  const reportPath = join(root, 'data', prefix + '.summary.json');
  const selectedBytes = Buffer.from(JSON.stringify(selectedPlan)), selectedSha = createHash('sha256').update(selectedBytes).digest('hex');
  if (existsSync(reportPath)) {
    const previous = JSON.parse(readFileSync(reportPath, 'utf8'));
    if (previous.planSha256 === selectedSha && previous.mode === mode && previous.parametersSha256 === model?.parametersSha256 && (previous.opponents ?? 'incumbent') === opponents && (previous.prior ?? 'model') === (model?.prior ?? 'model')
      && previous.engineSha256 === engineSha256 && previous.baselineEngineSha256 === baselineEngineSha256) return previous;
    throw new Error('Existing evaluation output has another plan or model');
  }
  const input = join(root, 'data', prefix + '-plan.json'); writeFileSync(input, selectedBytes);
  const parameters = [join(import.meta.dirname, 'rules-run.mjs'), `runDir=${root}`, `plan=${input}`, `prefix=${prefix}`, `mode=${mode}`, `opponents=${opponents}`, 'workers=4', 'metricsOnly'];
  if (model) parameters.push(`model=${model.path}`, `prior=${model.prior ?? 'model'}`);
  parameters.push(`engine=${enginePath}`, `incumbent=${incumbentPath}`);
  const process = spawnSync(globalThis.process.execPath, parameters, { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(join(root, 'logs', prefix + '-evaluation.log'), (process.stdout ?? '') + (process.stderr ?? ''));
  if (process.error || process.status !== 0) throw new Error(process.error?.message ?? process.stderr ?? 'Evaluation rollout failed');
  return JSON.parse(readFileSync(reportPath, 'utf8'));
}
const incumbent = execute(args.prefix + '-incumbent', plan, 'incumbent');
const incumbentBySeed = new Map(incumbent.summaries.map(item => [item.seed, item]));
const narrow = configuration => configuration.mode === 'sichuan-blood' && !configuration.exchangeThree
  && configuration.sichuan.fanCap === 4 && configuration.sichuan.selfDraw === 'base' && !configuration.sichuan.menqingZhongzhang;
const narrowPlan = plan.filter(item => narrow(item.configuration));
const algorithm = narrowPlan.length ? execute(args.prefix + '-narrow-algorithm', narrowPlan, 'teacher') : { summaries: [] };
const algorithmBySeed = new Map(algorithm.summaries.map(item => [item.seed, item]));
function random(seed) { let state = seed; return () => { state = Math.imul(state ^ state >>> 16, 0x7feb352d); state = Math.imul(state ^ state >>> 15, 0x846ca68b); state = (state ^ state >>> 16) >>> 0; return state / 0x100000000; }; }
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
function statistics(units, against) {
  const aggregate = selected => {
    const outcome = item => against === 'algorithm' ? item.algorithmOutcome : item;
    const net = average(selected.map(item => outcome(item).net)), baselineNet = average(selected.map(item => item.baselines[against].net));
    const discards = selected.reduce((sum, item) => sum + outcome(item).discards, 0), baselineDiscards = selected.reduce((sum, item) => sum + item.baselines[against].discards, 0);
    const dealInRate = selected.reduce((sum, item) => sum + outcome(item).dealInEvents, 0) / Math.max(1, discards);
    const baselineRate = selected.reduce((sum, item) => sum + item.baselines[against].dealInEvents, 0) / Math.max(1, baselineDiscards);
    return { net, baselineNet, difference: net - baselineNet, dealInRate, baselineDealInRate: baselineRate, dealInRateDifference: dealInRate - baselineRate };
  };
  const point = aggregate(units), byCohort = [...new Set(units.map(item => item.configuration.cohort))].map(cohort => units.filter(item => item.configuration.cohort === cohort));
  const rng = random(20261113), netSamples = [], dealInSamples = [];
  for (let repeat = 0; repeat < 3000; repeat++) {
    const sample = byCohort.flatMap(group => Array.from({ length: group.length }, () => group[Math.floor(rng() * group.length)]));
    const statistics = aggregate(sample); netSamples.push(statistics.difference); dealInSamples.push(statistics.dealInRateDifference);
  }
  netSamples.sort((a, b) => a - b); dealInSamples.sort((a, b) => a - b);
  const interval = samples => [samples[Math.floor(samples.length * .025)], samples[Math.floor(samples.length * .975)]];
  const outcome = item => against === 'algorithm' ? item.algorithmOutcome : item;
  return { seedTables: units.length, rotatedGames: units.length * 4, meanNet: point.net, baselineMeanNet: point.baselineNet,
    meanPairedDifference: point.difference, netDifference95CI: interval(netSamples), dealInPerDiscard: point.dealInRate,
    baselineDealInPerDiscard: point.baselineDealInRate, dealInRateDifference: point.dealInRateDifference, dealInRateDifference95CI: interval(dealInSamples),
    dealInHandRate: average(units.map(item => outcome(item).dealInHandRate)), meanDealInEvents: average(units.map(item => outcome(item).dealInEvents)),
    meanDealInPoints: average(units.map(item => outcome(item).dealInPoints)), winRate: average(units.map(item => outcome(item).winRate)), meanWins: average(units.map(item => outcome(item).wins)) };
}
const variants = [];
for (const candidate of candidates) {
  const modelData = JSON.parse(readFileSync(candidate.path, 'utf8')), model = { ...candidate, parametersSha256: modelData.parametersSha256 };
  let candidatePlan = plan;
  if (candidate.tablesPerCohort != null) {
    if (!Number.isSafeInteger(candidate.tablesPerCohort) || candidate.tablesPerCohort <= 0) throw new Error('Invalid control table count');
    const counts = new Map();
    candidatePlan = plan.filter(item => {
      const cohort = item.configuration.cohort, count = counts.get(cohort) ?? 0; counts.set(cohort, count + 1);
      return count < candidate.tablesPerCohort;
    });
  }
  const rotationsPlan = candidatePlan.flatMap(item => [0, 1, 2, 3].map(candidateSeat => ({ ...item, candidateSeat })));
  const rollout = execute(args.prefix + '-' + candidate.name, rotationsPlan, 'hybrid', model);
  const candidateNarrowPlan = candidatePlan.filter(item => narrow(item.configuration));
  const pureNarrow = candidateNarrowPlan.length ? execute(args.prefix + '-' + candidate.name + '-pure-narrow', candidateNarrowPlan.flatMap(item => [0, 1, 2, 3].map(candidateSeat => ({ ...item, candidateSeat }))), 'hybrid', model, 'algorithm') : { summaries: [] };
  const pureNarrowBySeat = new Map(pureNarrow.summaries.map(item => [`${item.seed}:${item.candidateSeat}`, item]));
  const rotations = rollout.summaries.map(item => {
    const seat = item.candidateSeat, base = incumbentBySeed.get(item.seed), pure = algorithmBySeed.get(item.seed) ?? base;
    if (base.wallSha256 !== item.wallSha256 || pure.wallSha256 !== item.wallSha256) throw new Error('Paired wall mismatch');
    const from = summary => ({ net: summary.deltas[seat], dealInEvents: summary.dealInEvents[seat], dealInPoints: summary.dealInPoints[seat],
      discards: summary.discards[seat], dealInHandRate: Number(summary.dealInEvents[seat] > 0), winRate: Number(summary.winners.includes(seat)), wins: summary.winners.filter(id => id === seat).length });
    const pureOutcome = pureNarrowBySeat.get(`${item.seed}:${seat}`) ?? item;
    if (pureOutcome.wallSha256 !== item.wallSha256) throw new Error('Pure-opponent wall mismatch');
    return { seed: item.seed, configuration: item.configuration, seat, wallSha256: item.wallSha256,
      ...from(item), algorithmOutcome: from(pureOutcome), baselines: { incumbent: from(base), algorithm: from(pure) }, modelStats: item.modelStats };
  });
  const units = candidatePlan.map(item => {
    const group = rotations.filter(rotation => rotation.seed === item.seed);
    if (group.length !== 4 || new Set(group.map(rotation => rotation.seat)).size !== 4) throw new Error('Incomplete seat rotation');
    const averageFields = source => Object.fromEntries(['net', 'dealInEvents', 'dealInPoints', 'discards', 'dealInHandRate', 'winRate', 'wins'].map(key => [key, average(group.map(rotation => source(rotation)[key]))]));
    return { seed: item.seed, configuration: item.configuration, ...averageFields(rotation => rotation), algorithmOutcome: averageFields(rotation => rotation.algorithmOutcome),
      baselines: { incumbent: averageFields(rotation => rotation.baselines.incumbent), algorithm: averageFields(rotation => rotation.baselines.algorithm) } };
  });
  const strata = (name, key) => [...new Set(units.map(key))].map(value => {
    const subset = units.filter(item => key(item) === value);
    return { name, value, versusIncumbent: statistics(subset, 'incumbent'), versusAlgorithm: statistics(subset, 'algorithm') };
  });
  const summary = { name: candidate.name, parametersSha256: modelData.parametersSha256, model: candidate.path, prior: candidate.prior ?? 'model', selectable: candidate.selectable !== false,
    versusIncumbent: statistics(units, 'incumbent'), versusAlgorithm: statistics(units, 'algorithm'),
    coreStrata: strata('flow/exchange/cap', item => item.configuration.cohort),
    parameterStrata: [...strata('fanCap', item => item.configuration.sichuan.fanCap), ...strata('selfDraw', item => item.configuration.sichuan.selfDraw), ...strata('menqingZhongzhang', item => item.configuration.sichuan.menqingZhongzhang)],
    sampledTables: candidatePlan.length, tablesPerCohortLimit: candidate.tablesPerCohort,
    modelStats: Object.fromEntries(Object.keys(rotations[0].modelStats).map(key => [key, rotations.reduce((sum, item) => sum + item.modelStats[key], 0)])), units, rotations };
  variants.push(summary); console.log(JSON.stringify({ candidate: summary.name, versusIncumbent: summary.versusIncumbent, modelStats: summary.modelStats }));
}
const priorComparisons = variants.filter(variant => variant.prior === 'model').flatMap(model => {
  const algorithm = variants.find(variant => variant.prior === 'algorithm' && variant.parametersSha256 === model.parametersSha256);
  if (!algorithm) return [];
  const algorithmBySeed = new Map(algorithm.units.map(unit => [unit.seed, unit]));
  const paired = model.units.filter(unit => algorithmBySeed.has(unit.seed)).map(unit => ({ ...unit, baselines: { incumbent: algorithmBySeed.get(unit.seed) } }));
  return [{ parametersSha256: model.parametersSha256, modelPrior: model.name, algorithmPrior: algorithm.name,
    sameMaximumSearchBudget: true, statistics: statistics(paired, 'incumbent') }];
});
const controlComparisons = variants.filter(variant => variant.selectable).flatMap(candidate =>
  variants.filter(variant => !variant.selectable).map(control => {
    const controlBySeed = new Map(control.units.map(unit => [unit.seed, unit]));
    const paired = candidate.units.filter(unit => controlBySeed.has(unit.seed)).map(unit => ({ ...unit, baselines: { incumbent: controlBySeed.get(unit.seed) } }));
    return { candidate: candidate.name, control: control.name, controlPrior: control.prior,
      candidateTables: candidate.units.length, controlTables: control.units.length,
      pairedTables: paired.length, statistics: statistics(paired, 'incumbent') };
  }));
const selectionChecks = variants.filter(variant => variant.selectable).map(variant => ({ name: variant.name,
  positiveNet: variant.versusIncumbent.meanPairedDifference > 0,
  dealInAccepted: selectionLimit == null || variant.versusIncumbent.dealInRateDifference <= 0
    || variant.versusIncumbent.dealInRateDifference95CI[1] <= selectionLimit }));
const eligibleNames = new Set(selectionChecks.filter(check => selectionLimit == null || check.positiveNet && check.dealInAccepted).map(check => check.name));
const selected = variants.filter(variant => eligibleNames.has(variant.name)).reduce((best, item) =>
  !best || item.versusIncumbent.meanPairedDifference > best.versusIncumbent.meanPairedDifference ? item : best, null)?.name ?? null;
const report = { prefix: args.prefix, planSha256, enginePath, incumbentPath, engineSha256, baselineEngineSha256, seedTables: plan.length, pairing: 'identical seed/configuration wall, all four candidate seats; bootstrap unit is the complete four-seat table',
  purpose: args.frozenCandidate ? 'frozen-final' : 'selection', selectionUsed: !args.frozenCandidate,
  selection: { candidates: variants.filter(variant => variant.selectable).map(variant => variant.name),
    controls: variants.filter(variant => !variant.selectable).map(variant => variant.name),
    dealInLimit: selectionLimit, checks: selectionChecks },
  bootstrap: { repetitions: 3000, seed: 20261113, stratifiedByCoreCohort: true, interval: 'percentile 95%' },
  algorithmBaseline: { reusedIncumbentTables: plan.length - narrowPlan.length, separatelyRunOriginalNarrowTables: narrowPlan.length,
    reason: 'AI8 production uses the pure algorithm outside its original single configuration.' }, variants, priorComparisons, controlComparisons,
  selected: args.frozenCandidate ?? selected };
writeFileSync(join(root, 'evaluation', args.prefix + '-report.json'), JSON.stringify(report, null, 2));
