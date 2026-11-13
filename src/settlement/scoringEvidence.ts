import Majiang from '@kobalab/majiang-core';
import type { GameSnapshot, ScoringEvidence, WinnerView } from '../game/types';
import { publicScoringEvidence, scoringDescription, selectPublicTiles } from '../game/scoringEvidence';
import { coreHand } from '../game/variants/tiles';
import { displayYakuName } from '../presentation/scoringText';

const norm = (tile: string) => tile[1] === '0' ? tile[0] + '5' : tile;
const indices = (length: number) => Array.from({ length }, (_, index) => index);
interface Group { raw: string; tiles: string[]; kind: 'pair' | 'chi' | 'pon'; open: boolean }

function combinations(values: number[], count: number): number[][] {
  if (!count) return [[]];
  return values.flatMap((value, index) => combinations(values.slice(index + 1), count - 1).map(rest => [value, ...rest]));
}

function relevantGroups(groups: Group[], name: string): number[][] {
  const sets = indices(groups.length).filter(index => groups[index].kind !== 'pair');
  const sequences = sets.filter(index => groups[index].kind === 'chi');
  if (name === '一杯口' || name === '二杯口') {
    if (groups.some(group => group.open)) return [];
    const pairs = combinations(sequences, 2).filter(([left, right]) => groups[left].tiles.join() === groups[right].tiles.join());
    if (name === '一杯口') return pairs;
    return combinations(indices(pairs.length), 2).flatMap(([left, right]) => {
      const complete = [...new Set([...pairs[left], ...pairs[right]])];
      return complete.length === 4 ? [complete] : [];
    });
  }
  if (name === '一气通贯') return combinations(sequences, 3).filter(group => {
    const tiles = group.map(index => groups[index].tiles[0]);
    return new Set(tiles.map(tile => tile[0])).size === 1 && tiles.map(tile => tile[1]).sort().join('') === '147';
  });
  if (name === '三色同顺' || name === '三色同刻') {
    const candidates = name === '三色同顺' ? sequences : sets.filter(index => groups[index].kind === 'pon');
    return combinations(candidates, 3).filter(group => {
      const tiles = group.map(index => groups[index].tiles[0]);
      return tiles.every(tile => tile[0] !== 'z') && new Set(tiles.map(tile => tile[0])).size === 3 && new Set(tiles.map(tile => tile[1])).size === 1;
    });
  }
  if (['三暗刻', '四暗刻', '四暗刻单骑'].includes(name)) {
    const concealed = sets.filter(index => groups[index].kind === 'pon' && !groups[index].open && !/[+=-]!/.test(groups[index].raw));
    const count = name === '三暗刻' ? 3 : 4;
    if (concealed.length !== count) return [];
    return [[...concealed, ...(name === '四暗刻单骑' ? indices(groups.length).filter(index => groups[index].kind === 'pair') : [])]];
  }
  return [];
}

/** Attribute original public tile instances, keeping the actual winning tile in its group. */
function groupReferences(winner: WinnerView, groups: Group[]): ScoringEvidence[] | null {
  const references: ScoringEvidence[] = new Array(groups.length);
  const usedHand = new Set<number>(), usedMelds = new Set<number>();
  const winningIndex = winner.winningTile ? winner.hand.lastIndexOf(winner.winningTile) : -1;
  const winningGroup = groups.findIndex(group => group.raw.includes('!'));
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    if (!group.open && group.tiles.length !== 4) continue;
    const meld = (winner.melds ?? []).findIndex((candidate, slot) => !usedMelds.has(slot) && candidate.tiles.map(norm).sort().join() === [...group.tiles].sort().join());
    if (meld < 0) return null;
    usedMelds.add(meld);
    references[index] = { text: '', melds: [{ index: meld, tiles: indices(winner.melds![meld].tiles.length) }] };
  }
  for (let index = 0; index < groups.length; index++) {
    if (references[index]) continue;
    const selected: number[] = [];
    for (const tile of groups[index].tiles) {
      const reserved = index === winningGroup && winningIndex >= 0 && !usedHand.has(winningIndex) && norm(winner.hand[winningIndex]) === tile;
      const at = reserved ? winningIndex : winner.hand.findIndex((candidate, slot) => !usedHand.has(slot) && (winningGroup < 0 || index === winningGroup || slot !== winningIndex) && norm(candidate) === tile);
      if (at < 0) return null;
      usedHand.add(at); selected.push(at);
    }
    references[index] = { text: '', hand: selected };
  }
  return usedHand.size === winner.hand.length ? references : null;
}

function canonical(evidence: ScoringEvidence): ScoringEvidence {
  return { text: evidence.text, hand: [...new Set(evidence.hand ?? [])].sort((a, b) => a - b),
    melds: (evidence.melds ?? []).map(meld => ({ index: meld.index, tiles: [...new Set(meld.tiles)].sort((a, b) => a - b) })).sort((a, b) => a.index - b.index) };
}

/** Only show a complete, identical set of tiles across all forms compatible with this awarded yaku. */
function riichiStructure(winner: WinnerView, name: string, text: string): ScoringEvidence | null {
  if (!['一杯口','二杯口','一气通贯','三色同顺','三色同刻','三暗刻','四暗刻','四暗刻单骑'].includes(name) || !winner.winningTile) return null;
  const concealed = [...winner.hand];
  const at = concealed.lastIndexOf(winner.winningTile);
  if (at < 0) return null;
  if (winner.fromId != null) concealed.splice(at, 1);
  try {
    const shoupai = coreHand(concealed, winner.melds ?? [], winner.fromId == null ? winner.winningTile : undefined);
    const forms: string[][] = Majiang.Util.hule_mianzi(shoupai, winner.fromId == null ? null : winner.winningTile + '+');
    const candidates: ScoringEvidence[] = [];
    for (const form of forms) {
      if (form.length !== 5) continue;
      const groups: Group[] = form.map(raw => {
        const digits = raw.slice(1).replace(/\D/g, '').replace(/0/g, '5');
        return { raw, tiles: [...digits].map(digit => raw[0] + digit), kind: digits.length === 2 ? 'pair' : new Set(digits).size === 1 ? 'pon' : 'chi', open: /[+=-]/.test(raw) && !raw.includes('!') };
      });
      const matches = relevantGroups(groups, name);
      if (!matches.length) continue;
      const references = groupReferences(winner, groups);
      if (!references) return null;
      for (const match of matches) candidates.push(canonical({ text, hand: match.flatMap(index => references[index].hand ?? []), melds: match.flatMap(index => references[index].melds ?? []) }));
    }
    if (!candidates.length) return null;
    const first = JSON.stringify(candidates[0]);
    return candidates.every(candidate => JSON.stringify(candidate) === first) ? candidates[0] : null;
  } catch { return null; }
}

/** Called on an opened scoring item only; never used by hints or AI evaluation. */
export function explainScoringItem(winner: WinnerView, snapshot: GameSnapshot, yakuIndex: number): ScoringEvidence {
  const item = winner.yaku[yakuIndex];
  if (!item) return { text: '' };
  if (item.evidence) return item.evidence;
  const mode = snapshot.mode ?? 'riichi';
  const name = displayYakuName(item.name, mode);
  const evidence = publicScoringEvidence(winner, name, mode);
  const japanese = mode === 'riichi' || mode === 'sanma';
  if (japanese) {
    if (name === '宝牌' || name === '里宝牌') {
      const indicators = name === '宝牌' ? snapshot.round.doraIndicators : snapshot.round.uraIndicators;
      const dora = new Set(indicators.map(tile => Majiang.Shan.zhenbaopai(mode === 'sanma' && tile === 'm1' ? 'm8' : tile)));
      return selectPublicTiles(winner, evidence.text, tile => dora.has(norm(tile)));
    }
    if (['平和','混全带幺九','纯全带幺九'].includes(name)) return selectPublicTiles(winner, evidence.text, () => true);
    return riichiStructure(winner, name, evidence.text) ?? evidence;
  }
  if (name === '花牌') {
    const slot = winner.yaku.slice(0, yakuIndex).filter(yaku => yaku.name === '花牌').length;
    return { text: evidence.text, ...(slot < (winner.flowers?.length ?? 0) ? { flowers: [slot] } : {}) };
  }
  const seatWind = snapshot.players.find(player => player.id === winner.playerId)?.wind;
  const seat = seatWind ? '东南西北'.indexOf(seatWind) : -1;
  if (name === '正花' && seat >= 0) return { text: evidence.text, flowers: (winner.flowers ?? []).flatMap((tile, index) => (Number(tile[1]) - 1) % 4 === seat ? [index] : []) };
  if (name === '一台花') {
    const sets = [1, 5].filter(start => indices(4).every(index => winner.flowers?.includes('f' + (start + index))));
    const occurrence = winner.yaku.slice(0, yakuIndex).filter(yaku => yaku.name === '一台花').length;
    const start = sets[occurrence];
    return { text: evidence.text, ...(start ? { flowers: (winner.flowers ?? []).flatMap((tile, index) => Number(tile[1]) >= start && Number(tile[1]) < start + 4 ? [index] : []) } : {}) };
  }
  if (['门风','门风刻','圈风','圈风刻'].includes(name)) {
    const wind = name.startsWith('门') ? seat : snapshot.round.wind ? '东南西北'.indexOf(snapshot.round.wind) : -1;
    if (wind >= 0) return selectPublicTiles(winner, scoringDescription(name, mode), tile => tile === 'z' + (wind + 1));
  }
  return evidence;
}
