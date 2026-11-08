import type { ModeId } from '../game/types';

/** Display aliases only. Engine identifiers and saved results retain their original names. */
const riichiTerms: Readonly<Record<string, string>> = {
  ダブル立直: '两立直',
  一発: '一发',
  海底摸月: '海底捞月',
  河底撈魚: '河底捞鱼',
  嶺上開花: '岭上开花',
  槍槓: '抢杠',
  門前清自摸和: '门前清自摸和',
  '場風 東': '场风·东',
  '場風 南': '场风·南',
  '場風 西': '场风·西',
  '場風 北': '场风·北',
  '自風 東': '自风·东',
  '自風 南': '自风·南',
  '自風 西': '自风·西',
  '自風 北': '自风·北',
  '翻牌 白': '役牌·白板',
  '翻牌 發': '役牌·发财',
  '翻牌 中': '役牌·红中',
  一盃口: '一杯口',
  三色同順: '三色同顺',
  一気通貫: '一气通贯',
  混全帯幺九: '混全带幺九',
  七対子: '七对子',
  対々和: '对对和',
  三槓子: '三杠子',
  混老頭: '混老头',
  純全帯幺九: '纯全带幺九',
  二盃口: '二杯口',
  国士無双十三面: '国士无双十三面',
  国士無双: '国士无双',
  四暗刻単騎: '四暗刻单骑',
  緑一色: '绿一色',
  清老頭: '清老头',
  四槓子: '四杠子',
  純正九蓮宝燈: '纯正九莲宝灯',
  九蓮宝燈: '九莲宝灯',
  ドラ: '宝牌',
  赤ドラ: '赤宝牌',
  裏ドラ: '里宝牌',
  荒牌平局: '荒牌流局',
  流し満貫: '流局满贯',
  九種九牌: '九种九牌',
  三家和: '三家和牌流局',
  三家和了: '三家和牌流局',
  四風連打: '四风连打',
  四開槓: '四杠散了',
  自摸和了: '自摸和牌',
};

const isRiichi = (mode: ModeId) => mode === 'riichi' || mode === 'sanma';
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Match full terms first, so red/ura dora and double-yakuman names stay intact.
const termPattern = new RegExp(Object.keys(riichiTerms).sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'), 'g');

export function displayYakuName(name: string, mode: ModeId = 'riichi'): string {
  return isRiichi(mode) ? riichiTerms[name] ?? name : name;
}

/** For engine-generated prose only; never pass player names or user-defined replay titles alone. */
export function displayScoringText(text: string, mode: ModeId = 'riichi', playerNames: readonly string[] = []): string {
  if (!isRiichi(mode)) return text;
  const protectedRanges: Array<{ start: number; end: number }> = [];
  for (const name of playerNames) {
    if (!name) continue;
    let start = text.indexOf(name);
    while (start !== -1) {
      protectedRanges.push({ start, end: start + name.length });
      start = text.indexOf(name, start + name.length);
    }
  }
  return text.replace(termPattern, (term: string, offset: number) =>
    protectedRanges.some(range => offset < range.end && offset + term.length > range.start)
      ? term : riichiTerms[term]);
}
