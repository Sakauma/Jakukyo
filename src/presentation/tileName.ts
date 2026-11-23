import { flowerName } from '../game/flowerName';

const numerals = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const honors = ['?', '東', '南', '西', '北', '白', '發', '中'];
export function tileName(code:string) {
  const suit=code[0], rank=Number(code[1]);
  if(suit==='z') return honors[rank] ?? code;
  if(suit==='f') return flowerName(code);
  return `${rank===0 ? '赤五' : numerals[rank]}${suit==='m' ? '万' : suit==='p' ? '筒' : '条'}`;
}
