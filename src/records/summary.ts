import type { RoundView } from '../game/types';
import type { EndlessHistoryTotals, GameRecord, HistoryHand, PlayedHistory } from './types';

/** Honba distinguishes consecutive dealer repeats independently of log length. */
export const stableRoundKey = (round: RoundView) => `${round.wind}:${round.hand}:${round.dealer}:${round.honba}${round.sequence == null ? '' : `:${round.sequence}`}`;

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

function addHand(totals: EndlessHistoryTotals, hand: HistoryHand, sign: 1 | -1): void {
  totals.settledHands += sign;
  totals.wonHands += sign * Number(hand.won);
  totals.dealInHands += sign * Number(hand.dealIn);
  totals.winEvents += sign * hand.winEvents;
  totals.dealInEvents += sign * hand.dealInEvents;
  totals.riichiHands += sign * Number(hand.riichi);
  totals.openMeldHands += sign * Number(hand.openMeld);
  totals.winPointSum += sign * hand.winPointSum;
  totals.pricedWins += sign * hand.pricedWins;
}

/** A monotonic hand sequence keeps one infinite game's statistics bounded. */
export function mergeEndlessHistory(before: PlayedHistory | undefined, after: PlayedHistory, sequence: number): PlayedHistory {
  const hand = after.hands.at(-1);
  if (!hand || !Number.isSafeInteger(sequence) || sequence < 1) throw new Error('无限对局战绩缺少有效的局序。');
  if (before && (!before.endless || before.mode !== after.mode || before.playerCount !== after.playerCount || before.scoreUnit !== after.scoreUnit)) {
    throw new Error('无限对局战绩身份不一致。');
  }
  const previous = before?.endless;
  if (previous && sequence < previous.through) return before!;
  if (previous && sequence === previous.through && JSON.stringify(previous.lastHand) === JSON.stringify(hand)) return before!;
  const totals: EndlessHistoryTotals = previous ? { ...previous.totals } : {
    settledHands: 0, wonHands: 0, dealInHands: 0, winEvents: 0, dealInEvents: 0,
    riichiHands: 0, openMeldHands: 0, winPointSum: 0, pricedWins: 0,
  };
  if (previous && sequence === previous.through) addHand(totals, previous.lastHand, -1);
  addHand(totals, hand, 1);
  return { ...after, completed: false, finalRanks: undefined, hands: [], endless: { through: sequence, totals, lastHand: hand } };
}
