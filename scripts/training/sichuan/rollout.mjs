import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { loadPolicy, selectAction } from './mlp.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const index = value.indexOf('='); return index < 0 ? [value, true] : [value.slice(0, index), value.slice(index + 1)];
}));
if (args['--help']) {
  console.log('node rollout.mjs runDir=PATH [count=8] [prefix=sc-v2-train] [start=0] [model=FILE.json] [seat=0] [greedy] [hybrid] [quiet]\nWithout a model, every seat uses the v7 expert teacher. With a model, all seats sample its masked actor unless seat is supplied.\nThe hybrid flag evaluates model-guided bounded search. Output defaults to runDir/data/PREFIX.jsonl.\nengine=FILE.mjs and output=FILE.jsonl override the engine and data destination. append retains previous output.');
  process.exit(0);
}
if (!args.runDir) throw new Error('runDir is required');
const root = resolve(args.runDir);
const count = Number(args.count ?? 8), start = Number(args.start ?? 0);
if (!Number.isSafeInteger(count) || count <= 0) throw new Error('count must be a positive integer');
if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(start + count)) throw new Error('start must be a nonnegative safe integer within the requested range');
if (args.seat != null && (!Number.isInteger(Number(args.seat)) || Number(args.seat) < 0 || Number(args.seat) > 3)) throw new Error('seat must be an integer from 0 to 3');
const engine = await import(pathToFileURL(args.engine ?? resolve(root, 'engine.mjs')));
const { RegionalSession, chooseRegionalAction, encodeSichuanFeatures, sichuanActionIndex, sichuanLegalMask } = engine;
RegionalSession.prototype.schedule = function () {};

function seededRandom(seed) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
const policy = args.model ? loadPolicy(args.model, engine.createSichuanPolicy) : null;
const hybrid = args.hybrid ? engine.createSichuanHybridPolicy(JSON.parse(readFileSync(args.model, 'utf8'))) : null;
const prefix = args.prefix ?? 'sc-v2-train';
const output = args.output ? resolve(args.output) : resolve(root, `data/${prefix}.jsonl`);
mkdirSync(dirname(output), { recursive: true });
if (!args.append) writeFileSync(output, '');
const summaries = [];
let decisions = 0, teacherNodes = 0, legalErrors = 0;
const started = performance.now();

for (let game = start; game < start + count; game++) {
  const seed = `${prefix}-${String(game).padStart(5, '0')}`;
  const random = seededRandom(`${seed}:policy`);
  const session = new RegionalSession({
    mode: 'sichuan-blood', seed, difficulty: 'expert', autoPlayDifficulty: 'expert',
    autoPlay: true, speed: 0, matchLength: 'single', rulesVersion: 2,
    variantOptions: { exchangeThree: false, sichuan: { version: 2, fanCap: 4, selfDraw: 'base', menqingZhongzhang: false } },
  });
  session.cancel();
  session.publish = function () {};
  const trajectories = [[], [], [], []];
  const initial = session.players.map(player => player.points);
  const wallSha256 = createHash('sha256').update(JSON.stringify([session.players.map(player => player.hand), session.wall])).digest('hex');
  const modelStats = { focusedDecisions: 0, changedActions: 0, protectedCalls: 0 };
  const preDecision = [0, 0, 0, 0];
  const ledger = [];
  const transfer = session.transfer.bind(session);
  session.transfer = function (from, to, amount, kong) {
    ledger.push({ step: this.step, from, to, amount, kong: Boolean(kong), retired: this.players.map(player => player.hasWon), stage: this.stage });
    return transfer(from, to, amount, kong);
  };
  session.botChoice = function (player, choices) {
    const input = this.regionalBotInput(player, choices);
    input.aiVersion = 7;
    input.exchangeThree = false;
    const features = encodeSichuanFeatures(input, 1);
    const mask = sichuanLegalMask(choices);
    const seat = player.id;
    const previous = trajectories[seat].at(-1);
    if (previous) previous.r = (player.points - previous.p) / 32;
    else preDecision[seat] = player.points - initial[seat];
    const modelSeat = args.seat == null || Number(args.seat) === seat;
    let choice, selected;
    if (hybrid && modelSeat) {
      const baseline = chooseRegionalAction(input);
      const decision = hybrid({ ...input, aiVersion: 8 });
      choice = choices.find(action => action.key === decision.key);
      selected = { action: choice ? sichuanActionIndex(choice) : -1, logProb: 0, value: 0 };
      if (decision.provider === 'sichuan-model-hybrid') modelStats.focusedDecisions++;
      if (decision.key !== baseline.key) modelStats.changedActions++;
      const baselineChoice = choices.find(action => action.key === baseline.key);
      if (['pon', 'kan'].includes(baselineChoice.type)) {
        modelStats.protectedCalls++;
        if (decision.key !== baseline.key) throw new Error('Hybrid changed a protected baseline call');
      }
      if (baseline.strategy === 'win' && decision.key !== baseline.key) throw new Error('Hybrid passed an available win');
    } else if (policy && modelSeat) {
      selected = selectAction(policy, features, mask, random, Boolean(args.greedy));
      choice = choices.find(action => sichuanActionIndex(action) === selected.action);
    } else {
      const teacher = chooseRegionalAction(input);
      teacherNodes += teacher.searchNodes;
      choice = choices.find(action => action.key === teacher.key);
      selected = { action: choice ? sichuanActionIndex(choice) : -1, logProb: 0, value: 0 };
    }
    if (!choice || !mask[selected.action]) { legalErrors++; throw new Error('Policy selected an illegal engine action'); }
    if (features.some(value => !Number.isFinite(value))) throw new Error('Non-finite public feature');
    const record = {
      f: Buffer.from(features.buffer).toString('base64'), m: [...mask.keys()].filter(index => mask[index]),
      a: selected.action, p: player.points, lp: selected.logProb, v: selected.value, r: 0,
      step: this.step, type: choice.type, policy: Boolean(policy && modelSeat),
    };
    trajectories[seat].push(record);
    decisions++;
    this.commitBotChoice(seat, choice.key, 'algorithm');
    return choice;
  };
  let ticks = 0;
  while (!['settlement', 'match'].includes(session.stage) && ticks++ < 1200) session.tick();
  if (session.stage !== 'settlement') throw new Error(`Incomplete episode ${seed}, stage ${session.stage}`);
  const final = session.players.map(player => player.points);
  for (let seat = 0; seat < 4; seat++) {
    const trajectory = trajectories[seat];
    if (trajectory.length) trajectory.at(-1).r = (final[seat] - trajectory.at(-1).p) / 32;
    else preDecision[seat] = final[seat] - initial[seat];
    let total = 0;
    for (let index = trajectory.length - 1; index >= 0; index--) {
      const transition = trajectory[index];
      total += transition.r;
      transition.g = total;
      const expected = (final[seat] - transition.p) / 32;
      if (Math.abs(total - expected) > 1e-9) throw new Error('Future-net return mismatch');
    }
    const reconciled = preDecision[seat] + trajectory.reduce((sum, transition) => sum + transition.r * 32, 0);
    if (Math.abs(reconciled - (final[seat] - initial[seat])) > 1e-9) throw new Error('Per-seat ledger mismatch');
  }
  const summary = { seed, wallSha256, ticks, kind: session.result.kind, deltas: session.result.deltas, modelStats,
    winners: session.roundWinners.map(win => win.playerId), kongTransfers: ledger.filter(entry => entry.kong).length,
    retiredTransfers: ledger.filter(entry => entry.retired[entry.to] || entry.retired[entry.from]).length,
    actions: trajectories.map(trajectory => trajectory.length) };
  const episode = { ...summary, initial, final, preDecision, trajectories, ledger };
  appendFileSync(output, JSON.stringify(episode) + '\n');
  summaries.push(summary);
  session.dispose();
  if (!args.quiet) console.log(JSON.stringify({ game: game + 1, ...summary, elapsedSeconds: (performance.now() - started) / 1000 }));
}
const report = { output, prefix, start, count, decisions, teacherNodes, legalErrors,
  elapsedSeconds: (performance.now() - started) / 1000, summaries };
writeFileSync(output.replace(/\.jsonl$/, '.summary.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ complete: args.quiet ? { ...report, summaries: undefined } : report }));
