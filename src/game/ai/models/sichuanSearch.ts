import { shanten } from '../../variants/hand';
import { visibleCounts } from '../evaluator';
import type { RegionalBotAction, RegionalBotInput } from '../regional';
import type { BotDecision, CandidateMetrics } from '../types';

interface SearchResult { value: number; nodes: number; complete: boolean }

/** Two successive own draws, weighted by publicly unseen copies, with a legal discard between them. */
function continuationValue(input: RegionalBotInput, action: RegionalBotAction, allowance: number): SearchResult {
  const hand = input.player.hand.filter((_, index) => index !== action.index);
  const known = visibleCounts(input.observation);
  const available = known.slice(0, 27).map((count, index) => Math.max(0, (input.observation.tileLimits?.[index] ?? 4) - count));
  const tiles = available.flatMap((count, index) => count ? ['mps'[Math.floor(index / 9)] + (index % 9 + 1)] : []);
  const indices = tiles.map(tile => 'mps'.indexOf(tile[0]) * 9 + Number(tile[1]) - 1);
  const cache = new Map<string, number>();
  let nodes = 0, complete = true;
  const distance = (tiles: string[]): number => {
    const key = tiles.slice().sort().join('');
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    if (++nodes > allowance) { complete = false; return Infinity; }
    const result = shanten(tiles, input.player.melds, 4, undefined, true, false);
    cache.set(key, result);
    return result;
  };
  const initial = distance(hand);
  const unseen = available.reduce((sum, count) => sum + count, 0);
  let total = 0;
  for (let drawIndex = 0; drawIndex < tiles.length && complete; drawIndex++) {
    const draw = tiles[drawIndex], physical = indices[drawIndex];
    const drawn = [...hand, draw];
    const next = distance(drawn);
    if (next >= initial) continue;
    const mustVoid = !!input.player.voidSuit && drawn.some(tile => tile[0] === input.player.voidSuit);
    const discards = [...new Set(drawn)].filter(tile => !mustVoid || tile[0] === input.player.voidSuit);
    const states = discards.map(tile => {
      const index = drawn.indexOf(tile), after = drawn.filter((_, at) => at !== index);
      return { hand: after, shanten: distance(after) };
    });
    const bestDistance = Math.min(...states.map(state => state.shanten));
    let bestUkeire = 0;
    for (const state of states.filter(state => state.shanten === bestDistance)) {
      let ukeire = 0;
      for (let second = 0; second < tiles.length && complete; second++) {
        const copies = available[indices[second]] - Number(indices[second] === physical);
        if (copies > 0 && distance([...state.hand, tiles[second]]) < state.shanten) ukeire += copies;
      }
      bestUkeire = Math.max(bestUkeire, ukeire);
    }
    total += available[physical] * bestUkeire;
  }
  return { value: total / Math.max(1, unseen), nodes: Math.min(nodes, allowance), complete };
}

/** The baseline remains the anchor. Only completed, equally bounded continuations can change its ordering. */
export function refineSichuanDiscards(input: RegionalBotInput, baseline: BotDecision, priority: RegionalBotAction[]): BotDecision {
  const baselineAction = input.actions.find(action => action.key === baseline.key);
  const anchor = baseline.candidates.find(candidate => candidate.key === baseline.key);
  if (baselineAction?.type !== 'discard' || !anchor || anchor.shanten < 1 || anchor.shanten > 3) return baseline;
  const byKey = new Map(baseline.candidates.map(candidate => [candidate.key, candidate]));
  const eligible = (action: RegionalBotAction) => {
    const candidate = byKey.get(action.key);
    return action.type === 'discard' && action.index != null && candidate?.metricsComplete !== false
      && candidate?.shanten === anchor.shanten && anchor.score - candidate.score <= 2;
  };
  const width = input.difficulty === 'expert' ? 4 : 2;
  const selected = [baselineAction], tileTypes = new Set([baselineAction.tile]);
  for (const action of priority) {
    if (!eligible(action) || tileTypes.has(action.tile)) continue;
    selected.push(action); tileTypes.add(action.tile);
    if (selected.length === width) break;
  }
  if (selected.length <= 1) return baseline;
  const allowance = input.difficulty === 'expert' ? 1800 : 1200;
  const values = new Map(selected.map(action => [action.key, continuationValue(input, action, allowance)]));
  const anchorSearch = values.get(baseline.key)!;
  const searched = { ...baseline,
    searchNodes: baseline.searchNodes + [...values.values()].reduce((sum, result) => sum + result.nodes, 0),
    searchBudget: baseline.searchBudget + selected.length * allowance };
  if (!anchorSearch.complete) return searched;
  const candidates: CandidateMetrics[] = baseline.candidates.map(candidate => {
    const continuation = values.get(candidate.key);
    if (!continuation?.complete) return candidate;
    const lookahead = (continuation.value - anchorSearch.value) * .3;
    return { ...candidate, score: candidate.score + lookahead, lookahead };
  });
  const winner = candidates.reduce((best, candidate) => candidate.score > best.score + 1e-9 ? candidate : best, anchor);
  candidates.sort((left, right) => right.score - left.score);
  return { ...searched, key: winner.key, strategy: 'search', candidates };
}
