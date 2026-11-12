import type { Difficulty } from './ai/types';
/** Public, information-safe view. m/p/s 1-9, z 1-7; 0 is a red five, f1-f8 are flowers. */
export type TileCode = string;
export type ModeId = 'riichi' | 'sanma' | 'mcr' | 'sichuan-blood' | 'sichuan-river' | 'hongkong' | 'guangdong' | 'taiwan' | 'hangzhou' | 'wuhan' | 'changsha' | 'northeast';
export type ActionType = 'discard' | 'riichi' | 'chi' | 'pon' | 'kan' | 'ron' | 'tsumo' | 'pass' | 'abort' | 'next' | 'kita' | 'void' | 'exchange' | 'confirm';
export interface HandTile {
  id: string;
  tile: TileCode;
  label: string;
  drawn: boolean;
}
export interface DiscardTile { tile: TileCode; riichi: boolean; called: boolean; tsumogiri: boolean }
export interface MeldView { id: string; tiles: TileCode[]; concealed: boolean; type: 'chi' | 'pon' | 'kan'; from?: number }
export interface PlayerView {
  id: number;
  name: string;
  wind: string;
  points: number;
  dealer: boolean;
  riichi: boolean;
  isHuman: boolean;
  hand: HandTile[];
  concealedCount: number;
  discards: DiscardTile[];
  melds: MeldView[];
  /** Only populated after an explicit public reveal at hand settlement. */
  revealedHand?: TileCode[];
  flowers?: TileCode[];
  kita?: number;
  voidSuit?: string;
  hasWon?: boolean;
  winCount?: number;
}
export interface LegalAction {
  id: string;
  type: ActionType;
  label: string;
  tile?: TileCode;
  tileId?: string;
  tiles?: TileCode[];
  description?: string;
}
export interface RoundView {
  wind: string;
  hand: number;
  honba: number;
  /** Distinguishes repeated wind cycles and consecutive hands in endless matches. */
  sequence?: number;
  riichiSticks: number;
  tilesLeft: number;
  doraIndicators: TileCode[];
  uraIndicators: TileCode[];
  dealer: number;
  wildcard?: TileCode;
}
export interface YakuView { name: string; han: number | string }
export interface SichuanOptions {
  version: 1 | 2;
  fanCap: 3 | 4 | 5 | 6 | 8 | 'none';
  selfDraw: 'base' | 'fan';
  menqingZhongzhang: boolean;
}
export interface SichuanScore {
  fanCap: SichuanOptions['fanCap'];
  effectiveFan: number;
  multiplier: number;
  selfDrawBonus: number;
}
export interface WinnerView {
  playerId: number;
  fromId?: number;
  fu: number;
  han: number;
  points: number;
  yakuman: number;
  yaku: YakuView[];
  hand: TileCode[];
  winningTile?: TileCode;
  /** Melds disclosed by this win, copied before any continuing-hand changes. */
  melds?: MeldView[];
  /** Actual deltas for this winner only, in fixed player ID order; includes awarded pot/honba. */
  payments?: number[];
  sichuanScore?: SichuanScore;
}
export interface ConfirmedWinEvent {
  /** Unique within the running application, including repeated wins in a continuing hand. */
  id: string;
  winners: WinnerView[];
  /** This event only; prior kong payments and riichi deposits are not included. */
  deltas: number[];
  scores: number[];
  /** True when blood battle/river continues after these wins. */
  continuing: boolean;
}
export interface RoundResult {
  kind: 'win' | 'draw' | 'abort' | 'match';
  title: string;
  description: string;
  winners: WinnerView[];
  /** Changes in fixed player ID order, including the awarded riichi pot when applicable. */
  deltas: number[];
  scores: number[];
  ranks?: number[];
  tenpai?: boolean[];
}
export interface GameLogEntry { id: number; text: string; playerId?: number; tile?: TileCode }
export type RiichiFuritenReason = 'discard' | 'temporary' | 'riichi-pass';
export interface RiichiFuritenView {
  active: boolean;
  reasons: RiichiFuritenReason[];
  /** Any match makes the entire waiting group unable to ron. */
  discardTiles: TileCode[];
}
export interface RiichiWaitView {
  tile: TileCode;
  /** Four minus own/public copies; includes unseen opponents' hands and the dead wall. */
  unseen: number;
  /** Ordinary ron yaku, independent of furiten; excludes transient last-tile/rob-kong bonuses. */
  ronYaku: boolean;
}
export interface RiichiHandHint {
  shanten: number | null;
  waits: RiichiWaitView[];
  furiten: RiichiFuritenView;
  riichiEligible?: boolean;
}
export interface RiichiAssistView {
  /** Only present for a waiting-size hand, not the current drawn/discard-size hand. */
  current: RiichiHandHint | null;
  /** Hypothetical result after a legal discard, indexed by the current HandTile ID. */
  discards: Record<string, RiichiHandHint>;
  furiten: RiichiFuritenView;
  /** True only when the actual current legal actions include ron. */
  ronAvailable: boolean;
}
export interface RegionalWaitView {
  tile: TileCode;
  ron: boolean;
  tsumo: boolean;
  ronFan?: number;
  tsumoFan?: number;
  status: 'ron' | 'tsumo' | 'insufficient' | 'blocked';
  reasons: string[];
}
export interface RegionalHandHint {
  shanten: number | null;
  waits: TileCode[];
  waitDetails: RegionalWaitView[];
}
export interface QuickControls { autoWin: boolean; autoDiscard: boolean; noCall: boolean }
/** A real shape-completing opponent event that did not offer legal ron. */
export interface RonNotice {
  id: string;
  tile: TileCode;
  fromId: number;
  event: 'discard' | 'addedKan';
  /** False after that response passes; retained briefly by the UI as a past event. */
  active: boolean;
  reasons: string[];
}
/** Reason a completed hand on the player's actual draw could not self-draw win. */
export interface SelfWinNotice {
  id: string;
  tile: TileCode;
  reasons: string[];
}
export interface GameSnapshot {
  status: 'ready' | 'playing' | 'roundEnd' | 'matchEnd';
  phase: 'waiting' | 'discard' | 'response' | 'settlement' | 'exchange' | 'void';
  seed: string;
  players: PlayerView[];
  round: RoundView;
  turn: number;
  humanId: 0;
  actions: LegalAction[];
  message: string;
  log: GameLogEntry[];
  result: RoundResult | null;
  /** Most recent confirmed, public win; cleared on the next deal. */
  latestWin?: ConfirmedWinEvent;
  ronNotice?: RonNotice;
  selfWinNotice?: SelfWinNotice;
  autoPlay: boolean;
  /** Human-only autoplay strategy; opponents keep difficulty. */
  autoPlayDifficulty?: Difficulty;
  /** Sichuan autoplay may submit exchange-three without human confirmation; defaults to false. */
  autoExchangeThree?: boolean;
  quickControls?: QuickControls;
  speed: number;
  revision: number;
  /** Closed-hand distance; -1 is a complete hand. */
  shanten: number | null;
  waits: TileCode[];
  /** Public-information hints for four-player riichi and sanma only. */
  riichiAssist?: RiichiAssistView;
  regionalAssist?: RegionalHandHint;
  rulesVersion?: 1 | 2;
  /** New MCR tables conceal opponents' kong identities until the round is revealed. */
  hideOpponentConcealedKongs?: boolean;
  mode?: ModeId;
  modeName?: string;
  difficulty?: Difficulty;
  playerCount?: number;
  handSize?: number;
  scoreUnit?: '点' | '分' | '台';
  setupSelection?: string[];
  ruleSummary?: string[];
  sichuanOptions?: SichuanOptions;
}
export interface SessionOptions {
  mode?: ModeId;
  /** Regional legality and scoring version; old saves without it use version 1. */
  rulesVersion?: 1 | 2;
  difficulty?: Difficulty;
  /** Restore a supported table's original balance; new regional tables default to 100. */
  startPoints?: number;
  variantOptions?: { exchangeThree?: boolean; minimumFan?: number; sichuan?: Partial<SichuanOptions> };
  seed?: string;
  /** Milliseconds between visible engine steps; 0 is useful for test automation. */
  speed?: number;
  autoPlay?: boolean;
  autoPlayDifficulty?: Difficulty;
  autoExchangeThree?: boolean;
  quickControls?: Partial<QuickControls>;
  /** Defaults to a hanchan; single-hand mode is useful for tests and practice. */
  matchLength?: 'hanchan' | 'east' | 'single' | 'endless';
}
export interface ReplayDecision { key: string }
export interface BotReplayDecision {
  step: number;
  playerId: number;
  sequence: number;
  key: string;
  source?: 'algorithm' | 'mcr-model-hybrid' | 'riichi-model-hybrid' | 'sichuan-model-hybrid';
}
export interface SavedAiModel {
  id: string;
  sha256: string;
  featureVersion: number;
  policyVersion: number;
}
/** Public round-start state sufficient to resume one deterministic endless hand. */
export interface EndlessCheckpoint {
  version: 1;
  /** Unique game identity, stable across hands and resumed sessions. */
  sessionId: string;
  sequence: number;
  points: number[];
  dealer: number;
  rotation: number;
  honba: number;
  sticks: number;
}
export interface SavedGame {
  version: 1;
  seed: string;
  matchLength: 'hanchan' | 'east' | 'single' | 'endless';
  checkpoint?: EndlessCheckpoint;
  decisions: ReplayDecision[];
  mode?: ModeId;
  /** Initial balance, not current points or scoring stakes; absent means the old table default. */
  startPoints?: number;
  difficulty?: Difficulty;
  aiVersion?: number;
  botDecisions?: BotReplayDecision[];
  aiModel?: SavedAiModel;
  rulesVersion?: 1 | 2;
  /** Last selected human autoplay level; historical actions remain explicit decisions. */
  autoPlayDifficulty?: Difficulty;
  autoExchangeThree?: boolean;
  variantOptions?: SessionOptions['variantOptions'];
  /** Exact engine progress for new saves; legacy saves omit this boundary. */
  replayPosition?: number;
}
export interface ReplayFrame {
  snapshot: GameSnapshot;
  actionIndex: number;
  actionLabel: string;
  roundKey: string;
  /** Added only by isolated replay reconstruction after a confirmed completed ending. */
  allHands?: Record<number, TileCode[]>;
}
export type GameSessionAPI = RiichiSessionAPI;
export interface ReplayData extends SavedGame { rules: Record<string, unknown>; log: unknown }
export interface RiichiSessionAPI {
  getSnapshot(): GameSnapshot;
  /** Current-condition win eligibility after a currently legal regional discard. */
  getRegionalHint?(discardId: string): RegionalHandHint | null;
  subscribe(listener: () => void): () => void;
  dispatch(actionId: string): boolean;
  newGame(options?: SessionOptions): void;
  setAutoPlay(enabled: boolean): void;
  setAutoPlayDifficulty(difficulty: Difficulty): void;
  setAutoExchangeThree(enabled: boolean): void;
  setQuickControls(controls: Partial<QuickControls>): void;
  setSpeed(milliseconds: number): void;
  exportReplay(): ReplayData;
  getSavedGame(): SavedGame;
  loadSavedGame(data: SavedGame): boolean;
  dispose(): void;
}
