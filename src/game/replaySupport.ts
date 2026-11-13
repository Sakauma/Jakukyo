import { AI_VERSION, validDifficulty } from './ai/types';
import { MODES } from './catalog';
import type { GameSnapshot, ReplayDecisionPoint, ReplayFrame, SavedGame } from './types';
import { validStartPoints } from './startingPoints';
import { validEndlessCheckpoint } from './endlessCheckpoint';
import { validSichuanOptions } from './variants/sichuan';

export const MAX_REPLAY_STEPS = 100000;
export const MAX_REPLAY_FRAMES = 8000;

/** Explicitly validate before creating a seeded reconstruction. Extra export metadata is ignored. */
export function validateReplayData(data: SavedGame): void {
  if (!data || data.version !== 1 || typeof data.seed !== 'string' || !data.seed.length || data.seed.length > 200
    || !['single', 'east', 'hanchan', 'endless'].includes(data.matchLength)
    || !Array.isArray(data.decisions) || data.decisions.length > 10000
    || !data.decisions.every(decision => decision && typeof decision.key === 'string' && decision.key.length <= 500)
    || (data.mode != null && !MODES.some(mode => mode.id === data.mode && mode.status === 'playable'))
    || (data.difficulty != null && !validDifficulty(data.difficulty))
    || (data.startPoints != null && !validStartPoints(data.mode, data.startPoints))
    || (data.autoPlayDifficulty != null && !validDifficulty(data.autoPlayDifficulty))
    || (data.autoPlayMatchDifficulty !== undefined && typeof data.autoPlayMatchDifficulty !== 'boolean')
    || (data.autoExchangeThree != null && typeof data.autoExchangeThree !== 'boolean')) throw new Error('牌谱格式损坏或超出支持范围。');
  if (data.aiVersion != null && !(data.mode == null || data.mode === 'riichi' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, AI_VERSION] : [2, 3, 4, 5, 6, 7, 8, 9, 10, AI_VERSION]).includes(data.aiVersion)) {
    throw new Error('牌谱使用的电脑版本与当前游戏不兼容。');
  }
  validateBotReplay(data);
  if (data.rulesVersion !== undefined && data.rulesVersion !== 1 && data.rulesVersion !== 2) throw new Error('牌谱使用了不支持的规则版本。');
  if (data.matchLength === 'endless' && !validEndlessCheckpoint(data.checkpoint, data.mode)) {
    throw new Error('无限对局牌谱缺少有效的单局起始信息。');
  }
  if (data.replayPosition != null && (!Number.isInteger(data.replayPosition) || data.replayPosition < 0 || data.replayPosition > MAX_REPLAY_STEPS)) {
    throw new Error('牌谱的结束位置无效或超限。');
  }
  if (data.variantOptions !== undefined && (!data.variantOptions || typeof data.variantOptions !== 'object' || Array.isArray(data.variantOptions)
    || (data.variantOptions.exchangeThree != null && typeof data.variantOptions.exchangeThree !== 'boolean')
    || (data.variantOptions.minimumFan != null && (!Number.isFinite(data.variantOptions.minimumFan) || data.variantOptions.minimumFan < 0 || data.variantOptions.minimumFan > 1000))
    || (data.variantOptions.sichuan !== undefined && !validSichuanOptions(data.variantOptions.sichuan)))) {
    throw new Error('牌谱桌规选项无效。');
  }
}

export function validateBotReplay(data: SavedGame): void {
  if ((data.aiVersion ?? 0) < 7) return;
  if (!Array.isArray(data.botDecisions) || data.botDecisions.length > MAX_REPLAY_STEPS * 3) throw new Error('牌谱缺少有效电脑操作记录。');
  const next = new Map<string, number>();
  for (const decision of data.botDecisions) {
    if (!decision || !Number.isInteger(decision.step) || decision.step < 0 || decision.step > MAX_REPLAY_STEPS
      || !Number.isInteger(decision.playerId) || decision.playerId < 1 || decision.playerId > (data.mode === 'sanma' ? 2 : 3)
      || !Number.isInteger(decision.sequence) || typeof decision.key !== 'string' || decision.key.length > 500
      || decision.source != null && !['algorithm', 'mcr-model-hybrid', 'riichi-model-hybrid', 'sichuan-model-hybrid'].includes(decision.source)) throw new Error('电脑操作记录无效。');
    const prefix = `${decision.step}:${decision.playerId}`;
    if (decision.sequence !== (next.get(prefix) || 0)) throw new Error('电脑操作顺序无效。');
    next.set(prefix, decision.sequence + 1);
  }
  if (data.botDecisions.some(decision => decision.source === 'mcr-model-hybrid') && (data.mode !== 'mcr' || !data.aiModel)) {
    throw new Error('模型操作记录缺少对应的模型身份。');
  }
  if (data.botDecisions.some(decision => decision.source === 'riichi-model-hybrid') && (data.mode != null && data.mode !== 'riichi' || !data.aiModel)) throw new Error('立直模型操作记录缺少对应模型身份。');
  const sichuanModel = data.mode === 'sichuan-blood' || data.mode === 'sichuan-river';
  if (data.botDecisions.some(decision => decision.source === 'sichuan-model-hybrid')
    && (!sichuanModel || (data.aiVersion ?? 0) < (data.mode === 'sichuan-river' ? 9 : 8) || !data.aiModel)) throw new Error('四川模型操作记录缺少对应模型身份。');
  const aiVersion = data.aiVersion ?? 0;
  const featureVersion = sichuanModel ? aiVersion >= 10 ? 3 : aiVersion >= 9 ? 2 : 1 : data.mode === 'mcr' ? 1 : 2;
  if (data.aiModel != null && (data.mode != null && !['mcr', 'riichi', 'sichuan-blood', 'sichuan-river'].includes(data.mode)
    || data.mode === 'sichuan-river' && (data.aiVersion ?? 0) < 9 || typeof data.aiModel.id !== 'string' || data.aiModel.id.length > 100
    || !/^[0-9a-f]{64}$/i.test(data.aiModel.sha256) || data.aiModel.featureVersion !== featureVersion || data.aiModel.policyVersion !== 1)) {
    throw new Error('牌谱模型身份无效。');
  }
}

export function appendReplayFrame(frames: ReplayFrame[], snapshot: GameSnapshot, hands: Record<number, string[]>, label?: string): void {
  if (frames.length >= MAX_REPLAY_FRAMES) throw new Error('牌谱过长，超过本机回放帧数上限。');
  const previous = frames.at(-1)?.snapshot;
  const latestLog = snapshot.log.at(-1);
  const actionLabel = label ?? (snapshot.status === 'matchEnd' ? '最终排名'
    : snapshot.status === 'roundEnd' ? snapshot.result?.title ?? '本局结算'
      : latestLog && (!previous || latestLog.id !== previous.log.at(-1)?.id) ? latestLog.text
        : previous && snapshot.round.tilesLeft < previous.round.tilesLeft ? `${snapshot.players.find(player => player.id === snapshot.turn)?.name ?? '玩家'}摸牌`
          : snapshot.phase === 'discard' ? '等待出牌' : snapshot.phase === 'response' ? '响应舍牌' : '牌局推进');
  frames.push({ snapshot: structuredClone(snapshot), actionIndex: frames.length, actionLabel,
    roundKey: `${snapshot.mode ?? 'riichi'}:${snapshot.round.wind}:${snapshot.round.hand}:${snapshot.round.honba}:${snapshot.round.dealer}${snapshot.round.sequence == null ? '' : `:${snapshot.round.sequence}`}`,
    allHands: structuredClone(hands),
  });
}

export function appendReplayDecision(frames: ReplayFrame[], decision: ReplayDecisionPoint): void {
  const frame = frames.at(-1);
  const actual = decision.actions.find(action => action.key === decision.actualKey);
  if (!frame || !actual || decision.actions.length < 2
    || !['discard', 'riichi', 'chi', 'pon', 'kan', 'pass', 'kita', 'ron', 'tsumo'].includes(actual.type)) return;
  const captured = structuredClone(decision);
  if (captured.input.kind === 'regional') {
    // Older AI inputs omitted this public flag. Read only the action's before-frame,
    // so current analysis of blood-flow replays cannot see later wins.
    const publicPlayers = new Map(frame.snapshot.players.map(player => [player.id, player]));
    captured.input.input.observation.players = captured.input.input.observation.players.map(player => {
      const hasWon = publicPlayers.get(player.id)?.hasWon;
      return typeof hasWon === 'boolean' ? { ...player, hasWon } : player;
    });
  }
  frame.decision = captured;
}

export function finishReplayFrames(frames: ReplayFrame[]): ReplayFrame[] {
  const completed = new Set(frames.filter(frame => ['roundEnd', 'matchEnd'].includes(frame.snapshot.status)).map(frame => frame.roundKey));
  // A partial import may expose earlier completed hands, but never its live tail.
  for (const frame of frames) if (!completed.has(frame.roundKey)) delete frame.allHands;
  return frames;
}

/** A short yield keeps long reconstructions from locking the application. */
export const yieldReplayWork = () => new Promise<void>(resolve => setTimeout(resolve, 0));
