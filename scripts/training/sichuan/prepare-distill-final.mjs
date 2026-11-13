import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { makeBalancedPlan } from './rules-matrix.mjs';
const args = Object.fromEntries(process.argv.slice(2).map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; }));
if (!args.runDir) throw new Error('runDir required');
const root = resolve(args.runDir), selectionPath = join(root, 'evaluation/selection-v1-report.json');
const selectionBytes = readFileSync(selectionPath), selection = JSON.parse(selectionBytes);
const candidate = selection.variants.find(variant => variant.name === selection.selected);
if (!candidate?.selectable || !['distilled', 'distill-ppo'].includes(candidate.name)) throw new Error('No eligible learned candidate selected');
const metrics = candidate.versusIncumbent;
if (metrics.meanPairedDifference <= 0 || metrics.dealInRateDifference > 0 && metrics.dealInRateDifference95CI[1] > .001) throw new Error('Selection performance gate failed');
const cohorts = [...new Set(candidate.units.map(unit => unit.configuration.cohort))];
const variance = values => { const mean = values.reduce((sum, value) => sum + value, 0) / values.length; return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1); };
const groupVariances = cohorts.map(cohort => variance(candidate.units.filter(unit => unit.configuration.cohort === cohort).map(unit => unit.net - unit.baselines.incumbent.net)));
const effectiveVariance = groupVariances.reduce((sum, value) => sum + value, 0) / cohorts.length;
const rawRequired = (1.959963984540054 + .8416212335729143) ** 2 * effectiveVariance / .1 ** 2;
const tables = Math.max(2720, Math.ceil(rawRequired / 160) * 160);
const namespace = 'sichuan-distill-final-20261113-v1';
const finalPlanPath = join(root, 'data/final-plan.json');
if (!existsSync(join(root, 'data/final-plan-initial-unused.json'))) writeFileSync(join(root, 'data/final-plan-initial-unused.json'), readFileSync(finalPlanPath));
const planBytes = Buffer.from(JSON.stringify(makeBalancedPlan(namespace, tables / 8)));
const contract = { frozenAt: new Date().toISOString(), candidate: candidate.name, parametersSha256: candidate.parametersSha256,
  featureVersion: 3, policyVersion: 1, proposalVersion: 1, selectionReportSha256: createHash('sha256').update(selectionBytes).digest('hex'),
  selectionTables: candidate.units.length, effectiveWithinStratumVariance: effectiveVariance, effectiveStandardDeviation: Math.sqrt(effectiveVariance),
  power: { effect: .1, power: .8, alpha: .05, twoSided: true, rawRequiredTables: rawRequired, roundedTables: tables },
  namespace, planSha256: createHash('sha256').update(planBytes).digest('hex'), seedTables: tables, rotatedCandidateGames: tables * 4,
  controls: { tablesPerCohort: 80, seedTables: 640, selection: 'first 80 predeclared entries in each core stratum, all 96 configurations',
    strategies: ['same-maximum-budget algorithm priority', 'terminal-only'] },
  acceptance: { pairedNetDifference95CILowerExclusive: 0, dealInPerDiscardDifference95CIUpperInclusive: .001 },
  finalResultsUsedForSelectionOrSampleSize: false, sampleSizeChangedOnceBeforeEvaluation: true,
  stopRule: 'complete the exact fixed plan, evaluate once, preserve the frozen candidate regardless of control ranking' };
if (existsSync(join(root, 'reports/final-design.json'))) throw new Error('Final design already sealed');
writeFileSync(join(root, 'evaluation/selection-frozen.json'), selectionBytes);
writeFileSync(finalPlanPath, planBytes);
writeFileSync(join(root, 'data/final-candidates.json'), JSON.stringify([
  { name: candidate.name, path: candidate.model, prior: 'model', selectable: true },
  { name: 'algorithm-prior', path: candidate.model, prior: 'algorithm', selectable: false, tablesPerCohort: 80 },
  { name: 'terminal-only', path: candidate.model, prior: 'terminal', selectable: false, tablesPerCohort: 80 },
]));
const selectionCandidates = JSON.parse(readFileSync(join(root, 'data/selection-candidates.json')));
selectionCandidates.push({ name: 'algorithm-prior', path: candidate.model, prior: 'algorithm', selectable: false });
writeFileSync(join(root, 'data/selection-with-control.json'), JSON.stringify(selectionCandidates));
writeFileSync(join(root, 'reports/final-design.json'), JSON.stringify(contract, null, 2)); console.log(JSON.stringify(contract));
