import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { selectAction } from './mlp.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const at = value.indexOf('='); return at < 0 ? [value, true] : [value.slice(0, at), value.slice(at + 1)];
}));
if (args.help) {
  console.log('rules-rollout.mjs runDir=PATH plan=PLAN.json output=EPISODES.jsonl [mode=teacher|incumbent|actor|hybrid|proposal] [model=MODEL.json] [seat=0..3]');
  process.exit(0);
}
if (!args.runDir || !args.plan || !args.output) throw new Error('runDir, plan and output are required');
const root = resolve(args.runDir), mode = args.mode ?? 'teacher';
if (!['teacher', 'incumbent', 'actor', 'hybrid', 'proposal'].includes(mode)) throw new Error('Unknown rollout mode');
if (mode === 'proposal' && args.greedy) throw new Error('On-policy proposal data requires categorical sampling');
if (mode === 'proposal' && args.opponents && !['formal-ai8', 'incumbent'].includes(args.opponents)) throw new Error('Proposal PPO requires three formal AI8 opponents');
if (args.seat != null && ![0, 1, 2, 3].includes(Number(args.seat))) throw new Error('Invalid candidate seat');
const enginePath = args.engine ?? resolve(root, 'engine.mjs'), incumbentPath = args.incumbent ?? resolve(root, 'baseline-engine.mjs');
const engineSha256 = createHash('sha256').update(readFileSync(enginePath)).digest('hex');
const baselineEngineSha256 = createHash('sha256').update(readFileSync(incumbentPath)).digest('hex');
const engine = await import(pathToFileURL(enginePath));
const incumbent = await import(pathToFileURL(incumbentPath));
const plan = JSON.parse(readFileSync(args.plan, 'utf8'));
if (!Array.isArray(plan) || !plan.length || new Set(plan.map(item => `${item.seed}:${item.candidateSeat ?? args.seat ?? 'all'}`)).size !== plan.length) throw new Error('Invalid or duplicate table plan');
const model = args.model ? JSON.parse(readFileSync(args.model, 'utf8')) : null;
if (['actor', 'hybrid', 'proposal'].includes(mode) && ![2, 3].includes(model?.featureVersion)) throw new Error('Rule-conditioned rollout needs a rule-conditioned model');
if (mode === 'proposal' && model.featureVersion !== 3) throw new Error('Proposal rollout needs feature version 3');
const policy = model ? engine.createSichuanPolicy(model) : null;
const hybrid = model ? args.prior === 'terminal' ? input => engine.prepareSichuanProposal(input).decision
  : engine.createSichuanHybridPolicy(model, 'sichuan-rules-candidate', args.prior ?? 'model') : null;
const output = resolve(args.output); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, '');
const summaries = [], began = performance.now();
engine.RegionalSession.prototype.schedule = function () {};
const utility = mode === 'proposal' ? net => net / 32 : net => Math.tanh(Math.asinh(net / 32) / 4);
let decisions = 0, teacherNodes = 0;

for (const entry of plan) {
  const { seed, configuration } = entry;
  const candidateSeat = entry.candidateSeat ?? (args.seat == null ? null : Number(args.seat));
  if (candidateSeat != null && ![0, 1, 2, 3].includes(candidateSeat)) throw new Error('Invalid planned candidate seat');
  if (mode === 'proposal' && candidateSeat == null) throw new Error('Proposal PPO requires exactly one candidate seat');
  const random = engine.seededRandom(`${seed}:policy-sampling`);
  const session = new engine.RegionalSession({ mode: configuration.mode, seed, difficulty: 'expert', autoPlay: true,
    autoExchangeThree: true, speed: 0, matchLength: 'single', rulesVersion: 2,
    variantOptions: { exchangeThree: configuration.exchangeThree, sichuan: configuration.sichuan } });
  session.cancel(); session.publish = function () {};
  if (model?.featureVersion === 3) session.aiVersion = 10;
  const trajectories = [[], [], [], []], initial = session.players.map(player => player.points);
  const wallSha256 = createHash('sha256').update(JSON.stringify([session.players.map(player => player.hand), session.wall])).digest('hex');
  const ledger = [], wins = [], preparation = [], preDecision = [0, 0, 0, 0];
  const modelStats = { focusedDecisions: 0, changedActions: 0, protectedCalls: 0, actorDecisions: 0, reorderedCandidates: 0 };
  const originalTransfer = session.transfer.bind(session), originalAward = session.award.bind(session), originalExchange = session.chooseExchange.bind(session);
  session.transfer = function (from, to, amount, kong) {
    if (!Number.isFinite(amount)) throw new Error('Nonfinite score transfer');
    ledger.push({ step: this.step, from, to, amount, kong: Boolean(kong), retired: this.players.map(player => player.hasWon), stage: this.stage });
    return originalTransfer(from, to, amount, kong);
  };
  session.award = function (winners, from, tile, selfDraw) {
    const before = this.players.map(player => player.points), step = this.step;
    const result = originalAward(winners, from, tile, selfDraw);
    wins.push({ step, from, winners: winners.map(winner => winner.id), tile, selfDraw,
      deltas: this.players.map((player, index) => player.points - before[index]) });
    return result;
  };
  session.chooseExchange = function (player) {
    const selected = originalExchange(player);
    preparation.push({ seat: player.id, selected, tiles: selected.map(index => player.hand[index]) });
    return selected;
  };
  session.botChoice = function (player, choices) {
    const featureVersion = model?.featureVersion === 3 ? 3 : 2;
    const input = { ...this.regionalBotInput(player, choices), aiVersion: featureVersion === 3 ? 10 : 9 };
    const features = engine.encodeSichuanFeatures(input, featureVersion), mask = engine.sichuanLegalMask(choices), seat = player.id;
    if (features.length !== (featureVersion === 3 ? 476 : 472) || features.some(value => !Number.isFinite(value))) throw new Error('Invalid public features');
    const previous = trajectories[seat].at(-1);
    if (previous) {
      previous.rawR = (player.points - previous.p) / 32;
      previous.r = utility(player.points - initial[seat]) - utility(previous.p - initial[seat]);
    } else preDecision[seat] = player.points - initial[seat];
    const candidate = candidateSeat == null || candidateSeat === seat;
    let decision, selected, recordedMask = mask, proposalPolicy = false;
    if (mode === 'teacher') {
      decision = engine.chooseRegionalAction({ ...input, aiVersion: 7 }); teacherNodes += decision.searchNodes;
    } else if (mode === 'incumbent' || !candidate) decision = args.opponents === 'algorithm'
      ? engine.chooseRegionalAction({ ...input, aiVersion: 7 }) : incumbent.chooseSichuanHybridAction({ ...input, aiVersion: 8 });
    else if (mode === 'proposal') {
      const state = engine.prepareSichuanProposal(input);
      if (state.actions.length) {
        recordedMask = engine.sichuanProposalMask(state);
        selected = selectAction(policy, features, recordedMask, random, Boolean(args.greedy));
        decision = engine.executeSichuanProposal(state, selected.action, 'sichuan-proposal-actor');
        proposalPolicy = recordedMask.reduce((sum, flag) => sum + flag, 0) > 1;
        if (proposalPolicy) modelStats.actorDecisions++;
      } else decision = state.decision;
    } else if (mode === 'hybrid') {
      const baseline = incumbent.chooseSichuanHybridAction({ ...input, aiVersion: 8 });
      decision = hybrid(input);
      if (decision.provider === 'sichuan-model-hybrid') modelStats.focusedDecisions++;
      if (decision.key !== baseline.key) modelStats.changedActions++;
      if (decision.candidates.map(item => item.key).join('|') !== baseline.candidates.map(item => item.key).join('|')) modelStats.reorderedCandidates++;
      const pure = engine.chooseRegionalAction({ ...input, aiVersion: 7 });
      if (['pon', 'kan'].includes(choices.find(choice => choice.key === pure.key)?.type)) {
        modelStats.protectedCalls++;
        if (decision.key !== pure.key) throw new Error('Candidate changed a protected call');
      }
      if (pure.strategy === 'win' && decision.key !== pure.key) throw new Error('Candidate passed a win');
    } else {
      selected = selectAction(policy, features, mask, random, Boolean(args.greedy)); modelStats.actorDecisions++;
    }
    const choice = selected && mode !== 'proposal' ? choices.find(choice => engine.sichuanActionIndex(choice) === selected.action) : choices.find(choice => choice.key === decision.key);
    if (!selected) selected = { action: choice ? engine.sichuanActionIndex(choice) : -1, logProb: 0, value: 0 };
    if (!choice || !recordedMask[selected.action] || !mask[engine.sichuanActionIndex(choice)]) throw new Error('Illegal model or teacher action');
    trajectories[seat].push({ f: Buffer.from(features.buffer).toString('base64'), m: [...recordedMask.keys()].filter(index => recordedMask[index]),
      a: selected.action, p: player.points, lp: selected.logProb, v: selected.value, r: 0, rawR: 0,
      step: this.step, key: choice.key, type: choice.type, policy: mode === 'actor' && candidate || proposalPolicy,
      ...(mode === 'proposal' ? { proposalVersion: 1, rewardVersion: 3, behavior: proposalPolicy ? 'categorical' : 'forced',
        engineSha256, parametersSha256: model.parametersSha256,
        executedAction: engine.sichuanActionIndex(choice), proposedAction: selected.action } : {}),
      provider: decision?.provider ?? (mode === 'actor' && candidate ? 'sichuan-actor' : 'algorithm'),
      modelId: decision?.modelId, searchNodes: decision?.searchNodes, searchBudget: decision?.searchBudget });
    decisions++; this.commitBotChoice(seat, choice.key, decision?.provider ?? 'algorithm'); return choice;
  };
  let ticks = 0;
  while (!['settlement', 'match'].includes(session.stage) && ticks++ < 1800) session.tick();
  if (session.stage !== 'settlement') throw new Error(`Incomplete rule-conditioned episode ${seed}`);
  const final = session.players.map(player => player.points);
  for (let seat = 0; seat < 4; seat++) {
    const trajectory = trajectories[seat], last = trajectory.at(-1);
    if (last) { last.rawR = (final[seat] - last.p) / 32; last.r = utility(final[seat] - initial[seat]) - utility(last.p - initial[seat]); }
    else preDecision[seat] = final[seat] - initial[seat];
    let total = 0;
    for (let index = trajectory.length - 1; index >= 0; index--) {
      const record = trajectory[index]; total += record.r; record.g = total;
      if (Math.abs(total - (utility(final[seat] - initial[seat]) - utility(record.p - initial[seat]))) > 1e-9) throw new Error('Utility return mismatch');
    }
    const reconciled = preDecision[seat] + trajectory.reduce((sum, record) => sum + record.rawR * 32, 0);
    if (Math.abs(reconciled - (final[seat] - initial[seat])) > 1e-9) throw new Error('Raw score ledger mismatch');
  }
  const summary = { seed, configuration, candidateSeat, wallSha256, engineSha256, baselineEngineSha256, ticks, kind: session.result.kind, deltas: final.map((points, index) => points - initial[index]),
    winners: session.roundWinners.map(win => win.playerId), winEvents: wins.length,
    dealInEvents: [0, 1, 2, 3].map(seat => wins.filter(win => !win.selfDraw && win.from === seat).length),
    dealInPoints: [0, 1, 2, 3].map(seat => wins.filter(win => !win.selfDraw && win.from === seat).reduce((sum, win) => sum - win.deltas[seat], 0)),
    discards: trajectories.map(trajectory => trajectory.filter(record => record.type === 'discard').length),
    modelStats, actions: trajectories.map(trajectory => trajectory.length) };
  const storedTrajectories = args.metricsOnly ? trajectories.map(trajectory => trajectory.map(({ f, ...record }) => record)) : trajectories;
  appendFileSync(output, JSON.stringify({ ...summary, featureVersion: model?.featureVersion === 3 ? 3 : 2, rewardVersion: mode === 'proposal' ? 3 : 2,
    ...(mode === 'proposal' ? { mode, behavior: 'categorical', proposalVersion: 1, parametersSha256: model.parametersSha256,
      opponents: 'formal-ai8', opponentAiVersion: 8 } : {}),
    initial, final, preDecision, trajectories: storedTrajectories, ledger, wins, preparation }) + '\n');
  summaries.push(summary); session.dispose();
  if (!args.quiet) console.log(JSON.stringify({ completed: summaries.length, total: plan.length, seed, seconds: (performance.now() - began) / 1000 }));
}
const report = { output, mode, enginePath, incumbentPath, engineSha256, baselineEngineSha256, prior: args.prior ?? 'model', opponents: args.opponents ?? 'incumbent', model: args.model, parametersSha256: model?.parametersSha256, candidateSeat: args.seat == null ? 'all' : Number(args.seat),
  count: plan.length, decisions, teacherNodes, legalErrors: 0, elapsedSeconds: (performance.now() - began) / 1000, summaries };
writeFileSync(output.replace(/\.jsonl$/, '.summary.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, summaries: undefined }));
