import Majiang from '@kobalab/majiang-core';
import { AI_VERSION, validDifficulty } from './ai/types';
import type { BotAction, BotDecision, Difficulty } from './ai/types';
import { createBotObservation } from './ai/observation';
import { chooseRiichiAction } from './ai/riichi';
import { chooseLegacyAction } from './ai/legacy';
import { BotDecisionService } from './ai/service';
import { TanyaoDecisionService } from './ai/tanyaoService';
import { TANYAO_MODEL_IDENTITY } from './ai/models/tanyaoFeatures';
import { furitenView, MissedWinTracker } from './assist/furiten';
import { furitenReasons, noYakuReason } from './ronNotice';
import { createRiichiAssistCalculator, projectRiichiAssist } from './assist/riichiAssist';
import { chooseQuickAction, DEFAULT_QUICK_CONTROLS, updateQuickControls } from './quickControls';
import { appendReplayFrame, finishReplayFrames, MAX_REPLAY_STEPS, validateReplayData, yieldReplayWork } from './replaySupport';
import { newEndlessSessionId } from './endlessCheckpoint';
import type {
  ActionType, EndlessCheckpoint, GameLogEntry, GameSnapshot, HandTile, LegalAction, MeldView,
  ReplayData, RiichiSessionAPI, RoundResult, SavedGame, SessionOptions, WinnerView, ConfirmedWinEvent,
  QuickControls, ReplayFrame, RonNotice, BotReplayDecision,
} from './types';
export type * from './types';

const NAMES = ['你', '青岚', '千鹤', '北辰'];
const WINDS = ['东', '南', '西', '北'];
const HONORS = ['', '东', '南', '西', '北', '白', '发', '中'];
const NUMERALS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
let displaySessionSequence = 0;
type Core = any;
type Reply = Record<string, unknown>;
interface Choice extends LegalAction { key: string; reply: Reply }
interface Pending { player: SessionPlayer; choices: Choice[]; reply: (reply: Reply) => void; missedShape?: boolean; riichiAtResponse?: boolean }

export function tileLabel(tile: string): string {
  if (!tile || tile === '_') return '暗牌';
  if (tile[0] === 'z') return HONORS[Number(tile[1])] || tile;
  const rank = Number(tile[1]) || 5;
  return `${tile[1] === '0' ? '赤' : ''}${NUMERALS[rank]}${({ m: '万', p: '筒', s: '条' } as Record<string, string>)[tile[0]] || ''}`;
}

function normalize(tile: string): string { return tile.slice(0, 2).replace('0', '5'); }
function parseTiles(text: string): string[] {
  const result: string[] = [];
  for (const group of text.split(',')[0].match(/[mpsz]\d+/g) || []) {
    for (const number of group.slice(1)) result.push(group[0] + number);
  }
  return result;
}
function handTiles(hand: Core): HandTile[] {
  const tiles = parseTiles(hand.toString());
  const hasDraw = hand._zimo && hand._zimo.length === 2;
  return tiles.map((tile, i) => ({ id: `hand-${i}-${tile}`, tile, label: tileLabel(tile), drawn: Boolean(hasDraw && i === tiles.length - 1) }));
}
function meldView(meld: string, id: string): MeldView {
  const tiles = (meld.match(/\d/g) || []).map(number => meld[0] + number);
  const concealed = !/[+=-]/.test(meld);
  return { id, tiles, concealed, type: tiles.length === 4 ? 'kan' : new Set(tiles.map(normalize)).size === 1 ? 'pon' : 'chi' };
}
function randomFromSeed(seed: string): () => number {
  let value = 2166136261;
  for (const char of seed) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return () => {
    value += 0x6D2B79F5;
    let t = Math.imul(value ^ value >>> 15, 1 | value);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
/** Build a core-compatible wall without ever replacing global Math.random. */
function seededWall(rule: Core, random: () => number): Core {
  const wall = Object.create(Majiang.Shan.prototype);
  const tiles: string[] = [];
  for (const suit of ['m', 'p', 's', 'z']) {
    for (let number = 1; number <= (suit === 'z' ? 7 : 9); number++) {
      for (let copy = 0; copy < 4; copy++) {
        tiles.push(suit + (suit !== 'z' && number === 5 && copy < rule['赤牌'][suit] ? 0 : number));
      }
    }
  }
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  Object.assign(wall, { _rule: rule, _pai: tiles, _baopai: [tiles[4]], _fubaopai: [tiles[9]], _weikaigang: false, _closed: false });
  return wall;
}

/** The base Player receives its own hand and public events only, never the engine's full model. */
class SessionPlayer extends Majiang.Player {
  constructor(private session: RiichiSession, readonly seatId: number) { super(); }
  private decide(type: string, data: Core): void { this.session.receive(this, type, data, this._callback); }
  action_kaiju(data: Core): void { this.decide('kaiju', data); }
  action_qipai(data: Core): void { this.decide('qipai', data); }
  action_zimo(data: Core, kan: boolean): void { this.decide(kan ? 'gangzimo' : 'zimo', data); }
  action_dapai(data: Core): void { this.decide('dapai', data); }
  action_fulou(data: Core): void { this.decide('fulou', data); }
  action_gang(data: Core): void { this.decide('gang', data); }
  action_hule(data: Core): void { this.decide('hule', data); }
  action_pingju(data: Core): void { this.decide('pingju', data); }
  action_jieju(data: Core): void { this.decide('jieju', data); }
}

function legalChoices(player: SessionPlayer, type: string, data: Core): Choice[] {
  const choices: Choice[] = [];
  const ownTurn = data.l === player._menfeng;
  const add = (actionType: ActionType, payload: string, label: string, reply: Reply, extra: Partial<LegalAction> = {}) => {
    const key = `${actionType}:${payload}`;
    choices.push({ id: key, key, type: actionType, label, reply, ...extra });
  };
  const discards = () => {
    const tiles = handTiles(player.shoupai);
    for (const discard of player.get_dapai(player.shoupai) || []) {
      const tile = discard.slice(0, 2);
      const matching = tiles.filter(item => item.tile === tile && (discard.includes('_') ? item.drawn : !item.drawn));
      for (const item of matching) {
        add('discard', `${discard}:${item.id}`, `打出${tileLabel(tile)}`, { dapai: discard }, { tile, tileId: item.id });
        if (type !== 'fulou' && player.allow_lizhi(player.shoupai, discard)) {
          add('riichi', `${discard}:${item.id}`, `立直 · ${tileLabel(tile)}`, { dapai: `${discard}*` }, { tile, tileId: item.id, description: '支付 1,000 点，打出这张牌并宣告立直。' });
        }
      }
    }
  };
  if ((type === 'zimo' || type === 'gangzimo') && ownTurn) {
    if (player.allow_hule(player.shoupai, null, type === 'gangzimo')) add('tsumo', '', '自摸', { hule: '-' });
    for (const meld of player.get_gang_mianzi(player.shoupai) || []) {
      add('kan', meld, /[+=-]/.test(meld) ? '加杠' : '暗杠', { gang: meld }, { tiles: meldView(meld, '').tiles });
    }
    if (player.allow_pingju(player.shoupai)) add('abort', '', '九种九牌', { daopai: '-' }, { description: '第一巡有九种以上幺九牌，可以选择中途流局。' });
    discards();
  } else if (type === 'fulou' && ownTurn && player.shoupai._zimo) {
    discards();
  } else if (type === 'dapai' && !ownTurn) {
    const relative = '_+=-'[(4 + data.l - player._menfeng) % 4];
    const tile = data.p + relative;
    if (player.allow_hule(player.shoupai, tile)) add('ron', tile, '荣和', { hule: '+' }, { tile: data.p.slice(0, 2) });
    for (const meld of player.get_gang_mianzi(player.shoupai, tile) || []) add('kan', meld, '明杠', { fulou: meld }, { tiles: meldView(meld, '').tiles });
    for (const meld of player.get_peng_mianzi(player.shoupai, tile) || []) add('pon', meld, '碰', { fulou: meld }, { tiles: meldView(meld, '').tiles });
    for (const meld of player.get_chi_mianzi(player.shoupai, tile) || []) add('chi', meld, '吃', { fulou: meld }, { tiles: meldView(meld, '').tiles });
    if (choices.length) add('pass', '', '跳过', {});
  } else if (type === 'gang' && !ownTurn && !/^[mpsz]\d{4}$/.test(data.m)) {
    const tile = data.m[0] + data.m.slice(-1) + '_+=-'[(4 + data.l - player._menfeng) % 4];
    if (player.allow_hule(player.shoupai, tile, true)) {
      add('ron', tile, '抢杠荣和', { hule: '+' }, { tile: tile.slice(0, 2) });
      add('pass', '', '跳过', {});
    }
  }
  return choices;
}

function botActions(choices: Choice[]): BotAction[] {
  return choices.map(choice => ({ key: choice.key, type: choice.type, tile: choice.tile,
    ...(typeof choice.reply.dapai === 'string' ? { discard: choice.reply.dapai } : {}),
    ...(typeof choice.reply.gang === 'string' ? { meld: choice.reply.gang, concealedKan: true } : {}),
    ...(typeof choice.reply.fulou === 'string' ? { meld: choice.reply.fulou, concealedKan: false } : {}),
  }));
}

export class RiichiSession implements RiichiSessionAPI {
  private listeners = new Set<() => void>();
  private game: Core;
  private players: SessionPlayer[] = [];
  private pending: Pending | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private options: { seed: string; speed: number; autoPlay: boolean; autoPlayDifficulty: Difficulty; autoExchangeThree: boolean; matchLength: 'hanchan' | 'east' | 'single' | 'endless'; difficulty: Difficulty };
  private aiVersion = AI_VERSION;
  private botJobs = 0;
  private botService = new BotDecisionService();
  private autoPlayService = new BotDecisionService();
  private tanyaoService = new TanyaoDecisionService();
  private botDecisions: BotReplayDecision[] = [];
  private botSequences = new Map<string, number>();
  private replayBotChoices = new Map<string, BotReplayDecision>();
  private deferredBots: Array<() => void> = [];
  private autoPlayRequestVersion = 0;
  private missedWin = new MissedWinTracker();
  private calculateAssist = createRiichiAssistCalculator();
  private quickControls: QuickControls = { ...DEFAULT_QUICK_CONTROLS };
  private replayFrames: ReplayFrame[] | null = null;
  private replayLabel = '';
  private rule: Core;
  private snapshot!: GameSnapshot;
  private result: RoundResult | null = null;
  private latestWin?: ConfirmedWinEvent;
  private ronNotice?: RonNotice;
  private ronEventSequence = 0;
  private readonly displaySessionId = ++displaySessionSequence;
  private winEventSequence = 0;
  private log: GameLogEntry[] = [];
  private decisions: { key: string }[] = [];
  private generation = 0;
  private step = 0;
  private revision = 0;
  private paused = false;
  private finished = false;
  private disposed = false;
  private replaying = false;
  private continueRound: (() => void) | null = null;
  private handSequence = 0;
  private endlessRotation = 0;
  private endlessSessionId = '';
  private checkpoint?: EndlessCheckpoint;

  constructor(options: SessionOptions = {}) {
    this.options = { seed: options.seed || `riichi-${Date.now()}`, speed: options.speed ?? 450, autoPlay: options.autoPlay ?? false, autoPlayDifficulty: validDifficulty(options.autoPlayDifficulty) ? options.autoPlayDifficulty : 'expert', autoExchangeThree: options.autoExchangeThree ?? false, matchLength: options.matchLength || 'hanchan', difficulty: validDifficulty(options.difficulty) ? options.difficulty : 'standard' };
    this.newGame(this.options);
  }
  getSnapshot = (): GameSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private cancelTimer(): void { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  private append(text: string, playerId?: number, tile?: string): void {
    this.log.push({ id: this.log.length ? this.log[this.log.length - 1].id + 1 : 1, text, playerId, tile });
    if (this.log.length > 100) this.log.shift();
  }
  newGame(options: SessionOptions = {}): void { this.initialize(options); }
  private initialize(options: SessionOptions, checkpoint?: EndlessCheckpoint): void {
    this.cancelTimer();
    this.botService.cancel();
    this.tanyaoService.dispose();
    this.autoPlayService.cancel(); this.autoPlayRequestVersion++;
    this.botJobs = 0;
    this.quickControls = updateQuickControls(this.quickControls, options.quickControls);
    if (!this.replaying) this.aiVersion = AI_VERSION;
    this.options = { ...this.options, ...options, seed: options.seed || this.options.seed,
      difficulty: validDifficulty(options.difficulty) ? options.difficulty : this.options.difficulty,
      autoPlayDifficulty: validDifficulty(options.autoPlayDifficulty) ? options.autoPlayDifficulty : this.options.autoPlayDifficulty,
      autoExchangeThree: options.autoExchangeThree ?? this.options.autoExchangeThree };
    if (this.options.matchLength !== 'endless') checkpoint = undefined;
    this.handSequence = checkpoint ? checkpoint.sequence - 1 : 0;
    this.endlessRotation = checkpoint?.rotation ?? 0;
    this.endlessSessionId = this.options.matchLength === 'endless' ? checkpoint?.sessionId ?? newEndlessSessionId() : '';
    this.checkpoint = undefined;
    this.generation++;
    this.step = 0;
    this.disposed = false;
    this.finished = false;
    this.paused = false;
    this.result = null;
    this.latestWin = undefined;
    this.ronNotice = undefined;
    this.log = [];
    this.decisions = [];
    this.botDecisions = []; this.botSequences.clear(); this.deferredBots = [];
    this.pending = null;
    this.continueRound = null;
    this.rule = Majiang.rule({ '場数': this.options.matchLength === 'single' ? 0 : this.options.matchLength === 'east' ? 1 : 2 });
    const random = randomFromSeed(this.options.seed);
    this.players = [0, 1, 2, 3].map(id => new SessionPlayer(this, id));
    this.game = new Majiang.Game(this.players, () => {}, this.rule, '雀间 · 离线立直');
    this.game._sync = true;
    this.game.model.player = [...NAMES];
    const originalDeal = this.game.qipai.bind(this.game);
    this.game.qipai = () => {
      if (this.options.matchLength !== 'endless') return originalDeal(seededWall(this.rule, random));
      const model = this.game.model;
      this.handSequence++;
      this.checkpoint = { version: 1, sessionId: this.endlessSessionId, sequence: this.handSequence,
        points: [...model.defen], dealer: (model.qijia + model.jushu) % 4, rotation: this.endlessRotation,
        honba: model.changbang, sticks: model.lizhibang };
      this.decisions = []; this.step = 0; this.generation++;
      this.botDecisions = []; this.botSequences.clear();
      // Only the current segment is replayable; earlier hands live in records.
      this.game._paipu.log = [];
      return originalDeal(seededWall(this.rule, randomFromSeed(`${this.options.seed}|endless:${this.handSequence}`)));
    };
    const originalLast = this.game.last.bind(this.game);
    this.game.last = () => {
      this.paused = true;
      this.pending = null;
      this.continueRound = this.options.matchLength === 'single' ? () => this.game.jieju()
        : this.options.matchLength === 'endless' ? () => {
          const model = this.game.model;
          model.lunban = -1;
          if (this.game._view) this.game._view.update();
          if (!this.game._lianzhuang) {
            model.jushu++;
            this.endlessRotation++;
            model.zhuangfeng = (model.zhuangfeng + Math.floor(model.jushu / 4)) % 4;
            model.jushu %= 4;
          }
          this.game.delay(() => this.game.qipai(), 0);
        } : originalLast;
      if (this.result) this.result.scores = [...this.game.model.defen];
      // All hule callbacks (including multiple ron) and their real transfers have
      // completed here. Publish a single complete public event for the display.
      if (this.result?.kind === 'win') this.latestWin = structuredClone({
        id: `riichi:${this.displaySessionId}:${++this.winEventSequence}`,
        winners: this.result.winners, deltas: this.result.deltas,
        scores: this.result.scores, continuing: false,
      });
    };
    this.game.kaiju(0);
    if (checkpoint) {
      const model = this.game.model;
      model.defen = [...checkpoint.points]; model.zhuangfeng = Math.floor(checkpoint.rotation / 4) % 4;
      model.jushu = checkpoint.rotation % 4; model.changbang = checkpoint.honba; model.lizhibang = checkpoint.sticks;
    }
    this.game.next(); // Deal immediately so the initial 3D table has four complete seats.
    this.publish();
    this.schedule();
  }
  receive(player: SessionPlayer, type: string, data: Core, callback: (reply: Reply) => void): void {
    const human = player.seatId === 0;
    if (human) {
      this.observe(type, data);
      if (this.ronNotice) this.ronNotice.active = false;
      if (type === 'qipai') { this.missedWin.reset(); this.ronNotice = undefined; }
      if ((type === 'zimo' || type === 'gangzimo') && data.l === player._menfeng) { this.missedWin.ownDraw(); this.ronNotice = undefined; }
      if (type === 'dapai' && data.l === player._menfeng) this.missedWin.ownDiscard(Boolean(player.shoupai.lizhi));
    }
    // The upstream core closes its ron gate after any passed shape-completing
    // discard/added kong (including a no-yaku shape). Hold that pending reason
    // until the local response resolves, so an offered ron never says furiten.
    const responseTile = type === 'dapai' ? data.p?.slice(0, 2)
      : type === 'gang' && !/^[mpsz]\d{4}$/.test(data.m) ? data.m[0] + data.m.slice(-1) : undefined;
    const missedShape = human && data.l !== player._menfeng && responseTile != null
      && (player.hulepai as string[]).some(tile => normalize(tile) === normalize(responseTile));
    const choices = legalChoices(player, type, data);
    if (human && choices.some(choice => choice.type === 'ron')) this.ronNotice = undefined;
    else if (missedShape) {
      const relative = '_+=-'[(4 + data.l - player._menfeng) % 4];
      const completedTile = responseTile! + relative;
      const externalYaku = Boolean(type === 'gang' || player.shoupai.lizhi || player.shan.paishu === 0);
      const reasons: string[] = [];
      // Ask the same core predicate without its furiten gate to distinguish no-yaku from furiten.
      if (!Majiang.Game.allow_hule(this.rule, player.shoupai, completedTile, player.model.zhuangfeng, player._menfeng, externalYaku, true)) reasons.push(noYakuReason(player.shoupai.menqian));
      if (!player._neng_rong) {
        reasons.push(...furitenReasons(furitenView(player.hulepai, player.he._pai, this.missedWin.getState())));
        if (!reasons.some(reason => reason.includes('振听'))) reasons.push('振听：当前不能荣和；须解除振听，有役时也可自摸。');
      }
      if (reasons.length) this.ronNotice = { id: `riichi:${this.displaySessionId}:ron:${++this.ronEventSequence}`, tile: responseTile!, fromId: player.model.player_id[data.l], event: type === 'gang' ? 'addedKan' : 'discard', active: choices.length > 0, reasons };
    }
    if (!choices.length) {
      if (missedShape) this.missedWin.miss(Boolean(player.shoupai.lizhi));
      callback({}); return;
    }
    if (human) {
      for (const choice of choices) choice.id = `${this.generation}:${this.step}:${choice.key}`;
      this.pending = { player, choices, reply: callback, missedShape, riichiAtResponse: Boolean(player.shoupai.lizhi) };
    } else this.decideBot(player, choices, choice => callback(choice.reply));
  }
  private decideBot(player: SessionPlayer, choices: Choice[], done: (choice: Choice) => void): void {
    const human = player.seatId === 0;
    const commit = (key: string, source: BotDecision['provider'] = 'algorithm') => {
      const choice = choices.find(choice => choice.key === key) || choices[0];
      if (this.aiVersion >= 7 && !human) {
        const prefix = `${this.step}:${player.seatId}`, sequence = this.botSequences.get(prefix) || 0;
        this.botSequences.set(prefix, sequence + 1);
        this.botDecisions.push({ step: this.step, playerId: player.seatId, sequence, key: choice.key, source });
      }
      done(choice);
    };
    if (this.replaying && this.aiVersion >= 7 && !human) {
      const prefix = `${this.step}:${player.seatId}`, sequence = this.botSequences.get(prefix) || 0;
      const recorded = this.replayBotChoices.get(`${prefix}:${sequence}`);
      if (recorded) {
        if (!choices.some(choice => choice.key === recorded.key)) throw new Error('牌谱电脑操作与当前合法动作不一致。');
        commit(recorded.key, recorded.source);
      } else {
        const generation = this.generation;
        this.deferredBots.push(() => { if (generation === this.generation && !this.disposed) this.decideBot(player, choices, done); });
      }
      return;
    }
    const observation = createBotObservation(player.seatId, player._menfeng, player.shoupai.toString(), player.model, this.options.matchLength);
    const actions = botActions(choices);
    const difficulty = human ? this.options.autoPlayDifficulty : this.options.difficulty;
    const decisionVersion = human ? this.aiVersion >= 7 ? AI_VERSION : 6 : this.aiVersion;
    const legacyOpponent = !human && this.aiVersion === 1;
    const synchronous = () => legacyOpponent
      ? chooseLegacyAction(observation, actions)
      : chooseRiichiAction(observation, actions, difficulty, decisionVersion).key;
    if (this.replaying || typeof Worker === 'undefined' || legacyOpponent || !['advanced', 'expert'].includes(difficulty)) {
      const key = synchronous();
      commit(key);
      return;
    }
    const win = this.aiVersion >= 7 && choices.find(choice => choice.type === 'ron' || choice.type === 'tsumo');
    if (win) { commit(win.key); return; }
    const generation = this.generation;
    const autoPlayRequestVersion = this.autoPlayRequestVersion;
    this.botJobs++;
    let released = false;
    const current = () => !human || (this.options.autoPlay && autoPlayRequestVersion === this.autoPlayRequestVersion);
    const finish = (key?: string, source?: BotDecision['provider']) => {
      if (generation !== this.generation || this.disposed) return;
      if (!released) { released = true; this.botJobs = Math.max(0, this.botJobs - 1); }
      if (key && current()) commit(key, source);
      this.publish(); this.schedule();
    };
    const request = this.aiVersion >= 7
      ? this.tanyaoService.choose(observation, actions, difficulty, {
        drawn: typeof player.shoupai._zimo === 'string' && /^[mpsz]\d$/.test(player.shoupai._zimo) ? player.shoupai._zimo : null,
        furiten: !player._neng_rong,
      }, human ? 'autoplay' : 'opponent')
      : (human ? this.autoPlayService : this.botService).choose(observation, actions, difficulty, decisionVersion);
    request.then(
      decision => finish(decision?.key, decision?.provider),
      () => { if (generation === this.generation && !this.disposed) finish(current() ? synchronous() : undefined); },
    );
  }
  private observe(type: string, data: Core): void {
    const board = this.players[0].model;
    const id = typeof data.l === 'number' ? board.player_id[data.l] : undefined;
    this.replayLabel = type === 'zimo' || type === 'gangzimo' ? `${NAMES[id!]}${type === 'gangzimo' ? '杠后补牌' : '摸牌'}` : '';
    if (type === 'qipai') {
      this.result = null;
      this.latestWin = undefined;
      this.append(`${WINDS[data.zhuangfeng]} ${data.jushu + 1} 局 · ${data.changbang} 本场`);
    } else if (type === 'dapai') this.append(`${NAMES[id!]}${data.p.includes('*') ? '立直，打出' : '打出'}${tileLabel(data.p)}`, id, data.p.slice(0, 2));
    else if (type === 'fulou') {
      const meld = meldView(data.m, '');
      this.append(`${NAMES[id!]}${meld.type === 'chi' ? '吃' : meld.type === 'pon' ? '碰' : '明杠'} ${meld.tiles.map(tileLabel).join(' ')}`, id);
    } else if (type === 'gang') this.append(`${NAMES[id!]}${/[+=-]/.test(data.m) ? '加杠' : '暗杠'}`, id);
    else if (type === 'hule') {
      const fromId = data.baojia == null ? undefined : board.player_id[data.baojia];
      const delta = [0, 0, 0, 0];
      data.fenpei.forEach((points: number, seat: number) => { delta[board.player_id[seat]] = points; });
      const tiles = parseTiles(data.shoupai);
      const melds = data.shoupai.split(',').slice(1).map((meld: string, index: number) => {
        const view = meldView(meld, `${id}-win-meld-${index}`);
        const direction = meld.match(/[+=-]/)?.[0];
        if (direction) view.from = board.player_id[(data.l + '_+=-'.indexOf(direction)) % 4];
        return view;
      });
      const winner: WinnerView = { playerId: id!, fromId, fu: data.fu || 0, han: data.fanshu || 0, points: data.defen, yakuman: data.damanguan || 0, yaku: (data.hupai || []).map((yaku: Core) => ({ name: yaku.name, han: yaku.fanshu })), hand: tiles, winningTile: tiles[tiles.length - 1], melds, payments: [...delta] };
      if (this.result?.kind === 'win') {
        this.result.winners.push(winner);
        this.result.deltas = this.result.deltas.map((points, i) => points + delta[i]);
        this.result.title = '双响 · 荣和';
      } else this.result = { kind: 'win', title: fromId == null ? '自摸和了' : '荣和', description: `${NAMES[id!]}${fromId == null ? '自摸' : `荣和 · ${NAMES[fromId]}放铳`}`, winners: [winner], deltas: delta, scores: [] };
      this.append(`${NAMES[id!]}${fromId == null ? '自摸' : '荣和'} · ${data.defen.toLocaleString()} 点`, id);
    } else if (type === 'pingju') {
      const delta = [0, 0, 0, 0];
      const tenpai = [false, false, false, false];
      data.fenpei.forEach((points: number, seat: number) => { delta[board.player_id[seat]] = points; tenpai[board.player_id[seat]] = Boolean(data.shoupai[seat]); });
      const names: Record<string, string> = { 荒牌平局: '荒牌流局', 流し満貫: '流局满贯', 九種九牌: '九种九牌', 三家和: '三家和了', 四家立直: '四家立直', 四風連打: '四风连打', 四開槓: '四杠散了' };
      const title = names[data.name] || data.name;
      this.result = { kind: ['荒牌平局', '流し満貫'].includes(data.name) ? 'draw' : 'abort', title, description: data.name === '荒牌平局' ? '牌山耗尽，根据听牌状态进行结算。' : '依照当前立直规则结算本局。', winners: [], deltas: delta, scores: [], tenpai };
      this.append(title);
    } else if (type === 'jieju') {
      this.finished = true;
      this.result = { kind: 'match', title: '对局结束', description: `${NAMES[data.rank.indexOf(1)]}获得第一名`, winners: [], deltas: [0, 0, 0, 0], scores: [...data.defen], ranks: [...data.rank] };
      this.append('对局结束');
    }
  }
  private schedule(): void {
    if (this.disposed || this.replaying || this.paused || this.finished || this.botJobs > 0 || this.timer !== null) return;
    if (this.pending && !this.options.autoPlay && !this.quickChoice()) return;
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (generation !== this.generation || this.disposed) return;
      if (this.pending) {
        const pending = this.pending;
        if (this.options.autoPlay) this.decideBot(pending.player, pending.choices, choice => {
          if (this.options.autoPlay && this.pending === pending) this.choosePending(choice);
        });
        else { const quick = this.quickChoice(); if (quick) this.choosePending(quick); }
      }
      this.advance();
      this.schedule();
    }, this.options.speed);
  }
  private quickChoice(): Choice | undefined {
    if (this.replaying || !this.pending) return undefined;
    const drawn = handTiles(this.pending.player.shoupai).find(tile => tile.drawn);
    return chooseQuickAction(this.pending.choices, this.quickControls, drawn?.id);
  }
  private advance(): void {
    if (this.pending || this.paused || this.finished || this.disposed || this.botJobs > 0) return;
    this.step++;
    this.game.next();
    this.publish();
  }
  private choosePending(choice: Choice): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    if (this.ronNotice) this.ronNotice.active = false;
    if (pending.missedShape && choice.type !== 'ron') this.missedWin.miss(Boolean(pending.riichiAtResponse));
    this.decisions.push({ key: choice.key });
    pending.reply(choice.reply);
  }
  dispatch(actionId: string): boolean {
    if (this.disposed || this.finished) return false;
    if (this.paused && actionId === `${this.generation}:${this.step}:next`) {
      this.decisions.push({ key: 'next' });
      this.paused = false;
      const next = this.continueRound;
      this.continueRound = null;
      this.step++;
      next?.();
      this.publish();
      this.schedule();
      return true;
    }
    const choice = this.pending?.choices.find(item => item.id === actionId);
    if (!choice) return false;
    this.cancelTimer();
    this.choosePending(choice);
    this.advance();
    this.schedule();
    return true;
  }
  setAutoPlay(enabled: boolean): void {
    this.options.autoPlay = enabled;
    if (!enabled) { this.autoPlayRequestVersion++; this.autoPlayService.cancel(); this.tanyaoService.cancel('autoplay'); }
    this.cancelTimer(); this.publish(); this.schedule();
  }
  setAutoPlayDifficulty(difficulty: Difficulty): void {
    if (!validDifficulty(difficulty) || this.options.autoPlayDifficulty === difficulty) return;
    this.options.autoPlayDifficulty = difficulty;
    this.autoPlayRequestVersion++; this.autoPlayService.cancel();
    this.tanyaoService.cancel('autoplay');
    this.cancelTimer(); this.publish(); this.schedule();
  }
  setAutoExchangeThree(enabled: boolean): void {
    this.options.autoExchangeThree = enabled;
    this.publish();
  }
  setQuickControls(controls: Partial<QuickControls>): void {
    this.quickControls = updateQuickControls(this.quickControls, controls);
    this.cancelTimer(); this.publish(); this.schedule();
  }
  setSpeed(milliseconds: number): void { this.options.speed = Math.max(0, Math.min(3000, Number.isFinite(milliseconds) ? milliseconds : 450)); this.cancelTimer(); this.publish(); this.schedule(); }
  private publish(): void {
    if (this.replaying && !this.replayFrames) return;
    const board = this.players[0].model;
    const publicModel = this.game.model;
    const players = [0, 1, 2, 3].map(id => {
      const seat = board.player_id.indexOf(id);
      const hand = board.shoupai[seat];
      const revealed = this.paused && (this.result?.winners.some(winner => winner.playerId === id) || this.result?.tenpai?.[id]);
      return { id, name: NAMES[id], wind: WINDS[seat], points: publicModel.defen[id], dealer: seat === 0, riichi: hand.lizhi, isHuman: id === 0,
        hand: id === 0 ? handTiles(hand) : [], concealedCount: hand._bingpai._ + parseTiles(hand.toString()).length,
        discards: board.he[seat]._pai.map((tile: string) => ({ tile: tile.slice(0, 2), riichi: tile.includes('*'), called: /[+=-]$/.test(tile), tsumogiri: tile.includes('_') })),
        melds: hand._fulou.map((meld: string, index: number) => meldView(meld, `${id}-meld-${index}`)),
        ...(revealed && id !== 0 ? { revealedHand: parseTiles(hand.toString()) } : {}),
      };
    });
    const human = this.players[0];
    const actions: LegalAction[] = this.pending ? this.pending.choices.map(({ key: _key, reply: _reply, ...choice }) => choice) : [];
    if (this.paused) actions.push({ id: `${this.generation}:${this.step}:next`, type: 'next', label: this.options.matchLength === 'single' ? '查看最终排名' : '继续下一局' });
    const ownDiscard = actions.some(action => action.type === 'discard');
    const shanten = Majiang.Util.xiangting(human.shoupai);
    this.snapshot = {
      status: this.finished ? 'matchEnd' : this.paused ? 'roundEnd' : 'playing',
      phase: this.paused || this.finished ? 'settlement' : ownDiscard ? 'discard' : actions.length ? 'response' : 'waiting',
      seed: this.options.seed, mode: 'riichi', modeName: '四人立直', playerCount: 4, handSize: 13, scoreUnit: '点', difficulty: this.options.difficulty, players,
      round: { wind: WINDS[board.zhuangfeng], hand: board.jushu + 1, honba: publicModel.changbang, riichiSticks: this.finished ? 0 : publicModel.lizhibang, tilesLeft: board.shan.paishu, doraIndicators: [...board.shan.baopai], uraIndicators: this.paused && board.shan.fubaopai ? [...board.shan.fubaopai] : [], dealer: board.player_id[0] },
      turn: board.lunban < 0 ? board.player_id[0] : board.player_id[board.lunban], humanId: 0, actions,
      message: this.finished ? '对局结束，可以再开一局。' : this.paused ? this.result?.title || '本局结束' : ownDiscard ? '轮到你了 · 选择一张手牌打出' : actions.length ? '可以鸣牌或和牌 · 请选择操作' : `${NAMES[board.player_id[Math.max(0, board.lunban)]]}正在思考…`,
      log: [...this.log], result: this.paused || this.finished ? this.result ? structuredClone(this.result) : null : null,
      ...(this.latestWin ? { latestWin: structuredClone(this.latestWin) } : {}),
      ...(this.ronNotice ? { ronNotice: structuredClone(this.ronNotice) } : {}),
      autoPlay: this.options.autoPlay, autoPlayDifficulty: this.options.autoPlayDifficulty, autoExchangeThree: this.options.autoExchangeThree, quickControls: { ...this.quickControls }, speed: this.options.speed, revision: ++this.revision, shanten: Number.isFinite(shanten) ? shanten : null,
      waits: shanten === 0 && !human.shoupai._zimo ? [...(Majiang.Util.tingpai(human.shoupai) || [])] : [],
    };
    if (this.options.matchLength === 'endless') this.snapshot.round.sequence = this.handSequence;
    this.snapshot.riichiAssist = this.calculateAssist(projectRiichiAssist(this.snapshot), this.missedWin.getState());
    if (this.replayFrames) {
      const hands: Record<number, string[]> = {};
      this.game.model.player_id.forEach((id: number, seat: number) => { hands[id] = parseTiles(this.game.model.shoupai[seat].toString()); });
      appendReplayFrame(this.replayFrames, this.snapshot, hands, this.paused ? this.result?.title : this.finished ? '最终排名' : this.replayLabel || undefined);
    }
    if (this.replaying) return;
    for (const listener of this.listeners) listener();
  }
  getSavedGame(): SavedGame { return { version: 1, mode: 'riichi', seed: this.options.seed, matchLength: this.options.matchLength, difficulty: this.options.difficulty, startPoints: this.rule['配給原点'], autoPlayDifficulty: this.options.autoPlayDifficulty, autoExchangeThree: this.options.autoExchangeThree, aiVersion: this.aiVersion, replayPosition: this.step, decisions: this.decisions.map(decision => ({ ...decision })),
    ...(this.aiVersion>=7?{botDecisions:this.botDecisions.map(decision=>({...decision})).sort((a,b)=>a.step-b.step||a.playerId-b.playerId||a.sequence-b.sequence),aiModel:{...TANYAO_MODEL_IDENTITY}}:{}),
    ...(this.checkpoint ? { checkpoint: structuredClone(this.checkpoint) } : {}) }; }
  exportReplay(): ReplayData {
    // A live export omits the core log because it contains opponents' unexposed hands and wall draws.
    return { ...this.getSavedGame(), rules: structuredClone(this.rule), log: this.finished ? structuredClone(this.game._paipu) : [...this.log] };
  }
  loadSavedGame(data: SavedGame): boolean {
    if (!data || data.version !== 1 || (data.mode != null && data.mode !== 'riichi') || (data.difficulty != null && !validDifficulty(data.difficulty)) || (data.aiVersion != null && ![1, 2, 3, 4, 5, 6, AI_VERSION].includes(data.aiVersion)) || typeof data.seed !== 'string' || !['single', 'east', 'hanchan', 'endless'].includes(data.matchLength) || !Array.isArray(data.decisions) || data.decisions.length > 10000 || !data.decisions.every(decision => decision && typeof decision.key === 'string')) return false;
    try { validateReplayData(data); } catch { return false; }
    const previous = this.getSavedGame();
    const restore = (save: SavedGame): boolean => {
      this.replaying = true;
      this.aiVersion = save.aiVersion ?? 1;
      this.replayBotChoices = new Map((save.botDecisions || []).map(decision => [`${decision.step}:${decision.playerId}:${decision.sequence}`, decision]));
      this.initialize({ seed: save.seed, matchLength: save.matchLength, difficulty: save.difficulty || 'standard', autoPlayDifficulty: save.autoPlayDifficulty ?? 'expert', autoExchangeThree: save.autoExchangeThree ?? false, autoPlay: false, quickControls: DEFAULT_QUICK_CONTROLS }, save.checkpoint);
      let cursor = 0;
      for (let limit = 0; limit < 100000; limit++) {
        if (save.replayPosition != null && this.step >= save.replayPosition && cursor === save.decisions.length) break;
        if (save.replayPosition != null && this.step > save.replayPosition) return false;
        if (this.finished) break;
        if (this.paused) {
          if (cursor >= save.decisions.length) break;
          if (save.decisions[cursor++].key !== 'next') return false;
          this.paused = false;
          this.decisions.push({ key: 'next' });
          const next = this.continueRound;
          this.continueRound = null;
          this.step++;
          next?.();
        } else if (this.pending) {
          if (cursor >= save.decisions.length) break;
          const key = save.decisions[cursor++].key;
          const choice = this.pending.choices.find(item => item.key === key);
          if (!choice) return false;
          this.choosePending(choice);
        } else if (this.deferredBots.length) break;
        else this.advance();
      }
      return cursor === save.decisions.length && (save.replayPosition == null || this.step === save.replayPosition)
        && (this.aiVersion < 7 || this.botDecisions.length === (save.botDecisions || []).length);
    };
    let succeeded = false;
    try { succeeded = restore(data); } catch { succeeded = false; }
    if (!succeeded) {
      try { restore(previous); } catch { this.newGame({ autoPlay: false }); }
    }
    this.replaying = false;
    this.replayBotChoices.clear();
    const deferred = this.deferredBots; this.deferredBots = [];
    for (const resume of deferred) queueMicrotask(resume);
    this.publish();
    this.schedule();
    return succeeded;
  }
  /** Used only on a disposable, isolated session by buildReplayFrames. */
  async captureReplayFrames(data: SavedGame): Promise<ReplayFrame[]> {
    validateReplayData(data);
    this.cancelTimer(); this.botService.cancel(); this.autoPlayService.cancel(); this.autoPlayRequestVersion++; this.botJobs = 0;
    this.replaying = true; this.replayFrames = []; this.aiVersion = data.aiVersion ?? 1;
    this.replayBotChoices = new Map((data.botDecisions || []).map(decision => [`${decision.step}:${decision.playerId}:${decision.sequence}`, decision]));
    this.initialize({ seed: data.seed, matchLength: data.matchLength, difficulty: data.difficulty || 'standard', autoPlayDifficulty: data.autoPlayDifficulty ?? 'expert', autoExchangeThree: data.autoExchangeThree ?? false, autoPlay: false, speed: 0, quickControls: DEFAULT_QUICK_CONTROLS }, data.checkpoint);
    let cursor = 0;
    for (let guard = 0; guard < MAX_REPLAY_STEPS; guard++) {
      const exactEnd = data.replayPosition != null;
      if (exactEnd && this.step > data.replayPosition!) throw new Error('牌谱结束位置与操作记录不一致。');
      if (cursor === data.decisions.length && (!exactEnd || this.step === data.replayPosition)) break;
      if (this.finished) break;
      if (this.paused) {
        if (cursor >= data.decisions.length || data.decisions[cursor++].key !== 'next') throw new Error('牌谱缺少继续下一局的操作。');
        this.paused = false; this.decisions.push({ key: 'next' });
        const next = this.continueRound; this.continueRound = null; this.step++; next?.(); this.publish();
      } else if (this.pending) {
        if (cursor >= data.decisions.length) throw new Error('牌谱在等待玩家操作处提前结束。');
        const key = data.decisions[cursor++].key;
        const choice = this.pending.choices.find(item => item.key === key);
        if (!choice) throw new Error('牌谱包含当前规则不允许的操作。');
        this.choosePending(choice);
        // Legacy files have no precise progress marker. Commit only their final
        // explicit action; a final pass must not invent a subsequent draw.
        if (!exactEnd && cursor === data.decisions.length && choice.type !== 'pass') this.advance();
      } else if (this.deferredBots.length) throw new Error('牌谱缺少当前电脑操作。');
      else this.advance();
      if (guard % 48 === 47) await yieldReplayWork();
    }
    if (cursor !== data.decisions.length || (data.replayPosition != null && this.step !== data.replayPosition)
      || this.aiVersion >= 7 && this.botDecisions.length !== (data.botDecisions || []).length) throw new Error('牌谱未能在记录的位置结束，可能已损坏或超限。');
    return finishReplayFrames(this.replayFrames);
  }
  dispose(): void { this.disposed = true; this.generation++; this.autoPlayRequestVersion++; this.cancelTimer(); this.listeners.clear(); this.pending = null; this.botService.cancel(); this.autoPlayService.cancel(); this.tanyaoService.dispose(); this.deferredBots = []; this.botJobs = 0; }
}

export function createSession(options: SessionOptions = {}): RiichiSessionAPI { return new RiichiSession(options); }
