import Majiang from '@kobalab/majiang-core';
import type { MeldView } from '../types';
import { coreHand, countsOf, norm, tileCode } from './tiles';

export interface Decomposition { pair:string; sets:{type:'chi'|'pon';tile:string}[]; sevenPairs?:boolean; orphans?:boolean }
/** Exact concealed-hand decomposition, with a bounded 34-type joker substitution search. */
export function decompose(tiles:string[],melds:MeldView[]=[],sets=4,wildcard?:string,pair258=false):Decomposition[] {
  if(tiles.length !== (sets-melds.length)*3+2)return [];
  const normal=tiles.filter(t=>!wildcard||norm(t)!==norm(wildcard));
  const wild=tiles.length-normal.length, counts=countsOf(normal), results:Decomposition[]=[];
  if(!melds.length&&sets===4){
    const odd=counts.reduce((s,c)=>s+c%2,0);
    if(odd<=wild && ((wild-odd)%2===0))results.push({pair:'',sets:[],sevenPairs:true});
    const terminals=[0,8,9,17,18,26,27,28,29,30,31,32,33];
    if(normal.every(t=>terminals.includes('mpsz'.indexOf(t[0])*9+(Number(t[1])||5)-1))){
      const missing=terminals.filter(i=>!counts[i]).length;
      if(missing<=wild && (terminals.some(i=>counts[i]>=2)||wild>missing))results.push({pair:'',sets:[],orphans:true});
    }
  }
  const search=(left:number,jokers:number,formed:Decomposition['sets'],pair:string)=>{
    if(results.length>24)return;
    const first=counts.findIndex(n=>n>0);
    if(first<0){if(jokers===left*3)results.push({pair,sets:[...formed,...Array.from({length:left},()=>({type:'pon' as const,tile:wildcard||'m1'}))]});return;}
    if(left<=0)return;
    const take=Math.min(3,counts[first]);
    if(3-take<=jokers){counts[first]-=take;search(left-1,jokers-(3-take),[...formed,{type:'pon',tile:tileCode(first)}],pair);counts[first]+=take;}
    if(first<27){
      const rank=first%9;
      for(let start=Math.max(first-rank,first-2);start<=first&&start%9<=6;start++){
        const ids=[start,start+1,start+2];let missing=0;const used:number[]=[];
        for(const index of ids){if(counts[index]){counts[index]--;used.push(index);}else missing++;}
        if(missing<=jokers)search(left-1,jokers-missing,[...formed,{type:'chi',tile:tileCode(start)}],pair);
        used.forEach(index=>counts[index]++);
      }
    }
  };
  for(let pair=0;pair<34;pair++){
    if(pair258&&(pair>=27||![1,4,7].includes(pair%9)))continue;
    const take=Math.min(2,counts[pair]);if(2-take>wild)continue;
    counts[pair]-=take;search(sets-melds.length,wild-(2-take),[],tileCode(pair));counts[pair]+=take;
  }
  return results;
}

const distanceCache=new Map<string,number>();
export function shanten(tiles:string[],melds:MeldView[]=[],sets=4,wildcard?:string,sevenPairs=true,orphans=true):number {
  const key=[tiles.slice().sort().join(''),melds.length,sets,wildcard,sevenPairs,orphans].join('|');const cached=distanceCache.get(key);if(cached!==undefined)return cached;
  let result:number;
  if(sets===4&&!wildcard){const hand=coreHand(tiles,melds,tiles.length%3===2?tiles[tiles.length-1]:undefined);result=Math.min(Majiang.Util.xiangting_yiban(hand),sevenPairs?Majiang.Util.xiangting_qidui(hand):Infinity,orphans?Majiang.Util.xiangting_guoshi(hand):Infinity);}
  else {
    const filtered=tiles.filter(t=>!wildcard||norm(t)!==norm(wildcard)),jokers=tiles.length-filtered.length,counts=countsOf(filtered);
    let best=sets*2;let nodes=0;
    const dfs=(at:number,m:number,t:number,p:number)=>{
      if(++nodes>16000)return;
      while(at<34&&!counts[at])at++;
      const total=m+melds.length;
      if(at===34){best=Math.min(best,sets*2-total*2-Math.min(t,sets-total)-p);return;}
      if(counts[at]>=3&&total<sets){counts[at]-=3;dfs(at,m+1,t,p);counts[at]+=3;}
      if(at<27&&at%9<7&&counts[at+1]&&counts[at+2]){counts[at]--;counts[at+1]--;counts[at+2]--;dfs(at,m+1,t,p);counts[at]++;counts[at+1]++;counts[at+2]++;}
      if(counts[at]>=2){counts[at]-=2;if(!p)dfs(at,m,t,1);dfs(at,m,t+1,p);counts[at]+=2;}
      for(const step of [1,2])if(at<27&&at%9+step<9&&counts[at+step]){counts[at]--;counts[at+step]--;dfs(at,m,t+1,p);counts[at]++;counts[at+step]++;}
      counts[at]--;dfs(at,m,t,p);counts[at]++;
    };dfs(0,0,0,0);result=Math.max(-1,best-jokers);
    if(sevenPairs&&!melds.length&&sets===4)result=Math.min(result,6-counts.filter(c=>c>=2).length-jokers);
  }
  if(distanceCache.size>12000)distanceCache.clear();distanceCache.set(key,result);return result;
}
