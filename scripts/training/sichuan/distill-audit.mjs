import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const args = Object.fromEntries(process.argv.slice(2).map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; }));
if (!args.runDir || !args.prefix) throw new Error('runDir/prefix required');
const root = resolve(args.runDir), engine = await import(pathToFileURL(join(root, 'engine.mjs')));
const rows = readFileSync(join(root, 'data', args.prefix + '.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const reports = [0, 1, 2, 3].map(index => JSON.parse(readFileSync(join(root, 'data', args.prefix, `shard-${index}.summary.json`))));
const stages = {}, flags = { ownHasWon: 0, anyOpponentHasWon: 0 }, groups = {}, deltas = [];
let nonAnchor = 0, noOpAliases = 0, fallbackAliases = 0;
for (const row of rows) {
  if (row.schemaVersion !== 1 || row.supervision !== 'proposal-distill' || row.featureVersion !== 3 || row.proposalVersion !== 1 || 'g' in row) throw new Error('Invalid distill schema');
  if (!row.splitGroup.startsWith('sichuan-distill-train-') && !row.splitGroup.startsWith('sichuan-distill-val-')) throw new Error('Holdout namespace in teacher data');
  if (!row.publicInput.observation.seed.startsWith('public:')) throw new Error('Private seed was used by the teacher');
  const stateHash = createHash('sha256').update(JSON.stringify(row.publicInput)).digest('hex');
  if (stateHash !== row.publicStateHash) throw new Error('Public snapshot hash mismatch');
  const encoded = engine.encodeSichuanFeatures(row.publicInput, 3);
  if (!Buffer.from(encoded.buffer).equals(Buffer.from(row.f, 'base64')) || encoded.some(value => !Number.isFinite(value))) throw new Error('Feature encoding mismatch');
  const state = engine.prepareSichuanProposal(row.publicInput), actualMask = engine.sichuanProposalMask(state);
  if (JSON.stringify(row.m) !== JSON.stringify([...actualMask.keys()].filter(index => actualMask[index]))) throw new Error('Runtime proposal mask mismatch');
  const byExecution = new Map();
  let target = row.anchor, maximum = 0;
  for (const candidate of row.candidates) {
    if (!candidate.teacherComplete || !row.m.includes(candidate.proposal)) throw new Error('Incomplete or unmasked label');
    const executed = engine.executeSichuanProposal(state, candidate.proposal, 'audit');
    const action = row.publicInput.actions.find(action => action.key === executed.key);
    if (engine.sichuanActionIndex(action) !== candidate.executed) throw new Error('Label uses proposal instead of actual execution');
    const previous = byExecution.get(candidate.executed);
    if (previous && (previous.qRef !== candidate.qRef || previous.delta !== candidate.delta)) throw new Error('Equivalent executions have different labels');
    byExecution.set(candidate.executed, candidate);
    if (candidate.executed === row.anchor) { noOpAliases++; if (candidate.delta !== 0) throw new Error('No-op has nonzero advantage'); }
    if (!candidate.runtimeComplete) fallbackAliases++;
    if (candidate.delta > maximum + 1e-9) { target = candidate.proposal; maximum = candidate.delta; }
  }
  if (byExecution.size > 4 || target !== row.target || maximum !== row.margin) throw new Error('Teacher target mismatch');
  if (row.target !== row.anchor) nonAnchor++;
  stages[row.bucket] = (stages[row.bucket] ?? 0) + 1; groups[row.groups] = (groups[row.groups] ?? 0) + 1;
  const ownId = row.publicInput.observation.ownId;
  if (row.publicInput.observation.players.find(player => player.id === ownId).hasWon) flags.ownHasWon++;
  if (row.publicInput.observation.players.some(player => player.id !== ownId && player.hasWon)) flags.anyOpponentHasWon++;
  deltas.push(row.margin);
}
const statusCounts = {};
for (const report of reports) for (const [status, count] of Object.entries(report.statusCounts)) statusCounts[status] = (statusCounts[status] ?? 0) + count;
const attempts = (statusCounts.complete ?? 0) + (statusCounts['too-many-groups'] ?? 0) + (statusCounts['teacher-incomplete'] ?? 0);
const milliseconds = rows.map(row => row.milliseconds).sort((a, b) => a - b);
const summary = { rows: rows.length, games: reports.reduce((sum, report) => sum + report.count, 0), nonAnchorTargets: nonAnchor,
  nonAnchorFraction: nonAnchor / Math.max(1, rows.length), statusCounts, eligibleCompleteness: rows.length / Math.max(1, attempts),
  executedGroups: groups, stages, publicHasWon: flags, noOpAliases, fallbackAliases,
  marginMean: deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, deltas.length), marginMaximum: Math.max(0, ...deltas),
  milliseconds: { median: milliseconds[Math.floor(milliseconds.length * .5)], p95: milliseconds[Math.floor(milliseconds.length * .95)], maximum: milliseconds.at(-1) },
  teacherNodes: reports.reduce((sum, report) => sum + report.teacherNodes, 0), runtimeMappingAndPublicFeatureAudit: true };
writeFileSync(join(root, 'reports', args.prefix + '-audit.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary));
