import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const args = Object.fromEntries(process.argv.slice(2).map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; }));
if (!args.runDir || !args.source || !args.engine || !args.ai10) throw new Error('runDir/source/engine/ai10 required');
const root = resolve(args.runDir), source = resolve(args.source), enginePath = resolve(args.engine);
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const design = JSON.parse(readFileSync(join(root, 'reports/final-design.json')));
const manifest = JSON.parse(readFileSync(join(source, 'src/game/ai/models/sichuan/distill-source.json')));
const candidates = JSON.parse(readFileSync(join(root, 'data/final-candidates.json')));
const model = JSON.parse(readFileSync(candidates.find(candidate => candidate.selectable).path));
const digest = createHash('sha256');
for (const layer of model.layers) { digest.update(Buffer.from(layer.weight, 'base64')); digest.update(Buffer.from(layer.bias, 'base64')); }
if (digest.digest('hex') !== design.parametersSha256 || manifest.parametersSha256 !== design.parametersSha256) throw new Error('Frozen model parameters differ');
if (hash(join(root, 'data/final-plan.json')) !== design.planSha256) throw new Error('Final seed plan changed after sizing');
const production = await import(pathToFileURL(enginePath)), research = await import(pathToFileURL(join(root, 'engine.mjs')));
const ai10 = await import(pathToFileURL(resolve(args.ai10)));
const expected = research.createSichuanHybridPolicy(model, manifest.id);
production.RegionalSession.prototype.schedule = function () {};
const selectionPlan = JSON.parse(readFileSync(join(root, 'data/select-plan.json')));
const tables = [...new Set(selectionPlan.map(item => item.configuration.cohort))].map(cohort => selectionPlan.find(item => item.configuration.cohort === cohort));
let decisions = 0, normalSessionCalls = 0, legacyAi10Decisions = 0;
for (const { seed, configuration } of tables) {
  const session = new production.RegionalSession({ mode: configuration.mode, seed, difficulty: 'expert', autoPlay: true,
    autoExchangeThree: true, speed: 0, matchLength: 'single', rulesVersion: 2,
    variantOptions: { exchangeThree: configuration.exchangeThree, sichuan: configuration.sichuan } });
  session.cancel(); session.publish = function () {};
  const normalChoice = session.botChoice.bind(session);
  session.botChoice = function (player, actions) {
    const input = this.regionalBotInput(player, actions), actual = production.chooseSichuanHybridAction(input);
    if (input.aiVersion !== 11 || JSON.stringify(actual) !== JSON.stringify(expected(input))) throw new Error('Production strategy differs from selection');
    const legacyInput = { ...input, aiVersion: 10 };
    if (JSON.stringify(production.chooseSichuanHybridAction(legacyInput)) !== JSON.stringify(ai10.chooseSichuanHybridAction(legacyInput))) throw new Error('AI10 strategy or model identity changed');
    const choice = normalChoice(player, actions);
    if (choice.key !== actual.key) throw new Error('Normal session entry differs from frozen strategy');
    decisions++; normalSessionCalls++; legacyAi10Decisions++; return choice;
  };
  let ticks = 0; while (session.stage !== 'settlement' && ticks++ < 1800) session.tick();
  if (session.stage !== 'settlement') throw new Error('Incomplete freeze equivalence hand');
  const save = session.getSavedGame();
  if (save.aiVersion !== 11 || JSON.stringify(save.aiModel) !== JSON.stringify(production.SICHUAN_MODEL_IDENTITY)) throw new Error('AI11 save identity differs');
  session.dispose();
}
if (JSON.stringify(production.sichuanModelIdentity(10)) !== JSON.stringify(ai10.SICHUAN_MODEL_IDENTITY)) throw new Error('AI10 identity was replaced');
const policyPaths = ['src/game/ai/models/sichuanHybrid.ts', 'src/game/ai/models/sichuanValue.ts', 'src/game/ai/models/sichuanProposal.ts',
  'src/game/ai/models/sichuanFeatures.ts', 'src/game/ai/models/sichuanRuntime.ts', 'src/game/ai/models/sichuan/distill-source.json',
  'src/game/ai/models/sichuan/distill-weights.json', 'src/game/ai/types.ts', 'src/game/index.ts', 'src/game/variants/session.ts', 'src/game/replaySupport.ts'];
const frozen = { frozenAt: new Date().toISOString(), candidate: design.candidate, identity: production.SICHUAN_MODEL_IDENTITY,
  enginePath, engineSha256: hash(enginePath), baselineEngineSha256: hash(join(root, 'baseline-engine.mjs')),
  designSha256: hash(join(root, 'reports/final-design.json')), planSha256: design.planSha256, seedTables: design.seedTables,
  equivalence: { completeHands: tables.length, decisions, normalSessionCalls, legacyAi10Decisions, exact: true },
  policySourceSha256: Object.fromEntries(policyPaths.map(path => [path, hash(join(source, path))])), acceptance: design.acceptance };
writeFileSync(join(root, 'reports/frozen-candidate.json'), JSON.stringify(frozen, null, 2)); console.log(JSON.stringify(frozen));
