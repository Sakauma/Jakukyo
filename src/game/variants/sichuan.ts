import type { SichuanOptions } from '../types';

export const DEFAULT_SICHUAN_OPTIONS: Readonly<SichuanOptions> = Object.freeze({
  version: 2, fanCap: 4, selfDraw: 'base', menqingZhongzhang: false,
});
const CAPS = [3, 4, 5, 6, 8, 'none'] as const;
const KEYS = new Set(['version', 'fanCap', 'selfDraw', 'menqingZhongzhang']);

/** Accept partial user options while rejecting malformed or unsupported saved data. */
export function validSichuanOptions(value: unknown): value is Partial<SichuanOptions> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (Object.keys(entry).some(key => !KEYS.has(key))) return false;
  if (entry.version !== undefined && entry.version !== 1 && entry.version !== 2) return false;
  if (entry.fanCap !== undefined && !CAPS.includes(entry.fanCap as SichuanOptions['fanCap'])) return false;
  if (entry.selfDraw !== undefined && entry.selfDraw !== 'base' && entry.selfDraw !== 'fan') return false;
  if (entry.menqingZhongzhang !== undefined && typeof entry.menqingZhongzhang !== 'boolean') return false;
  return entry.version !== 1 || (entry.fanCap === undefined || entry.fanCap === 4)
    && (entry.selfDraw === undefined || entry.selfDraw === 'base')
    && (entry.menqingZhongzhang === undefined || entry.menqingZhongzhang === false);
}

/** A missing historical configuration is v1 only when requested by the loader. */
export function normalizeSichuanOptions(value: unknown, fallbackVersion: 1 | 2 = 2): SichuanOptions {
  const entry = validSichuanOptions(value) ? value : {};
  const version = entry.version ?? fallbackVersion;
  if (version === 1) return { version: 1, fanCap: 4, selfDraw: 'base', menqingZhongzhang: false };
  return { version: 2, fanCap: entry.fanCap ?? 4, selfDraw: entry.selfDraw ?? 'base', menqingZhongzhang: entry.menqingZhongzhang ?? false };
}

/** Uncapped tables use the highest possible ordinary ron, without transient bonuses. */
export function sichuanFlowerPigPayment(options: SichuanOptions): number {
  if (options.fanCap !== 'none') return 2 ** options.fanCap;
  // Pure four-kong hand: 8 fan; four concealed kongs can add menqing and zhongzhang.
  return 2 ** (options.menqingZhongzhang ? 10 : 8);
}

/** Scoring details only; a mode also supplies its own blood/river flow. */
export function sichuanRuleSummary(options: SichuanOptions): string[] {
  if (options.version === 1) return [
    '旧版计番：平胡0番、碰碰胡1番、七对2番、清一色2番；金钩钓另加2番，仍叠加碰碰胡。每根、杠上花、抢杠胡及海底各加1番。',
    '每底1分，初始分不参与倍数计算；基本分按4番封顶，自摸每位付款者另加1底。全桌最多四杠。',
  ];
  return [
    '平胡0番、碰碰胡1番、带幺九2番、七对2番、清一色2番、清碰3番、清七对4番、清幺九4番。',
    '金钩钓2番含碰碰胡，将对3番、将金钩钓4番；龙七对4番、清龙七对5番均含一根。',
    '十八罗汉6番、清十八罗汉8番均含四根；其他根每根1番。杠上花、抢杠胡、杠上炮、海底各加1番。',
    options.menqingZhongzhang
      ? '门清与中张各加1番；暗杠不破门清，七对不叠门清，将对系列不叠中张。'
      : '门清与中张加番关闭。',
    '无鸣牌且此前无人和牌时，庄家首摸自摸为天胡；闲家首摸自摸或和庄家首张弃牌为地胡。',
    `天胡、地胡基础5番，不叠其他牌型、根或事件番；每底1分，初始分不参与倍数计算。${options.fanCap === 'none' ? '基本分不封顶' : `基本分按${options.fanCap}番封顶`}；${options.selfDraw === 'base' ? '自摸每位付款者另加1底。' : `自摸加1番${options.fanCap === 'none' ? '' : '并计入封顶'}，不另加底。`}`,
    `流局查大叫按普通点和最高番结算；${options.fanCap === 'none' ? '花猪按本桌最高普通点和向应赔付者每家支付' : '花猪向应赔付者每家支付'}${sichuanFlowerPigPayment(options)}分。`,
  ];
}
