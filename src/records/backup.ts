import { MODES } from '../game/catalog';
import { validateReplayData } from '../game/replaySupport';
import type { SavedGame } from '../game/types';
import { validSichuanOptions } from '../game/variants/sichuan';
import { exportRecordStorage, pauseRecordPersistence, validateSavedGame } from './store';

export const FULL_BACKUP_KEYS = {
  savedGame: 'jakukyo.saved.v1',
  preferences: 'jakukyo.preferences.v2',
  legacyPreferences: 'jakukyo.preferences.v1',
  records: 'jakukyo.records.v1',
} as const;

const STORAGE_KEYS = Object.values(FULL_BACKUP_KEYS);
export const MAX_FULL_BACKUP_BYTES = 25 * 1024 * 1024;
type BackupKey = typeof STORAGE_KEYS[number];
type BackupValues = Record<BackupKey, string | null>;
export type BackupStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface FullBackup {
  format: 'jakukyo-backup';
  formatVersion: 1;
  createdAt: string;
  data: BackupValues;
}

export interface FullBackupSummary {
  createdAt: string;
  recordCount: number;
  favoriteCount: number;
  historyCount: number;
  settledHands: number;
  hasCurrentGame: boolean;
  hasPreferences: boolean;
}

export interface ParsedFullBackup { backup: FullBackup; summary: FullBackupSummary }
export interface BackupOverrides { savedGame?: SavedGame | null; preferences?: unknown }

export class FullBackupRestoreError extends Error {
  constructor(message: string, readonly persistencePaused: boolean, readonly recoveryBackupText?: string) {
    super(message);
    this.name = 'FullBackupRestoreError';
  }
}

function invalid(section: string): never { throw new Error('备份中的' + section + '格式无效。'); }
function requireValue(condition: unknown, section: string): asserts condition {
  if (!condition) invalid(section);
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonnegative = (value: unknown): value is number => number(value) && value >= 0;
const integer = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && Number(value) >= minimum;
const text = (value: unknown): value is string => typeof value === 'string';
const date = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value));
const mode = (value: unknown) => MODES.some(entry => entry.id === value);
const tile = (value: unknown): value is string => text(value) && /^(?:[mps][0-9]|z[1-7]|f[1-8])$/.test(value);
const tiles = (value: unknown): value is string[] => Array.isArray(value) && value.every(tile);
const numbers = (value: unknown, count: number) => Array.isArray(value) && value.length === count && value.every(number);
const playerId = (value: unknown, count: number): value is number => integer(value) && value < count;
const ranks = (value: unknown, count: number) => Array.isArray(value) && value.length === count && value.every(rank => integer(rank, 1) && rank <= count);

function json(raw: string, section: string): unknown {
  try { return JSON.parse(raw); } catch { return invalid(section); }
}

function validateSave(value: unknown): void {
  const save = validateSavedGame(value);
  validateReplayData(save);
}

function validatePreferences(value: unknown): void {
  requireValue(object(value), '设置');
  const booleans = ['sound', 'bgm', 'autoSort', 'riichiHints', 'autoExchangeThree', 'winEffects', 'exchangeThree'];
  const volumes = ['musicVolume', 'masterVolume', 'effectsVolume', 'ambienceVolume'];
  for (const key of booleans) requireValue(value[key] === undefined || typeof value[key] === 'boolean', '设置');
  for (const key of volumes) requireValue(value[key] === undefined || number(value[key]) && value[key] >= 0 && value[key] <= 1, '音量设置');
  requireValue(value.speed === undefined || nonnegative(value.speed), '出牌速度');
  requireValue(value.mode === undefined || mode(value.mode), '玩法设置');
  requireValue(value.theme === undefined || ['jade', 'sakura', 'midnight', 'contrast'].includes(String(value.theme)), '主题设置');
  requireValue(value.matchLength === undefined || ['single', 'east', 'hanchan', 'endless'].includes(String(value.matchLength)), '对局长度');
  for (const key of ['difficulty', 'autoPlayDifficulty']) requireValue(value[key] === undefined || ['novice', 'standard', 'advanced', 'expert'].includes(String(value[key])), '电脑难度');
  if (value.quickControls !== undefined) {
    requireValue(object(value.quickControls), '快捷操作');
    for (const key of ['autoWin', 'autoDiscard', 'noCall']) requireValue(value.quickControls[key] === undefined || typeof value.quickControls[key] === 'boolean', '快捷操作');
  }
  requireValue(value.sichuan === undefined || validSichuanOptions(value.sichuan), '四川桌规');
}

function validateMeld(value: unknown, count: number): void {
  requireValue(object(value) && text(value.id) && ['chi', 'pon', 'kan'].includes(String(value.type)), '副露');
  requireValue(typeof value.concealed === 'boolean' && tiles(value.tiles), '副露');
  requireValue(value.tiles.length === (value.type === 'kan' ? 4 : 3), '副露');
  requireValue(value.from === undefined || playerId(value.from, count), '副露来源');
}

function validateWinner(value: unknown, count: number): void {
  requireValue(object(value) && playerId(value.playerId, count), '和牌者');
  requireValue(value.fromId === undefined || playerId(value.fromId, count), '放铳者');
  for (const key of ['fu', 'han', 'points', 'yakuman']) requireValue(nonnegative(value[key]), '和牌计分');
  requireValue(tiles(value.hand) && (value.winningTile === undefined || tile(value.winningTile)), '和牌手牌');
  requireValue(Array.isArray(value.yaku) && value.yaku.every(item => object(item) && text(item.name) && (text(item.han) || nonnegative(item.han))), '番种');
  if (value.melds !== undefined) {
    requireValue(Array.isArray(value.melds), '和牌副露');
    value.melds.forEach(meld => validateMeld(meld, count));
  }
  requireValue(value.payments === undefined || numbers(value.payments, count), '支付明细');
  if (value.sichuanScore !== undefined) {
    const score = value.sichuanScore;
    requireValue(object(score) && [3, 4, 5, 6, 8, 'none'].includes(score.fanCap as number | string), '四川计分');
    requireValue(nonnegative(score.effectiveFan) && number(score.multiplier) && score.multiplier > 0 && nonnegative(score.selfDrawBonus), '四川计分');
  }
}

function validateRound(value: unknown, count: number): void {
  requireValue(object(value) && text(value.key) && integer(value.actionIndex), '牌局记录');
  const round = value.round;
  requireValue(object(round) && text(round.wind) && integer(round.hand, 1) && integer(round.honba), '局况');
  requireValue(integer(round.riichiSticks) && integer(round.tilesLeft) && playerId(round.dealer, count), '局况');
  requireValue(round.sequence === undefined || integer(round.sequence, 1), '局序');
  requireValue(tiles(round.doraIndicators) && tiles(round.uraIndicators), '指示牌');
  requireValue(round.wildcard === undefined || tile(round.wildcard), '百搭');
  const result = value.result;
  requireValue(object(result) && ['win', 'draw', 'abort', 'match'].includes(String(result.kind)) && text(result.title) && text(result.description), '结算');
  requireValue(numbers(result.deltas, count) && numbers(result.scores, count), '结算分数');
  requireValue(result.ranks === undefined || ranks(result.ranks, count), '结算名次');
  requireValue(result.tenpai === undefined || Array.isArray(result.tenpai) && result.tenpai.length === count && result.tenpai.every(item => typeof item === 'boolean'), '流局听牌');
  requireValue(Array.isArray(result.winners), '和牌记录');
  result.winners.forEach(winner => validateWinner(winner, count));
  requireValue(Array.isArray(value.players) && value.players.length === count, '座位记录');
  const ids = new Set<number>();
  for (const player of value.players) {
    requireValue(object(player) && playerId(player.id, count) && text(player.name), '座位记录');
    requireValue(typeof player.riichi === 'boolean' && typeof player.openMeld === 'boolean' && !ids.has(player.id), '座位记录');
    ids.add(player.id);
  }
}

function validateHistoryHand(value: unknown): void {
  requireValue(object(value) && text(value.key), '战绩牌局');
  for (const key of ['won', 'dealIn', 'riichi', 'openMeld']) requireValue(typeof value[key] === 'boolean', '战绩牌局');
  for (const key of ['winEvents', 'dealInEvents', 'winPointSum', 'pricedWins']) requireValue(nonnegative(value[key]), '战绩统计');
}

function validateLibrary(value: unknown): void {
  requireValue(object(value) && value.version === 1 && Array.isArray(value.records) && value.records.length <= 551, '牌谱库');
  const recordIds = new Set<string>();
  for (const record of value.records) {
    requireValue(object(record) && text(record.id) && !!record.id && !recordIds.has(record.id), '牌谱身份');
    recordIds.add(record.id);
    requireValue(text(record.title) && date(record.createdAt) && date(record.updatedAt), '牌谱资料');
    requireValue(record.completedAt === undefined || date(record.completedAt), '完成时间');
    requireValue(['played', 'imported'].includes(String(record.source)) && typeof record.favorite === 'boolean' && typeof record.completed === 'boolean', '牌谱资料');
    requireValue(mode(record.mode) && record.playerCount === (record.mode === 'sanma' ? 3 : 4) && ['点', '分', '台'].includes(String(record.scoreUnit)), '牌谱玩法');
    validateSave(record.save);
    requireValue(object(record.save) && (record.save.mode ?? 'riichi') === record.mode, '牌谱玩法');
    requireValue(Array.isArray(record.rounds) && record.rounds.length <= 500, '牌局记录');
    record.rounds.forEach(round => validateRound(round, record.playerCount as number));
    requireValue(record.finalScores === undefined || numbers(record.finalScores, record.playerCount as number), '最终分数');
    requireValue(record.finalRanks === undefined || ranks(record.finalRanks, record.playerCount as number), '最终名次');
  }
  if (value.resumeSession !== undefined) requireValue(object(value.resumeSession) && text(value.resumeSession.id) && text(value.resumeSession.config), '续局身份');
  if (value.history === undefined) return;
  requireValue(Array.isArray(value.history), '累计战绩');
  const historyIds = new Set<string>();
  for (const history of value.history) {
    requireValue(object(history) && text(history.id) && !historyIds.has(history.id), '战绩身份');
    historyIds.add(history.id);
    const count = history.mode === 'sanma' ? 3 : 4;
    requireValue(mode(history.mode) && history.playerCount === count && ['点', '分', '台'].includes(String(history.scoreUnit)) && typeof history.completed === 'boolean', '战绩资料');
    requireValue(history.finalRanks === undefined || ranks(history.finalRanks, count), '战绩名次');
    requireValue(Array.isArray(history.hands), '战绩牌局');
    history.hands.forEach(validateHistoryHand);
    if (history.endless !== undefined) {
      const endless = history.endless;
      requireValue(object(endless) && integer(endless.through, 1) && object(endless.totals) && history.hands.length === 0, '无限战绩');
      validateHistoryHand(endless.lastHand);
      for (const key of ['settledHands', 'wonHands', 'dealInHands', 'winEvents', 'dealInEvents', 'riichiHands', 'openMeldHands', 'winPointSum', 'pricedWins']) requireValue(nonnegative(endless.totals[key]), '无限战绩');
    }
  }
}

function validateValues(values: BackupValues): void {
  if (values[FULL_BACKUP_KEYS.savedGame] !== null) validateSave(json(values[FULL_BACKUP_KEYS.savedGame]!, '当前存档'));
  for (const key of [FULL_BACKUP_KEYS.preferences, FULL_BACKUP_KEYS.legacyPreferences]) {
    if (values[key] !== null) validatePreferences(json(values[key]!, '设置'));
  }
  if (values[FULL_BACKUP_KEYS.records] !== null) validateLibrary(json(values[FULL_BACKUP_KEYS.records]!, '牌谱库'));
}

function browserStorage(): BackupStorage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* The caller receives a visible error without modifying any data. */ }
  throw new Error('浏览器无法使用本地数据，请在支持本地存储的环境中打开游戏。');
}

function readValues(storage: BackupStorage): BackupValues {
  const result = {} as BackupValues;
  for (const key of STORAGE_KEYS) result[key] = storage.getItem(key);
  return result;
}

function documentFor(data: BackupValues): FullBackup {
  return { format: 'jakukyo-backup', formatVersion: 1, createdAt: new Date().toISOString(), data };
}

export function exportFullBackup(overrides: BackupOverrides = {}, storage?: BackupStorage): string {
  const source = storage ?? browserStorage();
  const data = readValues(source);
  if (storage === undefined) {
    // A full disk must not prevent exporting newer records that remain in memory.
    if (data[FULL_BACKUP_KEYS.records] !== null) validateLibrary(json(data[FULL_BACKUP_KEYS.records]!, '牌谱库'));
    data[FULL_BACKUP_KEYS.records] = exportRecordStorage();
  }
  if (overrides.savedGame !== undefined) data[FULL_BACKUP_KEYS.savedGame] = overrides.savedGame === null ? null : JSON.stringify(overrides.savedGame);
  if (overrides.preferences !== undefined) data[FULL_BACKUP_KEYS.preferences] = typeof overrides.preferences === 'string' ? overrides.preferences : JSON.stringify(overrides.preferences);
  validateValues(data);
  const result = JSON.stringify(documentFor(data), null, 2);
  if (new TextEncoder().encode(result).byteLength > MAX_FULL_BACKUP_BYTES) throw new Error('完整备份超过25 MB，请先整理需要保留的牌谱。');
  return result;
}

export function parseFullBackup(textValue: string): ParsedFullBackup {
  if (new TextEncoder().encode(textValue).byteLength > MAX_FULL_BACKUP_BYTES) throw new Error('完整备份超过25 MB。');
  const value = json(textValue, '文件');
  requireValue(object(value) && value.format === 'jakukyo-backup', '文件类型');
  requireValue(value.formatVersion === 1, '文件版本');
  requireValue(date(value.createdAt) && object(value.data), '备份资料');
  const rawData = value.data;
  requireValue(Object.keys(rawData).length === STORAGE_KEYS.length && STORAGE_KEYS.every(key => Object.hasOwn(rawData, key)), '数据范围');
  const data = {} as BackupValues;
  for (const key of STORAGE_KEYS) {
    const item = rawData[key];
    requireValue(item === null || typeof item === 'string', '数据内容');
    data[key] = item;
  }
  validateValues(data);
  const library = data[FULL_BACKUP_KEYS.records] === null ? undefined : json(data[FULL_BACKUP_KEYS.records]!, '牌谱库') as Record<string, unknown>;
  const records = (library?.records ?? []) as Array<Record<string, unknown>>;
  const history = library?.history as Array<Record<string, unknown>> | undefined;
  const settledHands = history
    ? history.reduce((sum, entry) => sum + (object(entry.endless) && object(entry.endless.totals) ? Number(entry.endless.totals.settledHands) : (entry.hands as unknown[]).length), 0)
    : records.filter(record => record.source === 'played').reduce((sum, record) => sum + (record.rounds as unknown[]).length, 0);
  return {
    backup: { format: 'jakukyo-backup', formatVersion: 1, createdAt: value.createdAt, data },
    summary: { createdAt: value.createdAt, recordCount: records.length, favoriteCount: records.filter(record => record.favorite).length,
      historyCount: history?.length ?? records.filter(record => record.source === 'played').length, settledHands,
      hasCurrentGame: data[FULL_BACKUP_KEYS.savedGame] !== null,
      hasPreferences: data[FULL_BACKUP_KEYS.preferences] !== null || data[FULL_BACKUP_KEYS.legacyPreferences] !== null },
  };
}

function writeValues(storage: BackupStorage, values: BackupValues): void {
  for (const key of STORAGE_KEYS) {
    const value = values[key];
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  }
}

function matches(storage: BackupStorage, values: BackupValues): boolean {
  return STORAGE_KEYS.every(key => storage.getItem(key) === values[key]);
}

export function restoreFullBackup(backup: FullBackup, storage?: BackupStorage, pausePersistence: () => () => void = pauseRecordPersistence): void {
  const validated = parseFullBackup(JSON.stringify(backup)).backup;
  const target = storage ?? browserStorage();
  const original = readValues(target);
  const resumePersistence = pausePersistence();
  try {
    writeValues(target, validated.data);
    if (!matches(target, validated.data)) throw new Error('恢复后的数据校验失败。');
  } catch {
    try {
      // Releasing the replaced keys first also handles quota failures during rollback.
      for (const key of STORAGE_KEYS) target.removeItem(key);
      writeValues(target, original);
      if (!matches(target, original)) throw new Error('原数据回滚校验失败。');
    } catch {
      throw new FullBackupRestoreError('恢复和回滚均未完成。请下载恢复副本并保留当前页面。', true, JSON.stringify(documentFor(original), null, 2));
    }
    resumePersistence();
    throw new FullBackupRestoreError('恢复未完成，原数据已还原，可以继续当前对局。', false);
  }
  // The old store stays suspended until the caller reloads the restored application.
}
