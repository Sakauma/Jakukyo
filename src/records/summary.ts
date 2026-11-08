import type { RoundView } from '../game/types';
import type { GameRecord, PlayedHistory } from './types';

/** Honba distinguishes consecutive dealer repeats independently of log length. */
export const stableRoundKey = (round: RoundView) => `${round.wind}:${round.hand}:${round.dealer}:${round.honba}`;

export function summarizeRecord(record: GameRecord): PlayedHistory {
  return { id: record.id, mode: record.mode, playerCount: record.playerCount, scoreUnit: record.scoreUnit,
    completed: record.completed, finalRanks: record.finalRanks ? [...record.finalRanks] : undefined,
    hands: record.rounds.map(round => {
      const wins = round.result.winners.filter(winner => winner.playerId === 0);
      const losses = round.result.winners.filter(winner => winner.fromId === 0 && winner.playerId !== 0);
      const own = round.players.find(player => player.id === 0);
      const priced = wins.filter(winner => Number.isFinite(winner.points) && winner.points >= 0);
      return { key: stableRoundKey(round.round), won: wins.length > 0, dealIn: losses.length > 0,
        winEvents: wins.length, dealInEvents: losses.length, riichi: own?.riichi ?? false, openMeld: own?.openMeld ?? false,
        winPointSum: priced.reduce((total, winner) => total + winner.points, 0), pricedWins: priced.length };
    }) };
}

export function mergeHistory(before: PlayedHistory | undefined, after: PlayedHistory): PlayedHistory {
  const hands = new Map((before?.hands ?? []).map(hand => [hand.key, hand]));
  for (const hand of after.hands) hands.set(hand.key, hand);
  return { ...after, completed: after.completed || !!before?.completed,
    finalRanks: after.finalRanks ?? before?.finalRanks, hands: [...hands.values()] };
}
