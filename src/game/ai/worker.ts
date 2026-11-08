import { chooseRiichiAction } from './riichi';
import type { BotAction, BotObservation, Difficulty } from './types';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
};
workerScope.onmessage = (event: MessageEvent<{ id: number; observation: BotObservation; actions: BotAction[]; difficulty: Difficulty; aiVersion?: number }>) => {
  const { id, observation, actions, difficulty, aiVersion } = event.data;
  try { workerScope.postMessage({ id, decision: chooseRiichiAction(observation, actions, difficulty, aiVersion) }); }
  catch (error) { workerScope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};
