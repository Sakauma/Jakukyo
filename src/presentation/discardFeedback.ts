import type { GameSnapshot } from '../game/types';
import { needsTableBaseline, tableMotionCues } from './tableTimeline';

export const DISCARD_FEEDBACK_MS = 900;
export interface DiscardFeedbackEvent {
  key: string;
  playerId: number;
  playerName: string;
  tile: string;
  scope: string;
  sessionKey: unknown;
  expiresAt: number;
}

export const discardFeedbackScope = (snapshot: GameSnapshot) => JSON.stringify([snapshot.mode, snapshot.seed,
  snapshot.round.wind, snapshot.round.hand, snapshot.round.honba, snapshot.round.dealer]);

/** Reads actual public discard cues; failed inputs and logs cannot create an event. */
export function createDiscardFeedbackTracker() {
  let previous: GameSnapshot | null = null;
  let owner: unknown = null;
  let event: DiscardFeedbackEvent | null = null;
  let lastKey = '';
  return {
    sync(snapshot: GameSnapshot | null, sessionKey: unknown, now: number, hidden = false): DiscardFeedbackEvent | null {
      const before = previous;
      previous = hidden ? null : snapshot;
      const changedSession = owner !== sessionKey;
      owner = sessionKey;
      if (hidden || !snapshot || snapshot.status !== 'playing' || changedSession || !before
        || needsTableBaseline(before, snapshot) || discardFeedbackScope(before) !== discardFeedbackScope(snapshot)) {
        event = null; lastKey = ''; return null;
      }
      const cue = tableMotionCues(before, snapshot).filter(item => item.kind === 'discard').at(-1);
      if (cue && cue.key !== lastKey) {
        const player = snapshot.players.find(item => item.id === cue.seat);
        const discard = cue.riverIndex == null ? undefined : player?.discards[cue.riverIndex];
        if (player && discard) {
          lastKey = cue.key;
          event = { key: cue.key, playerId: player.id, playerName: player.name, tile: discard.tile,
            scope: discardFeedbackScope(snapshot), sessionKey, expiresAt: now + DISCARD_FEEDBACK_MS };
        }
      }
      if (event && now >= event.expiresAt) event = null;
      return event;
    },
  };
}
