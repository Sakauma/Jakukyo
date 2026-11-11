import type { HandScore } from '../variants/rules';
import { evaluateDanger, visibleCounts } from './evaluator';
import type { RegionalBotInput } from './regional';
import type { BotDecision, BotObservation, GenericCandidate } from './types';

export interface RegionalCandidate extends GenericCandidate {
  ronUkeire: number;
  tsumoUkeire: number;
  ronValue: number;
  tsumoValue: number;
  riichiDeclaration?: boolean;
  immediateGain?: number;
}

/** Same payer formulas as RegionalSession.award, using public seats and ordinary win context. */
export function regionalAwardValue(input: RegionalBotInput, score: HandScore, selfDraw: boolean): number {
  const observation = input.observation;
  const opponents = observation.players.filter(player => player.id !== observation.ownId && player.active !== false);
  if (input.profile.id === 'sanma') return score.base + observation.honba * (selfDraw ? opponents.length * 100 : 300);
  if (input.profile.id === 'mcr') return opponents.length * 8 + score.fan * (selfDraw ? opponents.length : 1);
  const ownDealer = observation.players.find(player => player.id === observation.ownId)?.dealer;
  const payment = (dealer: boolean) => {
    let amount = score.base + (score.sichuanScore?.selfDrawBonus || 0);
    if (input.profile.id === 'taiwan' && (ownDealer || dealer)) amount += 1 + 2 * observation.honba;
    if (input.profile.id === 'hangzhou' && (ownDealer || dealer)) amount *= 2;
    return amount;
  };
  const amounts = opponents.map(player => payment(player.dealer));
  return selfDraw ? amounts.reduce((sum, amount) => sum + amount, 0)
    : amounts.reduce((sum, amount) => sum + amount, 0) / Math.max(1, amounts.length);
}

export function regionalPublicObservation(input: RegionalBotInput): BotObservation {
  const minimumLoss: Record<string, number> = { sanma: 5200, mcr: 16, hongkong: 8, guangdong: 1,
    taiwan: 2, hangzhou: 0, wuhan: 2, changsha: 1, northeast: 1 };
  return { ...input.observation, expectedDealInValue: minimumLoss[input.profile.id] ?? input.observation.expectedDealInValue };
}

export function rankRegionalCandidates(input: RegionalBotInput, candidates: RegionalCandidate[]): BotDecision {
  const observation = input.observation;
  const known = visibleCounts(observation);
  const total = observation.tileLimits?.reduce((sum, count) => sum + count, 0) ?? 136;
  const unseen = Math.max(1, total - known.reduce((sum, count) => sum + count, 0));
  const active = observation.activePlayerCount ?? observation.playerCount;
  const threat = evaluateDanger(observation, 'z1', known).maximumThreat;
  const threatened = !input.profile.selfDrawOnly && threat >= .6;
  const draws = Math.min(observation.tilesLeft / Math.max(1, active), threatened ? 4 : Infinity);
  const unit = input.profile.id === 'sanma' ? 1000 : input.profile.id === 'mcr' ? 8 : 1;
  const metrics = candidates.map(candidate => {
    const action = input.actions.find(item => item.key === candidate.key);
    const canDealIn = !input.profile.selfDrawOnly || action?.kind === 'added';
    const exposedTile = candidate.tile ?? (action?.kind === 'added' ? action.tile : undefined);
    const danger = canDealIn && exposedTile ? evaluateDanger(observation, exposedTile, known)
      : { risk: 0, expectedLoss: 0, lossIfDealIn: 0 };
    const opportunities = Math.max(0, draws - Math.max(0, candidate.shanten) * 1.5);
    const tsumoChance = 1 - Math.pow(1 - Math.min(.9, candidate.tsumoUkeire / unseen), opportunities);
    const ronChance = 1 - Math.pow(1 - Math.min(.9, candidate.ronUkeire / unseen), opportunities * .6);
    const ready = candidate.shanten === 0;
    const chance = ready ? 1 - (1 - tsumoChance) * (1 - ronChance)
      : (1 - Math.pow(1 - Math.min(.9, candidate.ukeire / unseen), opportunities)) * [.4, .12, .03][Math.min(2, Math.max(0, candidate.shanten - 1))];
    const readyValue = (tsumoChance * candidate.tsumoValue + (1 - tsumoChance) * ronChance * candidate.ronValue);
    const gain = ready ? readyValue : chance * candidate.estimatedValue;
    const pool = input.profile.id === 'sanma' ? chance * observation.riichiSticks * 1000 : 0;
    const cost = candidate.riichiDeclaration ? 1000 * (1 - chance) : 0;
    const progress = threatened ? (-Math.min(6, candidate.shanten) + Math.min(1, candidate.ukeire / 136)) * unit * .001
      : -candidate.shanten * unit * 20 + candidate.ukeire * unit * .1;
    let score = progress + gain + pool - cost - danger.expectedLoss * (ready ? 1.1 : 1.25) + (candidate.immediateGain || 0);
    if (input.difficulty === 'novice') score = -candidate.shanten * unit * 20 + (candidate.shapeScore || 0) * unit * .02;
    if (input.difficulty === 'standard') score = -candidate.shanten * unit * 1000 + candidate.ukeire * unit + gain * .01 - cost;
    return { key: candidate.key, tile: candidate.tile, shanten: candidate.shanten, ukeire: candidate.ukeire,
      estimatedValue: candidate.estimatedValue, risk: danger.risk, lossIfDealIn: danger.lossIfDealIn, score };
  });
  metrics.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const winner = metrics[0];
  const minimum = Math.min(...metrics.map(candidate => candidate.shanten));
  return { key: winner.key, difficulty: input.difficulty, strategy: winner.shanten > minimum && winner.risk < .025 ? 'fold'
    : input.difficulty === 'novice' ? 'shape' : input.difficulty === 'standard' ? 'efficiency' : 'attack',
    candidates: metrics, searchNodes: 0, searchBudget: 0, provider: 'algorithm' };
}
