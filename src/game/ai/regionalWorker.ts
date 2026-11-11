import { chooseRegionalAction } from './regional';
import type { RegionalBotInput } from './regional';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<{ id: number; input: RegionalBotInput }>) => void) | null;
  postMessage(message: unknown): void;
};

workerScope.onmessage = event => {
  const { id, input } = event.data;
  try { workerScope.postMessage({ id, decision: chooseRegionalAction(input) }); }
  catch (error) { workerScope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};
