import { listHistory, listRecords } from './store';
import { summarizeRecord } from './summary';
import type { GameRecord, PlayedHistory, StatisticsGroup } from './types';

/** Own-player statistics. Every rate uses settled hands, never snapshot count. */
export function getStatistics(records?: readonly GameRecord[], source: GameRecord['source'] = 'played'): StatisticsGroup[] {
  const summaries = records == null && source === 'played' ? listHistory() : (records ?? listRecords()).filter(record => record.source === source).map(summarizeRecord);
  return summarizeStatistics(summaries);
}

/** Also exposed for a fully isolated, in-memory ledger check. */
export function summarizeStatistics(summaries: readonly PlayedHistory[]): StatisticsGroup[] {
  const groups = new Map<string, StatisticsGroup & { rankSum: number; winPointSum: number; pricedWins: number }>();
  const seenMatches = new Set<string>(), seenRounds = new Set<string>();
  for (const record of summaries) {
    if (seenMatches.has(record.id)) continue;
    seenMatches.add(record.id);
    const key = `${record.mode}:${record.playerCount}:${record.scoreUnit}`;
    let group = groups.get(key);
    if (!group) {
      group = { mode: record.mode, playerCount: record.playerCount, scoreUnit: record.scoreUnit,
        completedMatches: 0, rankedMatches: 0, averageRank: null, rankCounts: Array(record.playerCount).fill(0),
        settledHands: 0, wonHands: 0, dealInHands: 0, winRate: 0, dealInRate: 0, winEvents: 0, dealInEvents: 0,
        riichiHands: 0, openMeldHands: 0, riichiRate: 0, openMeldRate: 0, averageWinPoints: null,
        rankSum: 0, winPointSum: 0, pricedWins: 0 };
      groups.set(key, group);
    }
    if (record.completed) {
      group.completedMatches++;
      const rank = record.finalRanks?.[0];
      if (rank && Number.isInteger(rank) && rank >= 1 && rank <= record.playerCount) {
        group.rankedMatches++; group.rankSum += rank; group.rankCounts[rank - 1]++;
      }
    }
    if (record.endless) {
      const totals = record.endless.totals;
      group.settledHands += totals.settledHands; group.wonHands += totals.wonHands; group.dealInHands += totals.dealInHands;
      group.winEvents += totals.winEvents; group.dealInEvents += totals.dealInEvents;
      group.riichiHands += totals.riichiHands; group.openMeldHands += totals.openMeldHands;
      group.winPointSum += totals.winPointSum; group.pricedWins += totals.pricedWins;
    }
    for (const hand of record.hands) {
      const handKey = `${record.id}:${hand.key}`;
      if (seenRounds.has(handKey)) continue;
      seenRounds.add(handKey); group.settledHands++;
      if (hand.won) group.wonHands++;
      if (hand.dealIn) group.dealInHands++;
      group.winEvents += hand.winEvents; group.dealInEvents += hand.dealInEvents;
      if (hand.riichi) group.riichiHands++;
      if (hand.openMeld) group.openMeldHands++;
      group.winPointSum += hand.winPointSum; group.pricedWins += hand.pricedWins;
    }
  }
  return [...groups.values()].map(group => {
    const { rankSum, winPointSum, pricedWins, ...result } = group;
    result.averageRank = result.rankedMatches ? rankSum / result.rankedMatches : null;
    result.averageWinPoints = pricedWins ? winPointSum / pricedWins : null;
    result.winRate = result.settledHands ? result.wonHands / result.settledHands * 100 : 0;
    result.dealInRate = result.settledHands ? result.dealInHands / result.settledHands * 100 : 0;
    result.riichiRate = result.settledHands ? result.riichiHands / result.settledHands * 100 : 0;
    result.openMeldRate = result.settledHands ? result.openMeldHands / result.settledHands * 100 : 0;
    return result;
  });
}
