/** All AI input is a structured-clone-safe projection of one player's information. */
export type Difficulty = 'novice' | 'standard' | 'advanced' | 'expert';

export const AI_VERSION = 8;
export const DIFFICULTIES: ReadonlyArray<{ id: Difficulty; label: string; description: string }> = [
  { id: 'novice', label: '入门', description: '辨认搭子与孤张，适合熟悉规则。' },
  { id: 'standard', label: '标准', description: '计算向听与有效进张，选择有役的鸣牌。' },
  { id: 'advanced', label: '进阶', description: '结合手牌价值、现物与筋壁，判断进攻或防守。' },
  { id: 'expert', label: '高手', description: '兼顾牌形、打点与防守，结合点差选择行动。' },
];

export function validDifficulty(value: unknown): value is Difficulty {
  return DIFFICULTIES.some(item => item.id === value);
}

export function resolveAutoPlayDifficulty(options: { difficulty: Difficulty; autoPlayDifficulty: Difficulty; autoPlayMatchDifficulty: boolean }): Difficulty {
  return options.autoPlayMatchDifficulty ? options.difficulty : options.autoPlayDifficulty;
}

export interface PublicDiscard {
  tile: string;
  /** Claimed discards are already counted in the public meld, so do not count twice. */
  called?: boolean;
  riichi?: boolean;
  tsumogiri?: boolean;
}

export interface PublicOpponent {
  id: number;
  seat: number;
  points: number;
  dealer: boolean;
  riichi: boolean;
  /** False only for publicly retired players, such as a blood-battle winner. */
  active?: boolean;
  /** Publicly declared missing suit in Sichuan rules. */
  voidSuit?: string;
  /** An estimate derived from this opponent's exposed tiles and the table rules. */
  expectedDealInValue?: number;
  /** Meld strings are public, e.g. m123-, z555+, p2222. */
  melds: string[];
  discards: PublicDiscard[];
}

export interface BotObservation {
  ownId: number;
  seat: number;
  roundWind: number;
  roundHand: number;
  /** Whether point placement is relevant in the scheduled final hand or extension. */
  finalRound: boolean;
  playerCount: number;
  /** Players still taking turns; absent keeps historical four-seat estimates. */
  activePlayerCount?: number;
  ownHand: string;
  doraIndicators: string[];
  /** Exposed tiles outside rivers/melds/dora, e.g. extracted north or a regional wildcard indicator. */
  additionalPublicTiles?: string[];
  tilesLeft: number;
  honba: number;
  riichiSticks: number;
  players: PublicOpponent[];
  /** Rules needed to simulate only this player's own legal hand transformations. */
  allowOpenTanyao: boolean;
  /** Only riichi-style rules have discard furiten; other modes must not treat rivers as guaranteed safe. */
  discardFuriten?: boolean;
  /** Physical copies for the 34 tile types; sanma/Sichuan remove types by setting their limit to zero. */
  tileLimits?: number[];
  wildcards?: string[];
  /** Game point units relative to Japanese points; e.g. 0.001 for a regional 1-point base. */
  pointScale?: number;
  expectedDealInValue?: number;
  dealerValueMultiplier?: number;
  seed: string;
}

export interface BotAction {
  key: string;
  type: string;
  tile?: string;
  discard?: string;
  meld?: string;
  concealedKan?: boolean;
}

export interface CandidateMetrics {
  key: string;
  tile?: string;
  shanten: number;
  ukeire: number;
  estimatedValue: number;
  risk: number;
  lossIfDealIn: number;
  score: number;
  lookahead?: number;
}

export interface BotDecision {
  key: string;
  difficulty: Difficulty;
  strategy: 'win' | 'shape' | 'efficiency' | 'attack' | 'fold' | 'search' | 'call' | 'pass';
  candidates: CandidateMetrics[];
  searchNodes: number;
  /** Deterministic operation budget, independent of device speed and wall-clock time. */
  searchBudget: number;
  provider?: 'algorithm' | 'mcr-model-hybrid' | 'riichi-model-hybrid' | 'sichuan-model-hybrid';
  modelId?: string;
}

/** Regional engines can reuse the public-risk/placement ranker with their own shanten/scoring. */
export interface GenericCandidate {
  key: string;
  tile?: string;
  shanten: number;
  ukeire: number;
  estimatedValue: number;
  shapeScore?: number;
  /** Optional rule-specific search estimate, evaluated exclusively on the player's information. */
  lookahead?: number;
}
