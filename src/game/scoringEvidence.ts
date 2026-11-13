import type { ModeId, ScoringEvidence, TileCode, WinnerView, YakuView } from './types';

type PublicHand = Pick<WinnerView, 'hand' | 'melds' | 'flowers' | 'kita' | 'winningTile'>;
const norm = (tile: string) => tile[1] === '0' ? tile[0] + '5' : tile;
const indices = (length: number) => Array.from({ length }, (_, index) => index);

/** Explanations describe this application's scored item, never recalculate its value. */
const descriptions: Readonly<Record<string, string>> = {
  立直: '门前清听牌后宣告立直，并支付立直棒。', 两立直: '第一巡、无人鸣牌前宣告立直。',
  一发: '立直后的一巡内和牌，期间没有鸣牌打断。', 门前清自摸和: '门前清状态下自摸和牌；暗杠不破坏门前清。',
  海底捞月: '摸到牌山最后一张可摸牌后自摸。', 河底捞鱼: '荣和牌山最后一次摸牌之后打出的牌。',
  岭上开花: '杠后摸入补牌并自摸和牌。', 抢杠: '以他家补杠的牌和牌。', 抢杠胡: '以他家补杠的牌和牌。', 抢杠和: '以他家补杠的牌和牌。',
  杠上花: '杠后摸入补牌并自摸和牌。', 杠上开花: '杠后摸入补牌并自摸和牌。', 杠上炮: '他家杠后打出牌，由该张弃牌点和。',
  海底: '以牌山最后一轮的牌和牌。', 天和: '庄家以起手配牌自摸和牌。', 地和: '闲家在首次摸牌、无人鸣牌前自摸和牌。',
  天胡: '庄家起手即和，按本桌天胡规则计分。', 地胡: '无人鸣牌前，闲家以庄家首打点和，或首次摸牌自摸。',
  断幺九: '手牌和副露全部由二至八的数牌组成。', 断幺: '手牌和副露没有一、九或字牌。', 中张: '全部牌都是二至八的数牌。',
  平和: '门前清，四组顺子、非役牌对子，以两面听牌和牌。',
  一杯口: '门前清手牌中有两组完全相同的顺子。', 二杯口: '门前清手牌中有两对相同的顺子。',
  三色同顺: '万、筒、条各有一组数字相同的顺子。', 一气通贯: '同一花色组成一二三、四五六、七八九三组顺子。',
  混全带幺九: '每组面子与对子都含一、九或字牌，并且包含顺子与字牌。',
  纯全带幺九: '每组面子与对子都含一或九，并且包含顺子。',
  七对子: '由七种不同的对子组成，不能有副露。', 七对: '由七个对子组成；四张相同牌按本桌规则计作两对。',
  对对和: '四组刻子或杠，加一对将牌。', 碰碰胡: '面子全部是刻子或杠，加一对将牌。', 碰碰和: '四组刻子或杠，加一对将牌。',
  三暗刻: '有三组暗刻或暗杠；荣和完成的刻子不算暗刻。', 四暗刻: '四组暗刻或暗杠。', 四暗刻单骑: '四组暗刻或暗杠，单骑和入将牌。',
  三杠子: '有三副杠。', 四杠子: '有四副杠。', 三色同刻: '三种花色各有同一数字的刻子或杠。',
  混老头: '全部是幺九牌或字牌。', 清老头: '全部是一或九的数牌。',
  小三元: '三元牌中两种为刻子或杠，另一种为对子。', 大三元: '白板、发财、红中各组成刻子或杠。',
  小四喜: '四种风牌中三种为刻子或杠，另一种为对子。', 大四喜: '东、南、西、北各组成刻子或杠。',
  混一色: '仅使用一种数牌花色及字牌。', 清一色: '手牌和副露只使用同一种数牌花色。', 字一色: '全部由风牌及三元牌组成。',
  绿一色: '全部使用二、三、四、六、八条及发财。',
  国士无双: '十三种幺九牌、字牌各一张，其中一种为对子。', 国士无双十三面: '十三种幺九字牌各一张，和入任一种形成对子。', 十三幺: '十三种幺九字牌各一张，其中一种为对子。',
  九莲宝灯: '同一花色的一一一二三四五六七八九九九，加该花色任一张。', 纯正九莲宝灯: '听牌时已是九莲基础形，和入该花色任一张。',
  宝牌: '按宝牌指示牌的下一种牌计数；宝牌本身不构成役。', 赤宝牌: '手牌及副露里的红五，每张计一番宝牌。', 里宝牌: '立直和牌后按里宝牌指示牌的下一种牌计数。', 拔北宝牌: '拔出的北计入拔北宝牌，并按北对应的宝牌指示牌增加番数。',
  自摸: '由自己摸入的牌完成和牌。', 门清: '和牌时没有明吃、明碰或明杠；暗杠仍可保持门清。', 门前清: '和牌时没有明吃、明碰或明杠。',
  清碰: '同一花色组成碰碰胡，已包含清一色与碰碰胡。', 将对: '所有牌为二、五、八，且面子全部为刻子或杠。',
  金钩钓: '四组面子均已副露，手中只留一张单钓将牌。', 将金钩钓: '二、五、八组成金钩钓，已包含将对与金钩钓。',
  带幺九: '每组面子与将牌都包含一或九。', 清幺九: '同一花色，每组面子与将牌都包含一或九。',
  清七对: '同一花色组成七对，已包含清一色与七对。', 龙七对: '七对中含四张相同牌，基础番已包含一根。', 清龙七对: '同一花色组成龙七对，基础番已包含清一色、七对与一根。',
  十八罗汉: '四副杠加一对将牌，基础番已包含四根。', 清十八罗汉: '同一花色的四副杠加一对将牌，基础番已包含四根及清一色。',
  根: '同一种牌的四张都在本次和牌中；已包含在组合番型中的根不重复加番。',
  平胡: '符合本桌基本和牌牌形，按基础分结算。', 自摸平胡: '符合本桌基本和牌牌形并自摸。',
  硬胡: '和牌中没有使用百搭或赖子，按本桌规则加倍。', 爆头: '以百搭单钓形成爆头听牌，和牌后按本桌规则加倍。',
  将一色: '所有非赖子牌都是二、五、八。', 开口二五八将: '已有明副露，以二、五、八作将组成普通胡。', 二五八将小胡: '以二、五、八作将组成普通小胡。',
  开门三门齐有幺九: '已有明副露，万、筒、条齐全，含幺九或字牌，且至少有一组刻子或杠。',
  独听: '全部面子已副露，手中单钓将牌。', 无花: '本次和牌没有花牌。', 正花: '花牌编号对应和牌者当前座风，每张单独计分。', 一台花: '集齐同一组春夏秋冬或梅兰竹菊。',
  四杠: '有四副杠。', 三杠: '有三副杠。', 双暗杠: '有两副暗杠。', 双明杠: '有两副明杠。', 明暗杠: '有一副明杠和一副暗杠。', 暗杠: '有一副暗杠。', 明杠: '有一副明杠。',
  连七对: '同一花色七个连续数字各成一对。', 混幺九: '全部为幺九牌及字牌。',
  七星不靠: '七种字牌齐全，数牌来自互不相靠的组合龙花色。', 全不靠: '由字牌及组合龙数牌构成，数牌互不相靠，所有牌均不重复。',
  全双刻: '所有面子为偶数牌刻子或杠，将牌也是偶数牌。', 全大: '所有牌为七、八、九。', 全中: '所有牌为四、五、六。', 全小: '所有牌为一、二、三。', 大于五: '所有牌为六至九。', 小于五: '所有牌为一至四。',
  一色双龙会: '同一花色两组一二三、两组七八九，以五作将。', 三色双龙会: '两种花色各有一二三和七八九，第三种花色的五作将。',
  一色四同顺: '同一花色有四组相同顺子。', 一色三同顺: '同一花色有三组相同顺子。', 一色四节高: '同一花色有四组数字连续的刻子或杠。', 一色三节高: '同一花色有三组数字连续的刻子或杠。',
  一色四步高: '同一花色四组顺子的起点以相同的一步或两步递增。', 一色三步高: '同一花色三组顺子的起点以相同的一步或两步递增。',
  清龙: '同一花色组成一二三、四五六、七八九。', 花龙: '三种花色分别组成一二三、四五六、七八九。', 组合龙: '三种花色分别使用一四七、二五八、三六九，组成九张组合龙。',
  全带五: '每组面子和将牌都含五。', 三同刻: '三种花色各有同一数字的刻子或杠。', 三风刻: '三种风牌分别组成刻子或杠。', 推不倒: '全部牌都使用上下翻转后图案仍相同的牌种。',
  三色三同顺: '三种花色各有一组数字相同的顺子。', 三色三节高: '三种花色分别有数字依次递增的刻子或杠。', 三色三步高: '三种花色各有一组顺子，其起点数字依次递增。',
  无番和: '符合基本和牌形，且没有其他非花牌番种。', 妙手回春: '摸入牌山最后一张可摸牌自摸。',
  五门齐: '万、筒、条、风牌、三元牌五类齐全。', 全求人: '四组面子均明副露，单钓将牌点和。', 双箭刻: '两种三元牌分别组成刻子或杠。', 全带幺: '每组面子和将牌都含幺九或字牌。', 不求人: '没有明副露，以自摸完成和牌。', 和绝张: '和入的牌已有三张公开，是该牌最后一张。',
  箭刻: '白板、发财或红中组成刻子或杠。', 圈风刻: '本圈风牌组成刻子或杠。', 门风刻: '和牌者座风对应的牌组成刻子或杠。',
  四归一: '四张相同牌用于多个面子或将牌，没有组成杠。', 双同刻: '两种花色有相同数字的刻子或杠。', 双暗刻: '有两组暗刻或暗杠。',
  一般高: '同一花色的两组相同顺子。', 喜相逢: '两种花色数字相同的顺子。', 连六: '同一花色两组顺子首尾相接，形成六个连续数字。', 老少副: '同一花色的一二三与七八九。', 幺九刻: '一、九或风牌组成刻子或杠。', 缺一门: '数牌只使用两种花色。', 无字: '没有风牌和三元牌。',
  边张: '一二听三，或八九听七，以边张完成顺子。', 坎张: '和入顺子中间的一张。', 单钓将: '和入一张牌完成将牌对子。', 花牌: '一张公开花牌计一番；花牌不计入国标八番起和门槛。',
};

export function scoringDescription(name: string, mode: ModeId): string {
  if (mode === 'wuhan' && name === '清一色') return '除赖子外的牌只使用同一种数牌花色，赖子可补足和牌牌形。';
  if (mode === 'wuhan' && name === '字一色') return '除赖子外的牌全部为风牌及三元牌，赖子可补足和牌牌形。';
  if (mode === 'mcr' && name === '平和') return '四组顺子，数牌作将；按国标规则计分。';
  if (mode === 'mcr' && name === '海底捞月') return '以牌山最后一次摸牌后打出的牌点和。';
  if (mode === 'mcr' && name === '清幺九') return '全部是一、九数牌组成的刻子、杠及将牌。';
  if (mode === 'changsha' && name === '全求人') return '面子全部副露，手中单钓将牌，按本桌全求人计分。';
  if (/^(场风·|自风·)/.test(name)) return `${name.startsWith('场风') ? '本圈' : '自己座位'}对应的风牌组成刻子或杠。`;
  if (/^(役牌·|白板$|发财$|红中$)/.test(name)) return '对应三元牌组成刻子或杠。';
  if (name === '门风') return '自己座位对应的风牌组成刻子或杠。';
  if (name === '圈风') return '本圈对应的风牌组成刻子或杠。';
  if (name.startsWith('财飘')) return '爆头听牌时打出百搭的次数决定本次财飘倍数，最多按三次计。';
  if (name.startsWith('扎鸟')) return '和牌后翻出的鸟牌中，一、五、九每张增加一倍支付。';
  return descriptions[name] ?? '本项按当前玩法的和牌结果计分。';
}

export function selectPublicTiles(hand: PublicHand, text: string, matches: (tile: TileCode) => boolean): ScoringEvidence {
  return { text, hand: hand.hand.flatMap((tile, index) => matches(tile) ? [index] : []),
    melds: (hand.melds ?? []).flatMap((meld, index) => {
      const tiles = meld.tiles.flatMap((tile, slot) => matches(tile) ? [slot] : []);
      return tiles.length ? [{ index, tiles }] : [];
    }) };
}

const wholeHand = new Set(['平胡','自摸平胡','断幺九','断幺','中张','清一色','混一色','字一色','绿一色','七对子','七对','清七对','龙七对','清龙七对','国士无双','国士无双十三面','十三幺','九莲宝灯','纯正九莲宝灯','混老头','清老头','对对和','碰碰胡','碰碰和','清碰','将对','将一色','将金钩钓','带幺九','清幺九','金钩钓','十八罗汉','清十八罗汉','连七对','混幺九','七星不靠','全不靠','全双刻','全大','全中','全小','大于五','小于五','一色双龙会','三色双龙会','全带五','推不倒','五门齐','全带幺','缺一门','无字']);

/** Only facts independent of ambiguous decompositions are inferred for older results. */
export function publicScoringEvidence(hand: PublicHand, name: string, mode: ModeId): ScoringEvidence {
  const text = scoringDescription(name, mode);
  if (wholeHand.has(name)) return selectPublicTiles(hand, text, () => true);
  if (['大三元','小三元'].includes(name)) return selectPublicTiles(hand, text, tile => /^z[567]$/.test(tile));
  if (['大四喜','小四喜'].includes(name)) return selectPublicTiles(hand, text, tile => /^z[1234]$/.test(tile));
  const dragon = ({ 白板:'z5', 发财:'z6', 红中:'z7', '役牌·白板':'z5', '役牌·发财':'z6', '役牌·红中':'z7' } as Record<string,string>)[name];
  if (dragon) return selectPublicTiles(hand, text, tile => norm(tile) === dragon);
  if (/^(场风·|自风·)[东南西北]$/.test(name)) {
    const wind = 'z' + ('东南西北'.indexOf(name.at(-1)!) + 1);
    return selectPublicTiles(hand, text, tile => tile === wind);
  }
  if (name === '赤宝牌') return selectPublicTiles(hand, text, tile => tile[1] === '0');
  if (name === '拔北宝牌') return { text, ...(hand.kita ? { kita: true } : {}) };
  if (name === '根') {
    const counts = new Map<string, number>();
    for (const tile of [...hand.hand, ...(hand.melds ?? []).flatMap(meld => meld.tiles)]) counts.set(norm(tile), (counts.get(norm(tile)) ?? 0) + 1);
    return selectPublicTiles(hand, text, tile => counts.get(norm(tile)) === 4);
  }
  if (['三杠子','四杠子','三杠','四杠','十八罗汉','清十八罗汉'].includes(name)) return { text, melds: (hand.melds ?? []).flatMap((meld, index) => meld.type === 'kan' ? [{ index, tiles: indices(meld.tiles.length) }] : []) };
  if (['自摸','和绝张'].includes(name) && hand.winningTile) {
    const index = hand.hand.lastIndexOf(hand.winningTile);
    return { text, ...(index >= 0 ? { hand: [index] } : {}) };
  }
  return { text };
}

/** Preserve the selected Sichuan score; this runs once at the confirmed win only. */
export function sichuanEvidence(yaku: YakuView[], hand: PublicHand, mode: ModeId): YakuView[] {
  const roots = new Set([...hand.hand, ...(hand.melds ?? []).flatMap(meld => meld.tiles)].filter((tile, _, tiles) => tiles.filter(other => norm(other) === norm(tile)).length === 4).map(norm)).size;
  return yaku.map(item => {
    const evidence = publicScoringEvidence(hand, item.name, mode);
    if (item.name === '根' && typeof item.han === 'number') evidence.text = `本次共有 ${roots} 根，${roots > item.han ? `其中 ${roots - item.han} 根已包含在组合番型中，` : ''}另外计 ${item.han} 番。`;
    return { ...item, evidence };
  });
}

interface GbPack { type: number; tile: number | { GetId(): number }; offer: number; zuhelong: number }
interface GbResult { fans: { fanId: number; score: number; matchedPacks?: number[] }[]; decomposition?: { packs: GbPack[] } | null }
const fromGbTile = (id: number): string => id <= 9 ? 'm' + id : id <= 18 ? 's' + (id - 9) : id <= 27 ? 'p' + (id - 18) : 'z' + ({28:1,29:2,30:3,31:4,32:7,33:6,34:5} as Record<number,number>)[id];

/** Exact pack references supplied by the same MCR calculation that awarded the fan. */
export function mcrEvidence(result: GbResult, hand: PublicHand, names: string[], knitted: bigint[]): YakuView[] {
  const packs = result.decomposition?.packs ?? [];
  const winningIndex = hand.winningTile ? hand.hand.lastIndexOf(hand.winningTile) : -1;
  const winPack = packs.findIndex(pack => pack.offer < 0);
  const usedHand = new Set<number>(), usedMelds = new Set<number>();
  const references: (ScoringEvidence | undefined)[] = new Array(packs.length);
  const packTiles = packs.map(pack => {
    if (pack.type === 5) return indices(34).map(index => index + 1).filter(id => (knitted[pack.zuhelong] ?? 0n) & (1n << BigInt(id))).map(fromGbTile);
    const id = typeof pack.tile === 'number' ? pack.tile : pack.tile.GetId();
    return (pack.type === 1 ? [id - 1, id, id + 1] : Array(pack.type === 3 ? 4 : pack.type === 4 ? 2 : 3).fill(id)).map(fromGbTile);
  });
  // Reserve public declared melds before assigning any concealed tile instances.
  packs.forEach((pack, index) => {
    if (!(pack.offer > 0 || pack.type === 3)) return;
    const wanted = [...packTiles[index]].sort().join(',');
    const meld = (hand.melds ?? []).findIndex((item, slot) => !usedMelds.has(slot) && item.tiles.map(norm).sort().join(',') === wanted);
    if (meld < 0) return;
    usedMelds.add(meld); references[index] = { text: '', melds: [{ index: meld, tiles: indices(hand.melds![meld].tiles.length) }] };
  });
  packs.forEach((pack, index) => {
    if (references[index] || pack.offer > 0 || pack.type === 3) return;
    const chosen: number[] = [];
    for (const tile of packTiles[index]) {
      const reserved = index === winPack && winningIndex >= 0 && !usedHand.has(winningIndex) && norm(hand.hand[winningIndex]) === tile;
      const at = reserved ? winningIndex : hand.hand.findIndex((candidate, slot) => !usedHand.has(slot) && (winPack < 0 || index === winPack || slot !== winningIndex) && norm(candidate) === tile);
      if (at < 0) return;
      usedHand.add(at); chosen.push(at);
    }
    references[index] = { text: '', hand: chosen };
  });
  const allGroupsMapped = packs.length > 0 && indices(packs.length).every(index => references[index]) && usedHand.size === hand.hand.length && usedMelds.size === (hand.melds?.length ?? 0);
  let flower = 0;
  return result.fans.map(fan => {
    const name = names[fan.fanId];
    let evidence = publicScoringEvidence(hand, name, 'mcr');
    if (name === '花牌') {
      const slot = flower++;
      evidence = { text: scoringDescription(name, 'mcr'), ...(slot < (hand.flowers?.length ?? 0) ? { flowers: [slot] } : {}) };
    } else if (name === '四归一') {
      // This is about four copies, not every tile in the groups that contain them.
      // The current upstream scorer omits matchedPacks here; keep condition-only then.
      if (allGroupsMapped && fan.matchedPacks?.length && fan.matchedPacks.every(index => references[index])) {
        const counts = new Map<string, number>();
        for (const index of new Set(fan.matchedPacks)) for (const tile of packTiles[index]) counts.set(tile, (counts.get(tile) ?? 0) + 1);
        const candidates = [...counts].filter(([tile, count]) => count === 4 && !packs.some((pack, index) => pack.type === 3 && packTiles[index].includes(tile))).map(([tile]) => tile);
        if (candidates.length === 1) evidence = selectPublicTiles(hand, evidence.text, tile => norm(tile) === candidates[0]);
      }
    } else if (allGroupsMapped && fan.matchedPacks?.length && fan.matchedPacks.every(index => references[index])) {
      evidence = { text: scoringDescription(name, 'mcr'), hand: [], melds: [] };
      for (const index of fan.matchedPacks) {
        evidence.hand!.push(...(references[index]!.hand ?? []));
        evidence.melds!.push(...(references[index]!.melds ?? []));
      }
    }
    return { name, han: fan.score, evidence };
  });
}
