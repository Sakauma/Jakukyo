import { AI_VERSION, validDifficulty } from './ai/types';
import { MODES } from './catalog';
import type { GameSnapshot, ReplayFrame, SavedGame } from './types';
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
    || (data.autoExchangeThree != null && typeof data.autoExchangeThree !== 'boolean')) throw new Error('牌谱格式损坏或超出支持范围。');
  if (data.aiVersion != null && !(data.mode == null || data.mode === 'riichi' ? [1, 2, AI_VERSION] : [2, AI_VERSION]).includes(data.aiVersion)) {
    throw new Error('牌谱使用的电脑版本与当前游戏不兼容。');
  }
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

export function finishReplayFrames(frames: ReplayFrame[]): ReplayFrame[] {
  const completed = new Set(frames.filter(frame => ['roundEnd', 'matchEnd'].includes(frame.snapshot.status)).map(frame => frame.roundKey));
  // A partial import may expose earlier completed hands, but never its live tail.
  for (const frame of frames) if (!completed.has(frame.roundKey)) delete frame.allHands;
  return frames;
}

/** A short yield keeps long reconstructions from locking the application. */
export const yieldReplayWork = () => new Promise<void>(resolve => setTimeout(resolve, 0));
