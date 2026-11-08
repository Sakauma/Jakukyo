import Majiang from '@kobalab/majiang-core';
import type { MeldView, TileCode } from '../types';

export const SUITS = ['m','p','s'];
export const WINDS = ['东','南','西','北'];
export const norm = (tile: string): string => tile.slice(0,2).replace('0','5');
export const tileIndex = (tile: string): number => 'mpsz'.indexOf(tile[0]) * 9 + (Number(tile[1]) || 5) - 1;
export const tileCode = (index: number): string => 'mpsz'[Math.floor(index/9)] + (index%9+1);
export const isTerminal = (tile: string): boolean => tile[0] === 'z' || [1,9].includes(Number(tile[1]) || 5);
export const is258 = (tile: string): boolean => tile[0] !== 'z' && [2,5,8].includes(Number(tile[1]) || 5);
export function tileLabel(tile: string): string {
  if (tile[0] === 'f') return ['','梅','兰','竹','菊','春','夏','秋','冬'][Number(tile[1])] || '花';
  if (tile[0] === 'z') return ['','东','南','西','北','白','发','中'][Number(tile[1])] || tile;
  return `${tile[1] === '0' ? '赤' : ''}${['','一','二','三','四','五','六','七','八','九'][Number(tile[1]) || 5]}${({m:'万',p:'筒',s:'条'} as Record<string,string>)[tile[0]] || ''}`;
}
export function sortTiles(tiles: string[]): string[] { return [...tiles].sort((a,b)=>tileIndex(a)-tileIndex(b)||a.localeCompare(b)); }
export function countsOf(tiles: string[]): number[] { const counts=Array(34).fill(0);for(const tile of tiles)if(tile[0]!=='f')counts[tileIndex(tile)]++;return counts; }
export function seededRandom(seed: string): () => number {
  let value=2166136261;for(const char of seed)value=Math.imul(value^char.charCodeAt(0),16777619);
  return ()=>{value+=0x6D2B79F5;let t=Math.imul(value^value>>>15,1|value);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};
}
export function makeTiles(options:{honors?:boolean;flowers?:boolean;sanma?:boolean;red?:boolean}={}): TileCode[] {
  const tiles:string[]=[];
  for(const suit of ['m','p','s',...(options.honors===false?[]:['z'])])for(let n=1;n<=(suit==='z'?7:9);n++){
    if(options.sanma&&suit==='m'&&n!==1&&n!==9)continue;
    for(let c=0;c<4;c++)tiles.push(suit+((options.red&&suit!=='z'&&n===5&&c===0)?0:n));
  }
  if(options.flowers)for(let n=1;n<=8;n++)tiles.push('f'+n);
  return tiles;
}
export function shuffle(tiles:string[],random:()=>number): string[] { const copy=[...tiles];for(let i=copy.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}return copy; }
export function coreMeld(meld:MeldView):string {
  const digits=sortTiles(meld.tiles).map(tile=>tile[1]).join('');
  return meld.tiles[0][0]+digits+(meld.concealed?'':meld.type==='chi'?'-':'+');
}
export function coreString(tiles:string[],melds:MeldView[]=[],drawn?:string):string {
  const rest=[...tiles];if(drawn){const at=rest.lastIndexOf(drawn);if(at>=0)rest.splice(at,1);}
  let text='';for(const suit of 'mpsz'){const numbers=sortTiles(rest.filter(t=>t[0]===suit)).map(t=>t[1]).join('');if(numbers)text+=suit+numbers;}
  if(drawn)text+=drawn;
  return text+melds.map(meld=>','+coreMeld(meld)).join('');
}
export function coreHand(tiles:string[],melds:MeldView[]=[],drawn?:string):any { return Majiang.Shoupai.fromString(coreString(tiles,melds,drawn)); }
