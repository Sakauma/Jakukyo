import type { ModeId, RoundResult, RoundView, SavedGame } from '../game/types';

export interface RecordedRound {
  /** Stable public log position; repeated snapshots update the same hand. */
  key: string;
  actionIndex: number;
  round: RoundView;
  result: RoundResult;
  players: Array<{ id: number; name: string; riichi: boolean; openMeld: boolean }>;
}

export interface GameRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  source: 'played' | 'imported';
  favorite: boolean;
  mode: ModeId;
  playerCount: number;
  scoreUnit: string;
  save: SavedGame;
  /** True only after a real match-end result has been observed/reconstructed. */
  completed: boolean;
  rounds: RecordedRound[];
  finalScores?: number[];
  finalRanks?: number[];
}

export interface StatisticsGroup {
  mode: ModeId;
  playerCount: number;
  scoreUnit: string;
  completedMatches: number;
  /** Matches with a published final ranking; may be less than completedMatches. */
  rankedMatches: number;
  averageRank: number | null;
  rankCounts: number[];
  settledHands: number;
  wonHands: number;
  dealInHands: number;
  winRate: number;
  dealInRate: number;
  /** Blood-river can contain more than one winning event in a single hand. */
  winEvents: number;
  dealInEvents: number;
  riichiHands: number;
  openMeldHands: number;
  riichiRate: number;
  openMeldRate: number;
  averageWinPoints: number | null;
}

/** Permanent own-play ledger: no hand tiles, decisions, seed or replay frames. */
export interface HistoryHand {
  key: string;
  won: boolean;
  dealIn: boolean;
  winEvents: number;
  dealInEvents: number;
  riichi: boolean;
  openMeld: boolean;
  winPointSum: number;
  pricedWins: number;
}
/** Bounded summary for one continuing game; completed hands need no stored tiles. */
export interface EndlessHistoryTotals {
  settledHands: number;
  wonHands: number;
  dealInHands: number;
  winEvents: number;
  dealInEvents: number;
  riichiHands: number;
  openMeldHands: number;
  winPointSum: number;
  pricedWins: number;
}
export interface EndlessHistory {
  through: number;
  totals: EndlessHistoryTotals;
  lastHand: HistoryHand;
}
export interface PlayedHistory {
  id: string;
  mode: ModeId;
  playerCount: number;
  scoreUnit: string;
  completed: boolean;
  finalRanks?: number[];
  hands: HistoryHand[];
  /** Endless sessions aggregate settled hands instead of growing a per-hand ledger. */
  endless?: EndlessHistory;
}
