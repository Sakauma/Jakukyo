import type { GameSnapshot, ModeId, SavedGame } from '../game/types';
import { validateBotReplay } from '../game/replaySupport';
import { MODES, getMode } from '../game/catalog';
import { restoredStartPoints, validStartPoints } from '../game/startingPoints';
import { validEndlessCheckpoint } from '../game/endlessCheckpoint';
import { normalizeSichuanOptions, validSichuanOptions } from '../game/variants/sichuan';
import type { GameRecord, PlayedHistory, RecordedRound } from './types';
import { mergeEndlessHistory, mergeHistory, stableRoundKey, summarizeRecord } from './summary';
export type { GameRecord, PlayedHistory, RecordedRound, StatisticsGroup } from './types';

const STORAGE_KEY = 'jakukyo.records.v1';
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_RECORDS = 500;
const KEEP_RECENT = 50;
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isoNow = () => new Date().toISOString();
const uid = () => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const validHistoryHand = (value: unknown): boolean => {
  if (!object(value) || typeof value.key !== 'string') return false;
  return ['won', 'dealIn', 'riichi', 'openMeld'].every(key => typeof value[key] === 'boolean')
    && ['winEvents', 'dealInEvents', 'winPointSum', 'pricedWins'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]) && (value[key] as number) >= 0);
};
const validEndlessHistory = (value: unknown): boolean => {
  if (!object(value) || !Number.isSafeInteger(value.through) || Number(value.through) < 1 || !object(value.totals) || !validHistoryHand(value.lastHand)) return false;
  const totals = value.totals;
  return ['settledHands', 'wonHands', 'dealInHands', 'winEvents', 'dealInEvents', 'riichiHands', 'openMeldHands', 'winPointSum', 'pricedWins']
    .every(key => typeof totals[key] === 'number' && Number.isFinite(totals[key]) && (totals[key] as number) >= 0);
};
const position = (save: SavedGame) => (save as SavedGame & { replayPosition?: number }).replayPosition ?? save.decisions.length;
const configKey = (save: SavedGame) => {
  const parts = [save.mode ?? 'riichi', save.seed, save.matchLength, save.difficulty ?? 'standard', save.aiVersion ?? (save.mode == null || save.mode === 'riichi' ? 1 : 2), save.variantOptions?.exchangeThree ?? false, save.variantOptions?.minimumFan ?? null];
  const starting = restoredStartPoints(save);
  // Keep historical resumeSession identities, including deleted old replays.
  if (starting !== restoredStartPoints({ mode: save.mode })) parts.push(starting);
  // Historical saves and their equivalent explicit v1 share the old key.
  if (save.variantOptions?.sichuan !== undefined) {
    const rules = normalizeSichuanOptions(save.variantOptions.sichuan);
    if (rules.version !== 1) parts.push('sichuan', rules.version, rules.fanCap, rules.selfDraw, rules.menqingZhongzhang);
  }
  if (save.mode !== 'riichi' && save.mode != null && save.rulesVersion === 2) parts.push('rules', 2);
  if ((save.aiVersion ?? 0) >= 7 && save.aiModel) parts.push('model', save.aiModel.id, save.aiModel.sha256,
    save.aiModel.featureVersion, save.aiModel.policyVersion);
  if (save.matchLength === 'endless' && save.checkpoint) {
    const cp = save.checkpoint;
    parts.push('checkpoint', cp.sessionId, cp.sequence, cp.dealer, cp.rotation, cp.honba, cp.sticks, ...cp.points);
  }
  return JSON.stringify(parts);
};
/** Older regional games used the same engine version before recording it explicitly. */
function migrateResumeConfig(config: string): string {
  try {
    const parts: unknown = JSON.parse(config);
    if (Array.isArray(parts) && parts.length >= 7 && parts[0] !== 'riichi'
      && MODES.some(mode => mode.id === parts[0]) && parts[4] === 1) {
      parts[4] = 2;
      return JSON.stringify(parts);
    }
  } catch { /* Preserve an unrecognized historical identity. */ }
  return config;
}
const endlessHandId = (save: SavedGame) => save.matchLength === 'endless' && save.checkpoint
  ? `endless-hand:${JSON.stringify([save.checkpoint.sessionId, save.checkpoint.sequence])}` : undefined;
const endlessHistoryId = (sessionId: string) => `endless-history:${JSON.stringify(sessionId)}`;
function matchingBotDecisions(a: SavedGame, b: SavedGame, exact = false): boolean {
  if ((a.aiVersion ?? 0) < 7) return true;
  const left = a.botDecisions || [], right = b.botDecisions || [];
  if (exact && left.length !== right.length) return false;
  const recorded = new Map(right.map(decision => [`${decision.step}:${decision.playerId}:${decision.sequence}`, decision]));
  return left.every(decision => {
    const other = recorded.get(`${decision.step}:${decision.playerId}:${decision.sequence}`);
    return other ? decision.key === other.key && decision.source === other.source : !exact;
  });
}
const prefixMatches = (a: SavedGame, b: SavedGame) => configKey(a) === configKey(b)
  && a.decisions.slice(0, Math.min(a.decisions.length, b.decisions.length)).every((decision, index) => decision.key === b.decisions[index].key)
  && matchingBotDecisions(a, b);
const exactSave = (a: SavedGame, b: SavedGame) => prefixMatches(a, b) && a.decisions.length === b.decisions.length
  && position(a) === position(b) && matchingBotDecisions(a, b, true);

function safeStorage(): StoragePort | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** Accept only this project's plain replay data, including the legacy 0.2.x shape. */
export function validateSavedGame(value: unknown): SavedGame {
  if (!object(value) || value.version !== 1) throw new Error('不是支持的雀境牌谱版本。当前可导入版本 1 的牌谱。');
  if (typeof value.seed !== 'string' || value.seed.length > 512 || !['single', 'east', 'hanchan', 'endless'].includes(String(value.matchLength))) throw new Error('牌谱的随机种子或对局长度不完整。');
  if (value.mode != null && !MODES.some(mode => mode.id === value.mode)) throw new Error('牌谱使用了当前版本不支持的玩法。');
  if (value.startPoints !== undefined && !validStartPoints(value.mode as ModeId | undefined, value.startPoints)) throw new Error('牌谱的初始分与当前玩法不兼容。');
  if (value.difficulty != null && !['novice', 'standard', 'advanced', 'expert'].includes(String(value.difficulty))) throw new Error('牌谱的电脑难度无效。');
  if (value.autoPlayDifficulty !== undefined && (typeof value.autoPlayDifficulty !== 'string' || !['novice', 'standard', 'advanced', 'expert'].includes(value.autoPlayDifficulty))) throw new Error('牌谱的托管难度无效。');
  if (value.autoPlayMatchDifficulty !== undefined && typeof value.autoPlayMatchDifficulty !== 'boolean') throw new Error('牌谱的托管跟随设置无效。');
  if (value.autoExchangeThree !== undefined && typeof value.autoExchangeThree !== 'boolean') throw new Error('牌谱的托管换三张设置无效。');
  if (value.rulesVersion !== undefined && value.rulesVersion !== 1 && value.rulesVersion !== 2) throw new Error('牌谱的规则版本无效。');
  if (value.aiVersion != null && (!Number.isInteger(value.aiVersion) || Number(value.aiVersion) < 1 || Number(value.aiVersion) > 100)) throw new Error('牌谱的电脑版本无效。');
  if (!Array.isArray(value.decisions) || value.decisions.length > 10000 || !value.decisions.every(decision => object(decision) && typeof decision.key === 'string' && decision.key.length <= 1024)) throw new Error('牌谱操作记录不完整，或超过 10,000 条限制。');
  if (value.replayPosition != null && (!Number.isInteger(value.replayPosition) || Number(value.replayPosition) < 0 || Number(value.replayPosition) > 200000)) throw new Error('牌谱回放位置无效。');
  const save: SavedGame & { replayPosition?: number } = {
    version: 1, seed: value.seed, matchLength: value.matchLength as SavedGame['matchLength'],
    decisions: value.decisions.map(decision => ({ key: (decision as { key: string }).key })),
  };
  if (value.mode != null) save.mode = value.mode as ModeId;
  if (value.startPoints !== undefined) save.startPoints = Number(value.startPoints);
  if (value.difficulty != null) save.difficulty = value.difficulty as SavedGame['difficulty'];
  if (value.autoPlayDifficulty !== undefined) save.autoPlayDifficulty = value.autoPlayDifficulty as SavedGame['autoPlayDifficulty'];
  if (value.autoPlayMatchDifficulty !== undefined) save.autoPlayMatchDifficulty = value.autoPlayMatchDifficulty;
  if (value.autoExchangeThree !== undefined) save.autoExchangeThree = value.autoExchangeThree as boolean;
  if (value.aiVersion != null) save.aiVersion = Number(value.aiVersion);
  if (value.rulesVersion !== undefined) save.rulesVersion = value.rulesVersion;
  if (value.replayPosition != null) save.replayPosition = Number(value.replayPosition);
  if ((save.aiVersion ?? 0) >= 7) {
    save.botDecisions = value.botDecisions as SavedGame['botDecisions'];
    save.aiModel = value.aiModel as SavedGame['aiModel'];
    validateBotReplay(save);
    save.botDecisions = save.botDecisions!.map(decision => ({ step: decision.step, playerId: decision.playerId,
      sequence: decision.sequence, key: decision.key, ...(decision.source ? { source: decision.source } : {}) }));
    if (save.aiModel) save.aiModel = { id: save.aiModel.id, sha256: save.aiModel.sha256,
      featureVersion: save.aiModel.featureVersion, policyVersion: save.aiModel.policyVersion };
  }
  if (value.matchLength === 'endless') {
    if (!validEndlessCheckpoint(value.checkpoint, save.mode)) throw new Error('无限牌谱缺少有效的单局起始信息。');
    const cp = value.checkpoint;
    save.checkpoint = { version: 1, sessionId: cp.sessionId, sequence: cp.sequence, points: [...cp.points],
      dealer: cp.dealer, rotation: cp.rotation, honba: cp.honba, sticks: cp.sticks };
  }
  if (value.variantOptions !== undefined && !object(value.variantOptions)) throw new Error('牌谱桌规配置无效。');
  if (object(value.variantOptions)) {
    save.variantOptions = {};
    if (typeof value.variantOptions.exchangeThree === 'boolean') save.variantOptions.exchangeThree = value.variantOptions.exchangeThree;
    if (typeof value.variantOptions.minimumFan === 'number' && Number.isFinite(value.variantOptions.minimumFan)) save.variantOptions.minimumFan = value.variantOptions.minimumFan;
    if (value.variantOptions.sichuan !== undefined) {
      if (!validSichuanOptions(value.variantOptions.sichuan)) throw new Error('牌谱的四川麻将桌规配置无效。');
      save.variantOptions.sichuan = { ...value.variantOptions.sichuan };
    }
  }
  return save;
}

function settledRound(snapshot: GameSnapshot, actionIndex: number, overrideKey?: string): RecordedRound | null {
  if (snapshot.status !== 'roundEnd' || !snapshot.result || snapshot.result.kind === 'match') return null;
  const key = overrideKey ?? stableRoundKey(snapshot.round);
  return { key, actionIndex, round: structuredClone(snapshot.round), result: structuredClone(snapshot.result),
    players: snapshot.players.map(player => ({ id: player.id, name: player.name, riichi: player.riichi, openMeld: player.melds.some(meld => !meld.concealed) })) };
}

function newRecord(save: SavedGame, source: GameRecord['source'], title?: string): GameRecord {
  const mode = save.mode ?? 'riichi', now = isoNow();
  const hand = save.matchLength === 'endless' && save.checkpoint ? ` · 第${save.checkpoint.sequence}局` : '';
  return { id: source === 'played' ? endlessHandId(save) ?? uid() : uid(), title: title?.trim().slice(0, 60) || `${getMode(mode).name}${hand} · ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}`,
    createdAt: now, updatedAt: now, source, favorite: false, mode, playerCount: mode === 'sanma' ? 3 : 4,
    scoreUnit: mode === 'riichi' || mode === 'sanma' ? '点' : '分', save: structuredClone(save), completed: false, rounds: [] };
}

/** Factory also permits an isolated in-memory verification without touching real saves. */
export function createRecordStore(storage: StoragePort | null = safeStorage()) {
  const records = new Map<string, GameRecord>(), history = new Map<string, PlayedHistory>(), active = new Set<string>(), listeners = new Set<() => void>();
  let visible: readonly GameRecord[] = [], error: string | null = null, timer: ReturnType<typeof setTimeout> | null = null, dirty = false;
  let persistencePauses = 0;
  let visibleHistory: readonly PlayedHistory[] = [];
  let resumeSession: { id: string; config: string } | undefined;
  const notify = () => { visible = [...records.values()].reverse().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); visibleHistory = [...history.values()]; for (const listener of listeners) listener(); };
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!object(parsed) || parsed.version !== 1 || !Array.isArray(parsed.records) || parsed.records.length > MAX_RECORDS + KEEP_RECENT + 1) throw new Error('格式无效');
      if (object(parsed.resumeSession) && typeof parsed.resumeSession.id === 'string' && typeof parsed.resumeSession.config === 'string') {
        const config = migrateResumeConfig(parsed.resumeSession.config);
        resumeSession = { id: parsed.resumeSession.id, config };
        dirty ||= config !== parsed.resumeSession.config;
      }
      for (const entry of parsed.records) {
        if (!object(entry) || typeof entry.id !== 'string' || typeof entry.title !== 'string' || !['played', 'imported'].includes(String(entry.source)) || !Array.isArray(entry.rounds)) continue;
        try {
          const save = validateSavedGame(entry.save);
          const record = { ...entry, save } as unknown as GameRecord;
          if (!Number.isInteger(record.playerCount) || record.playerCount < 3 || record.playerCount > 4 || typeof record.updatedAt !== 'string' || record.rounds.length > 500) continue;
          if (record.rounds.some(round => !round || typeof round.key !== 'string' || !round.result || !Array.isArray(round.result.winners) || !Array.isArray(round.players))) continue;
          record.rounds = [...new Map(record.rounds.map(round => { const normalized = { ...round, key: stableRoundKey(round.round) }; return [normalized.key, normalized] as const; })).values()];
          records.set(record.id, record);
        } catch { /* Keep other valid records in the library. */ }
      }
      if (Array.isArray(parsed.history)) {
        for (const entry of parsed.history) {
          if (!object(entry) || typeof entry.id !== 'string' || !MODES.some(mode => mode.id === entry.mode) || !Array.isArray(entry.hands) || !Number.isInteger(entry.playerCount)) continue;
          if (entry.hands.some(hand => !object(hand) || typeof hand.key !== 'string' || !Number.isFinite(hand.winEvents) || !Number.isFinite(hand.winPointSum))) continue;
          if (entry.endless !== undefined && (!validEndlessHistory(entry.endless) || entry.hands.length !== 0)) continue;
          history.set(entry.id, entry as unknown as PlayedHistory);
        }
      } else {
        // One-time migration: only existing local-play records can seed history.
        for (const record of records.values()) if (record.source === 'played') history.set(record.id, summarizeRecord(record));
        dirty = true;
      }
    }
  } catch { error = '本地牌谱库暂时无法读取；游戏和当前存档仍可使用。'; }
  notify();

  function prune() {
    const activeRecent = [...records.values()].filter(record => !record.favorite && active.has(record.id)).length;
    const recent = [...records.values()].reverse().filter(record => !record.favorite && !active.has(record.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const record of recent.slice(Math.max(0, KEEP_RECENT - activeRecent))) records.delete(record.id);
  }
  function flushRecords() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (persistencePauses > 0) return false;
    if (!dirty) return !!storage && !error;
    prune();
    if (storage) {
      try { storage.setItem(STORAGE_KEY, exportRecordStorage()); error = null; dirty = false; }
      catch { error = '牌谱未能写入本地空间，最新记录仍在本次运行的内存中。请先导出需要保留的牌谱，再清理空间。'; }
    } else { error = '此环境无法使用本地牌谱存储，记录仅保留到本次运行结束。'; }
    notify();
    return !!storage && !dirty && !error;
  }
  function changed(immediate = false) {
    dirty = true;
    if (persistencePauses > 0) return;
    if (immediate) flushRecords();
    else if (!timer) timer = setTimeout(flushRecords, 5000);
  }
  function exportRecordStorage(): string {
    return JSON.stringify({ version: 1, records: [...records.values()], history: [...history.values()], resumeSession });
  }
  function pauseRecordPersistence(): () => void {
    persistencePauses++;
    if (timer) { clearTimeout(timer); timer = null; }
    let resumed = false;
    return () => {
      if (resumed) return;
      resumed = true;
      persistencePauses--;
      if (persistencePauses === 0 && dirty && !timer) timer = setTimeout(flushRecords, 5000);
    };
  }
  function beginRecord(saved: SavedGame, options: { resume?: boolean } = {}) {
    const save = validateSavedGame(saved);
    const handId = endlessHandId(save);
    let record = handId ? records.get(handId) : options.resume ? [...records.values()].filter(item => item.source === 'played' && prefixMatches(item.save, save)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] : undefined;
    if (handId && record && (record.source !== 'played' || !prefixMatches(record.save, save))) throw new Error('无限对局当前牌谱与已保存的本局记录不一致。');
    if (!record) {
      record = newRecord(save, 'played');
      // A user may delete the replay while retaining the current game save. Keep
      // that same game identity so continuing it cannot count the hand twice.
      if (options.resume && resumeSession?.config === configKey(save)) record.id = resumeSession.id;
    }
    else {
      const rewound = position(save) < position(record.save);
      record = { ...record, save, updatedAt: isoNow(),
        ...(rewound ? { rounds: record.rounds.filter(round => round.actionIndex <= position(save)), completed: false, completedAt: undefined, finalRanks: undefined, finalScores: undefined } : {}) };
    }
    resumeSession = { id: record.id, config: configKey(save) };
    active.clear(); active.add(record.id); records.set(record.id, record); changed(true); return record.id;
  }
  function observeRecord(id: string, save: SavedGame, snapshot: GameSnapshot) {
    const old = records.get(id); if (!old || old.source !== 'played') return;
    if (old.save.matchLength === 'endless' || save.matchLength === 'endless') {
      if (!validEndlessCheckpoint(save.checkpoint, save.mode) || endlessHandId(save) !== id
        || configKey(old.save) !== configKey(save) || snapshot.round.sequence !== save.checkpoint.sequence) {
        throw new Error('无限对局牌谱与当前局不一致。');
      }
    }
    const record: GameRecord = { ...old, save: structuredClone(save), updatedAt: isoNow(), mode: snapshot.mode ?? 'riichi', playerCount: snapshot.players.length, scoreUnit: snapshot.scoreUnit ?? old.scoreUnit };
    const round = settledRound(snapshot, position(save));
    let important = false;
    if (round) {
      const index = record.rounds.findIndex(item => item.key === round.key);
      const existing = index >= 0 ? record.rounds[index] : undefined;
      if (!existing || JSON.stringify(existing.result) !== JSON.stringify(round.result)) {
        record.rounds = index < 0 ? [...record.rounds, round] : record.rounds.map((item, i) => i === index ? round : item); important = true;
      }
    }
    if (snapshot.status === 'matchEnd' && snapshot.result?.kind === 'match') {
      important ||= !old.completed;
      record.completed = true; record.completedAt = old.completedAt ?? isoNow();
      record.finalScores = [...snapshot.result.scores]; record.finalRanks = snapshot.result.ranks ? [...snapshot.result.ranks] : undefined;
    }
    if (important) {
      if (save.matchLength === 'endless' && save.checkpoint) {
        const historyId = endlessHistoryId(save.checkpoint.sessionId);
        const summary = { ...summarizeRecord(record), id: historyId };
        history.set(historyId, mergeEndlessHistory(history.get(historyId), summary, save.checkpoint.sequence));
      } else history.set(id, mergeHistory(history.get(id), summarizeRecord(record)));
    }
    records.set(id, record); changed(important);
  }
  const requireRecord = (id: string) => { const record = records.get(id); if (!record) throw new Error('这份牌谱已不在本地库中。'); return record; };
  function renameRecord(id: string, name: string) { const title = name.trim().slice(0, 60); if (!title) throw new Error('名称不能为空。'); records.set(id, { ...requireRecord(id), title }); changed(true); }
  function toggleFavorite(id: string) {
    const record = requireRecord(id);
    if (!record.favorite && [...records.values()].filter(item => item.favorite).length >= MAX_RECORDS) throw new Error('最多收藏 500 场，请先取消一份收藏或导出备份。');
    records.set(id, { ...record, favorite: !record.favorite }); changed(true);
  }
  function deleteRecord(id: string) { if (active.has(id)) active.delete(id); records.delete(id); changed(true); }
  function exportRecordJson(id: string) {
    const record = requireRecord(id);
    return JSON.stringify({ format: 'jakukyo-replay', formatVersion: 1, title: record.title, createdAt: record.createdAt, savedGame: record.save }, null, 2);
  }
  async function importRecordJson(text: string) {
    if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) throw new Error('牌谱文件超过 5 MB，请选择单场导出的 JSON。');
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Error('无法读取 JSON，请选择雀境导出的牌谱文件。'); }
    if (!object(value)) throw new Error('每次只能导入一场牌谱，请选择单场 JSON 文件。');
    const wrapped = value.format === 'jakukyo-replay';
    if (wrapped && value.formatVersion !== 1) throw new Error('这份牌谱库导出文件的版本尚不受支持。');
    const save = validateSavedGame(wrapped ? value.savedGame : value);
    const duplicate = [...records.values()].find(record => record.source === 'imported' && exactSave(record.save, save));
    if (duplicate) {
      // Future human autoplay preferences do not change historical decisions or identity.
      // An older export without a preference must not erase a stored choice.
      const autoPlayDifficulty = save.autoPlayDifficulty ?? duplicate.save.autoPlayDifficulty;
      const autoPlayMatchDifficulty = save.autoPlayMatchDifficulty ?? duplicate.save.autoPlayMatchDifficulty;
      const autoExchangeThree = save.autoExchangeThree ?? duplicate.save.autoExchangeThree;
      if (autoPlayDifficulty === duplicate.save.autoPlayDifficulty && autoPlayMatchDifficulty === duplicate.save.autoPlayMatchDifficulty && autoExchangeThree === duplicate.save.autoExchangeThree) return duplicate;
      const updated = { ...duplicate, updatedAt: isoNow(), save: { ...duplicate.save, autoPlayDifficulty, autoPlayMatchDifficulty, autoExchangeThree } };
      records.set(updated.id, updated); changed(true); return updated;
    }
    if ([...records.values()].filter(record => record.favorite).length >= MAX_RECORDS) throw new Error('收藏已达到 500 场，请先整理牌谱库后再导入。');
    const { buildReplayFrames } = await import('../game/replay');
    const frames = await buildReplayFrames(save);
    const record = newRecord(save, 'imported', typeof value.title === 'string' ? value.title : undefined);
    for (const frame of frames) {
      const round = settledRound(frame.snapshot, frame.actionIndex, frame.roundKey);
      if (round) {
        const index = record.rounds.findIndex(item => item.key === round.key);
        if (index >= 0) record.rounds[index] = round; else record.rounds.push(round);
      }
    }
    const tail = frames.at(-1)?.snapshot;
    if (tail) {
      record.playerCount = tail.players.length; record.scoreUnit = tail.scoreUnit ?? record.scoreUnit;
      if (tail.status === 'matchEnd' && tail.result?.kind === 'match') {
        record.completed = true; record.completedAt = isoNow(); record.finalScores = [...tail.result.scores]; record.finalRanks = tail.result.ranks ? [...tail.result.ranks] : undefined;
      }
    }
    records.set(record.id, record); changed(true); return record;
  }
  if (dirty) flushRecords();
  return { beginRecord, observeRecord, flushRecords, exportRecordStorage, pauseRecordPersistence, listRecords: () => visible, listHistory: () => visibleHistory, subscribeRecords: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getRecord: (id: string) => records.get(id), getRecordsError: () => error,
    renameRecord, toggleFavorite, deleteRecord, exportRecordJson, importRecordJson };
}

const store = createRecordStore();
export const { beginRecord, observeRecord, flushRecords, exportRecordStorage, pauseRecordPersistence, listRecords, listHistory, subscribeRecords, getRecord, getRecordsError, renameRecord, toggleFavorite, deleteRecord, exportRecordJson, importRecordJson } = store;
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushRecords);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushRecords(); });
}
