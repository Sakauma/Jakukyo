import Majiang from '@kobalab/majiang-core';
import GB from 'gb-mahjong-js/lib/api/index.js';
import GBConstants from 'gb-mahjong-js/lib/core/constants.js';
import type { MeldView, ModeId, SichuanOptions, SichuanScore, YakuView } from '../types';
import { coreHand, countsOf, is258, isTerminal, makeTiles, norm, tileIndex } from './tiles';
import { decompose } from './hand';
import type { Decomposition, HandSearchBudget } from './hand';
import { normalizeSichuanOptions } from './sichuan';
import { noYakuReason } from '../ronNotice';
import { REGIONAL_START_POINTS } from '../startingPoints';
import { mcrEvidence, sichuanEvidence } from '../scoringEvidence';

export interface RuleProfile {
  id:ModeId; players:3|4; sets:4|5; honors:boolean; flowers:boolean; chi:boolean;
  startPoints:number; deadWall:number; wild:boolean; selfDrawOnly:boolean;
  sevenPairs:boolean; orphans:boolean; voidSuit:boolean; continuing:'none'|'blood'|'river';
  minimumFan:number; summary:string[];
  maxKongs: number | null;
}
const common={players:4 as const,sets:4 as const,honors:true,flowers:false,chi:true,startPoints:REGIONAL_START_POINTS,deadWall:0,wild:false,selfDrawOnly:false,sevenPairs:false,orphans:false,voidSuit:false,continuing:'none' as const,minimumFan:0,maxKongs:null};
export const PROFILES:Record<Exclude<ModeId,'riichi'>,RuleProfile>={
  sanma:{...common,id:'sanma',players:3,maxKongs:4,startPoints:35000,deadWall:14,chi:false,sevenPairs:true,orphans:true,minimumFan:1,summary:['三人、108张；去二至八万，筒条各一张赤五；35,000点起。','不能吃牌；北可留作普通牌或拔北，补牌并增加1番宝牌；拔北不算役。','采用自摸损：北家的支付不由其他人补足；立直、振听、里宝牌适用。','立直后只可拔摸入的北；拔北会打断一发，不能抢北。','流局总罚符3,000点；本场荣和加300，自摸每家加100；东南各三局。','固定局数桌：庄和、庄听连庄；不启用40,000点返入延长或终局和止。','不启用九种九牌、四杠散了及流局满贯；一局最多四杠。']},
  mcr:{...common,id:'mcr',flowers:true,sevenPairs:true,orphans:true,minimumFan:8,summary:['144张含8花；四面子一将，亦支持国标特殊牌形。','采用81番种与组合排斥；至少8番起和，花牌番不计入起和门槛。','自摸每家支付8+番数；点和放铳者支付8+番数，其余两家各支付8。','允许吃碰杠、抢杠；同一弃牌多人和时采用最近者优先（截和）。','每局按顺序轮庄，不连庄；本应用采用东圈/东南圈短局，不作赛事名次分。']},
  'sichuan-blood':{...common,id:'sichuan-blood',honors:false,chi:false,sevenPairs:true,voidSuit:true,continuing:'blood',summary:['108张万筒条；先定缺，持有缺门牌时必须优先打出，缺门未清不得碰、杠、和。','默认不换三张；可开启同花色换三张，固定向下家交换。','不能吃；允许碰、暗杠、补杠、直杠及抢补杠；一炮多响。','和牌者退出本局，直到三家和牌或摸完牌。','流局查花猪与查大叫；未听者退还本局所得杠分；不计呼叫转移。']},
  'sichuan-river':{...common,id:'sichuan-river',honors:false,chi:false,sevenPairs:true,voidSuit:true,continuing:'river',summary:['108张；定缺、可选同花色换三张，缺门必须先出；缺门未清不得碰、杠、和。','和牌后仍继续摸打，可在同一局多次和牌，直到牌山耗尽。','自摸和后打出一张再继续；点和保留原手牌，不能重复响应同一弃牌。','碰杠与一炮多响。','流局对尚未和过的未听者查叫及退杠；缺门未清者查花猪。']},
  hongkong:{...common,id:'hongkong',flowers:true,orphans:true,minimumFan:3,summary:['港式清章固定桌规：144张含花，三番起和，十番封顶。','基本和形为四面子一将，另支持十三幺；不采用七对子。','混一色3番、碰碰胡3番、清一色7番；役牌、门清、自摸及正花计番。','点和由放铳者支付，自摸其余各家支付；不启用包牌、辣辣上与满贯罚则。']},
  guangdong:{...common,id:'guangdong',sevenPairs:true,orphans:true,summary:['无鬼推倒胡固定桌规：136张，无花、无百搭，不设起和番门槛。','允许吃碰杠；平胡1分，七对、碰碰胡、混一色与清一色加倍。','点和由放铳者支付，自摸三家支付；一炮多响。','杠牌只补牌，不单独收取杠分；无买马、包牌或荒庄翻倍。']},
  taiwan:{...common,id:'taiwan',sets:5,flowers:true,deadWall:16,summary:['十六张，五面子一将（和牌17张）；144张，花牌自动补花。','门清、自摸、正花、风牌和三元牌计台；碰碰胡4台，混一色4台，清一色8台。','采用底1分、每台1分；庄家收付额外1+2×连庄数，庄家和牌或流局连庄。','保留16张不摸；不采用特殊花胡、天听、拉庄或包牌规则。']},
  hangzhou:{...common,id:'hangzhou',wild:true,selfDrawOnly:true,sevenPairs:true,summary:['杭州固定桌规：136张，开局翻示一张牌，该牌下一种为百搭。','百搭可替代任意牌，不能用于吃碰杠；只允许自摸和牌及抢补杠。','平胡1分、七对2分；硬胡及爆头各加倍，庄家收付加倍。','爆头听牌时打百搭为财飘，此后保留爆头形的每次财飘再加倍（最多3次）。','不采用三摊承包或特殊责任支付；翻示牌和完整桌规均公开。']},
  wuhan:{...common,id:'wuhan',wild:true,sevenPairs:false,summary:['武汉固定桌规：136张；翻牌下一种为赖子，赖子不可吃碰杠。','普通胡须二五八将且至少有一次明吃碰杠；暗杠不算开口。','碰碰胡、清一色、将一色等大胡不受二五八将限制，仍须开口。','赖子手只能自摸；硬胡（没有赖子）加倍；不采用红中发财、口口翻与封顶混合玩法。']},
  changsha:{...common,id:'changsha',sevenPairs:true,summary:['长沙固定桌规：136张，普通小胡须二五八将。','七对、碰碰胡、清一色、将一色、全求人及杠上花属大胡，无二五八将限制。','小胡1分，大胡6分，按本桌列出的牌型叠加；一炮多响。','和牌后从牌山扎2鸟：一五九（含东白）中鸟，每只令支付加1倍。','不采用起手小胡、通炮、报听及海底漫游扩展。']},
  northeast:{...common,id:'northeast',summary:['哈尔滨基础开门桌：136张，无花无宝；须开门（至少一组明吃碰杠）。','和牌须万筒条三门齐、有幺九、至少一副刻子或杠；不能七对。','普通和牌1分，自摸加倍，门前仅可先吃碰再和。','不采用立蛋、飘胡、滚宝、会牌与地方包庄扩展。']},
};
export const getProfile=(mode:ModeId):RuleProfile=>PROFILES[mode as keyof typeof PROFILES];
export function profileTiles(profile:RuleProfile):string[]{return makeTiles({honors:profile.honors,flowers:profile.flowers,sanma:profile.id==='sanma',red:profile.id==='sanma'});}
export interface ScoringPlayer { hand:string[];melds:MeldView[];flowers:string[];voidSuit?:string;riichi:boolean;doubleRiichi?:boolean;ippatsu?:boolean;kita:number;floatCount?:number }
export interface ScoreContext {
  profile:RuleProfile;player:ScoringPlayer;selfDraw:boolean;winningTile:string;seat:number;roundWind:number;
  wildcard?:string;lastTile?:boolean;kongDraw?:boolean;robbingKong?:boolean;
  dora?:string[];ura?:string[];visibleWinningCopies?:number;firstDraw?:boolean;
  rulesVersion?:1|2;sichuan?:SichuanOptions;kongDiscard?:boolean;heavenlyWin?:'heaven'|'earth';
  /** Explanation references are captured at an actual win, never during AI search. */
  captureEvidence?:boolean;
}
export interface HandScore {fan:number;fu:number;base:number;yakuman:number;yaku:YakuView[];payments?:number[];birds?:string[];sichuanScore?:SichuanScore}
const ceil100=(n:number)=>Math.ceil(n/100)*100;
export function sanmaValue(fan:number,fu:number,yakuman:number,seat:number,selfDraw:boolean):{base:number;payments:number[]}{
  const basic=yakuman?8000*yakuman:fan>=13?8000:fan>=11?6000:fan>=8?4000:fan>=6?3000:fan>=5?2000:Math.min(2000,fu*2**(fan+2));
  const payments=[0,0,0];
  if(selfDraw)for(let s=0;s<3;s++)if(s!==seat)payments[s]=ceil100(basic*(s===0||seat===0?2:1));
  return {base:selfDraw?payments.reduce((a,b)=>a+b,0):ceil100(basic*(seat===0?6:4)),payments};
}
function japaneseScore(c:ScoreContext,reasons?:string[]):HandScore|null {
  const hand=coreHand(c.player.hand,c.player.melds,c.selfDraw?c.winningTile:undefined);
  const indicator=(tile:string)=>tile==='m1'?'m8':tile;
  const result=Majiang.Util.hule(hand,c.selfDraw?null:c.winningTile+'+',Majiang.Util.hule_param({
    zhuangfeng:c.roundWind,menfeng:c.seat,lizhi:c.player.riichi?(c.player.doubleRiichi?2:1):0,yifa:!!c.player.ippatsu,
    qianggang:!!c.robbingKong,lingshang:!!c.kongDraw,haidi:c.lastTile&&!((c.rulesVersion??2)>=2&&c.kongDraw)?(c.selfDraw?1:2):0,
    tianhu:c.firstDraw&&c.selfDraw?(c.seat===0?1:2):0,
    baopai:(c.dora||[]).map(indicator),fubaopai:c.player.riichi?(c.ura||[]).map(indicator):null,
  }));
  if(!result?.defen){
    if(reasons&&!c.selfDraw&&Majiang.Util.xiangting(hand.clone().zimo(c.winningTile))===-1)reasons.push(noYakuReason(c.player.melds.every(m=>m.concealed)));
    return null;
  }
  const bonus=c.player.kita*(1+(c.dora||[]).filter(t=>t==='z3').length+(c.player.riichi?(c.ura||[]).filter(t=>t==='z3').length:0));
  const fan=(result.fanshu||0)+(result.damanguan?0:bonus),fu=result.fu||0,yaku=result.hupai.map((h:any)=>({name:h.name,han:h.fanshu}));
  if(bonus&&!result.damanguan)yaku.push({name:'拔北宝牌',han:bonus});
  return {fan,fu,yakuman:result.damanguan||0,yaku,...sanmaValue(fan,fu,result.damanguan||0,c.seat,c.selfDraw)};
}
const gbTile=(tile:string)=>tile[0]==='z'?['','E','S','W','N','P','F','C'][Number(tile[1])]:`${Number(tile[1])||5}${tile[0]}`;
export interface McrHandEvaluation {
  fan: number;
  nonFlowerFan: number;
  yaku: YakuView[];
}

/** Shared by legal wins and previews, including national-standard special shapes. */
export function evaluateMcrHand(c: ScoreContext): McrHandEvaluation | null {
  const hand = [...c.player.hand];
  if (c.selfDraw) {
    const drawnIndex = hand.lastIndexOf(c.winningTile);
    if (drawnIndex >= 0) hand.splice(drawnIndex, 1);
  }
  const packs = c.player.melds.map(meld => {
    const tiles = meld.tiles[0][0] === 'z'
      ? meld.tiles.map(gbTile).join('')
      : meld.tiles.map(tile => Number(tile[1]) || 5).join('') + meld.tiles[0][0];
    return '[' + tiles + (meld.concealed ? '' : ',1') + ']';
  }).join('');
  const context = 'ESWN'[c.roundWind % 4] + 'ESWN'[c.seat]
    + (c.selfDraw ? '1' : '0') + (c.visibleWinningCopies === 3 ? '1' : '0')
    + (c.lastTile ? '1' : '0') + (c.kongDraw || c.robbingKong ? '1' : '0');
  const flowers = c.player.flowers.map(tile => 'abcdefgh'[Number(tile[1]) - 1]).join('');
  try {
    const result = GB.countFan(packs + hand.map(gbTile).join('') + gbTile(c.winningTile) + '|' + context + '|' + flowers);
    if (!result.isHu) return null;
    const nonFlowerFan = result.fans.filter((fan: any) => fan.fanId !== GBConstants.FAN_HUAPAI)
      .reduce((total: number, fan: any) => total + fan.score, 0);
    let yaku:YakuView[] = result.fans.map((fan: any) => ({ name: GBConstants.FAN_NAME[fan.fanId], han: fan.score }));
    if(c.captureEvidence){
      // Explanatory metadata must never change the already-confirmed scoring result.
      try { yaku=mcrEvidence(result,{hand:[...c.player.hand,...(c.selfDraw?[]:[c.winningTile])],melds:c.player.melds,flowers:c.player.flowers,winningTile:c.winningTile},GBConstants.FAN_NAME,GBConstants.ZuhelongBitmap); } catch { /* Older scorer shapes retain ordinary scoring rows. */ }
    }
    return {
      fan: result.totalFan,
      nonFlowerFan,
      yaku,
    };
  } catch {
    return null;
  }
}

export function isMcrWinningShape(hand: readonly string[], melds: readonly MeldView[], winningTile: string): boolean {
  return evaluateMcrHand({
    profile: PROFILES.mcr,
    player: { hand: [...hand], melds: [...melds], flowers: [], riichi: false, kita: 0 },
    winningTile,
    selfDraw: false,
    seat: 0,
    roundWind: 0,
  }) !== null;
}

export function mcrScore(c: ScoreContext, reasons?: string[]): HandScore | null {
  const result = evaluateMcrHand(c);
  if (!result) return null;
  if (result.nonFlowerFan < 8) {
    reasons?.push('不足8番：当前非花牌番为' + result.nonFlowerFan + '番，花牌不计入8番起和门槛。');
    return null;
  }
  return { fan: result.fan, fu: 0, base: result.fan, yakuman: 0, yaku: result.yaku };
}

/** Score each complete decomposition independently; never mix incompatible shapes. */
function sichuanV2Score(c:ScoreContext,forms:Decomposition[],all:string[],options:SichuanOptions):HandScore {
  const roots=countsOf(all).filter(count=>count===4).length;
  const pure=new Set(all.map(tile=>tile[0])).size===1;
  const all258=all.every(is258),middle=all.every(tile=>tile[0]!=='z'&&Number(tile[1])>=2&&Number(tile[1])<=8);
  let best:{fan:number;yaku:YakuView[]}|undefined;
  const candidates=c.heavenlyWin?[undefined]:forms;
  for(const form of candidates){
    let fan=0;const yaku:YakuView[]=[];
    const add=(name:string,value:number)=>{fan+=value;yaku.push({name,han:value});};
    if(c.heavenlyWin){
      add(c.heavenlyWin==='heaven'?'天胡':'地胡',5);
    }else if(form){
      const seven=!!form.sevenPairs;
      const pung=!seven&&!form.orphans&&form.sets.every(set=>set.type==='pon')&&c.player.melds.every(meld=>meld.type!=='chi');
      const gold=pung&&c.player.melds.length===c.profile.sets;
      const jiang=pung&&all258;
      const eighteen=gold&&c.player.melds.every(meld=>meld.type==='kan');
      let includedRoots=0;
      if(seven){
        if(roots){add(pure?'清龙七对':'龙七对',pure?5:4);includedRoots=1;}
        else add(pure?'清七对':'七对',pure?4:2);
      }else if(eighteen){
        add(pure?'清十八罗汉':'十八罗汉',pure?8:6);includedRoots=4;
      }else{
        let pureIncluded=false;
        if(gold)add(jiang?'将金钩钓':'金钩钓',jiang?4:2);
        else if(jiang)add('将对',3);
        else if(pung&&pure){add('清碰',3);pureIncluded=true;}
        else if(pung)add('碰碰胡',1);
        const yaojiu=!!form.pair&&isTerminal(form.pair)
          && form.sets.every(set=>set.type==='pon'?isTerminal(set.tile):[1,7].includes(Number(set.tile[1])))
          && c.player.melds.every(meld=>meld.tiles.some(isTerminal));
        if(yaojiu){
          if(pure&&!pureIncluded){add('清幺九',4);pureIncluded=true;}
          else add('带幺九',2);
        }
        if(pure&&!pureIncluded)add('清一色',2);
      }
      if(roots>includedRoots)add('根',roots-includedRoots);
      if(options.menqingZhongzhang){
        if(!seven&&c.player.melds.every(meld=>meld.concealed))add('门清',1);
        if(middle&&!jiang)add('中张',1);
      }
      if(c.kongDraw)add('杠上花',1);
      if(c.robbingKong)add('抢杠胡',1);
      if(c.kongDiscard&&!c.selfDraw&&!c.robbingKong)add('杠上炮',1);
      if(c.lastTile)add('海底',1);
    }
    if(c.selfDraw&&options.selfDraw==='fan')add('自摸',1);
    if(!fan)yaku.push({name:'平胡',han:0});
    if(!best||fan>best.fan)best={fan,yaku};
  }
  const chosen=best!;
  const effectiveFan=options.fanCap==='none'?chosen.fan:Math.min(options.fanCap,chosen.fan),multiplier=2**effectiveFan;
  const yaku=c.captureEvidence?sichuanEvidence(chosen.yaku,{hand:[...c.player.hand,...(c.selfDraw?[]:[c.winningTile])],melds:c.player.melds,winningTile:c.winningTile},c.profile.id):chosen.yaku;
  return {fan:chosen.fan,fu:0,base:multiplier,yakuman:0,yaku,
    sichuanScore:{fanCap:options.fanCap,effectiveFan,multiplier,selfDrawBonus:c.selfDraw&&options.selfDraw==='base'?1:0}};
}

/** Optional rejection wording is populated only for complete shapes by the same rule branches. */
export function scoreHand(c:ScoreContext,reasons?:string[],analysisBudget?:HandSearchBudget):HandScore|null {
  const p=c.profile,player=c.player;
  const onlySelfDraw=p.selfDrawOnly&&!c.selfDraw&&!c.robbingKong;
  if(onlySelfDraw&&!reasons)return null;
  if(p.id==='mcr')return mcrScore(c,reasons);
  if(p.id==='sanma')return japaneseScore(c,reasons);
  const tiles=c.selfDraw?[...player.hand]:[...player.hand,c.winningTile],all=[...tiles,...player.melds.flatMap(m=>m.tiles)];
  const voidBlocked=p.voidSuit&&all.some(t=>t[0]===player.voidSuit);
  if(voidBlocked&&!reasons)return null;
  const forms=decompose(tiles,player.melds,p.sets,c.wildcard,false,analysisBudget).filter(f=>(!f.sevenPairs||p.sevenPairs)&&(!f.orphans||p.orphans));
  if(!forms.length)return null;
  if(onlySelfDraw){reasons?.push('仅自摸：本桌普通弃牌不能点炮和牌，只允许自摸或抢补杠。');return null;}
  if(voidBlocked){reasons?.push('定缺限制：和牌牌形中仍有定缺花色，不能和牌；须清除该门并改变听牌。');return null;}
  const closed=player.melds.every(m=>m.concealed),open=!closed;
  const natural=all.filter(t=>!c.wildcard||norm(t)!==norm(c.wildcard));
  const suits=new Set(natural.filter(t=>t[0]!=='z').map(t=>t[0])),honors=natural.some(t=>t[0]==='z');
  const pure=suits.size===1&&!honors,mixed=suits.size===1&&honors,allHonors=suits.size===0;
  const seven=forms.some(f=>f.sevenPairs),orphan=forms.some(f=>f.orphans);
  const pung=forms.some(f=>!f.sevenPairs&&!f.orphans&&f.sets.every(s=>s.type==='pon'))&&player.melds.every(m=>m.type!=='chi');
  const terminal=natural.every(isTerminal),all258=natural.every(is258),singleWait=player.melds.length===p.sets;
  const counters=countsOf(all),dragon=[31,32,33].filter(i=>counters[i]>=3).length,wind=[27,28,29,30].filter(i=>counters[i]>=3).length;
  const pair258=forms.some(f=>f.pair&&is258(f.pair));
  const yaku:YakuView[]=[];let fan=0;const add=(name:string,value:number)=>{fan+=value;yaku.push({name,han:value});};
  if(p.id.startsWith('sichuan')){
    const options=normalizeSichuanOptions(c.sichuan,1);
    if(options.version===2)return sichuanV2Score(c,forms,all,options);
    if(seven)add('七对',2);else if(pung)add('碰碰胡',1);
    if(pure)add('清一色',2);if(singleWait)add('金钩钓',2);
    const roots=counters.filter(n=>n===4).length;if(roots)add('根',roots);
    if(c.kongDraw)add('杠上花',1);if(c.robbingKong)add('抢杠胡',1);if(c.lastTile)add('海底',1);
    if(!fan)yaku.push({name:'平胡',han:0});const effectiveFan=Math.min(4,fan),base=2**effectiveFan;
    return {fan,fu:0,base,yakuman:0,yaku:c.captureEvidence?sichuanEvidence(yaku,{hand:tiles,melds:player.melds,winningTile:c.winningTile},p.id):yaku,sichuanScore:{fanCap:4,effectiveFan,multiplier:base,selfDrawBonus:c.selfDraw?1:0}};
  }
  if(p.id==='hongkong'){
    if(orphan)add('十三幺',13);else if(dragon===3)add('大三元',10);else if(wind===4)add('大四喜',10);else if(allHonors)add('字一色',10);else if(terminal)add('混老头',10);else{
      if(pure)add('清一色',7);else if(mixed)add('混一色',3);
      if(pung)add('碰碰胡',3);
      for(const index of [31,32,33])if(counters[index]>=3)add(['白板','发财','红中'][index-31],1);
      if(counters[27+c.seat]>=3)add('门风刻',1);if(counters[27+c.roundWind%4]>=3)add('圈风刻',1);
      if(closed)add('门前清',1);if(c.selfDraw)add('自摸',1);if(c.kongDraw)add('杠上开花',1);if(c.robbingKong)add('抢杠',1);if(c.lastTile)add('海底',1);
      if(!player.flowers.length)add('无花',1);
      const flower=player.flowers.filter(t=>(Number(t[1])-1)%4===c.seat).length;if(flower)add('正花',flower);
      for(const offset of [1,5])if([0,1,2,3].every(n=>player.flowers.includes('f'+(offset+n))))add('一台花',2);
    }
    if(fan<p.minimumFan){reasons?.push(`番数不足：本桌${p.minimumFan}番起和，当前只有${fan}番。`);return null;}return {fan,fu:0,base:2**Math.min(fan,10),yakuman:0,yaku};
  }
  if(p.id==='taiwan'){
    if(allHonors)add('字一色',16);else if(pure)add('清一色',8);else if(mixed)add('混一色',4);
    if(pung)add('碰碰胡',4);if(closed)add('门清',1);if(c.selfDraw)add('自摸',1);
    if(dragon===3)add('大三元',8);else for(const i of [31,32,33])if(counters[i]>=3)add(['白板','发财','红中'][i-31],1);
    if(counters[27+c.seat]>=3)add('门风',1);if(counters[27+c.roundWind%4]>=3)add('圈风',1);
    const flowers=player.flowers.filter(t=>(Number(t[1])-1)%4===c.seat).length;if(flowers)add('正花',flowers);
    if(c.kongDraw)add('杠上开花',1);if(c.robbingKong)add('抢杠',1);if(singleWait)add('独听',1);
    if(!yaku.length)yaku.push({name:'平胡',han:0});return {fan,fu:0,base:1+fan,yakuman:0,yaku};
  }
  if(p.id==='hangzhou'){
    add(seven?'七对':'自摸平胡',seven?2:1);
    let base=fan;if(!all.some(t=>norm(t)===norm(c.wildcard||''))){yaku.push({name:'硬胡',han:2});base*=2;}
    const before=[...tiles];const at=before.lastIndexOf(c.winningTile);if(at>=0)before.splice(at,1);
    if(isBurstReady(before,player.melds,c.wildcard)){yaku.push({name:'爆头',han:2});base*=2;}
    if(player.floatCount){const factor=2**Math.min(3,player.floatCount);yaku.push({name:`财飘${player.floatCount}次`,han:`×${factor}`});base*=factor;}
    return {fan,fu:0,base,yakuman:0,yaku};
  }
  if(p.id==='wuhan'){
    if(!open){reasons?.push('尚未开口：本桌需要至少一副明吃、碰或杠才能和牌，暗杠不算开口。');return null;}
    const hard=!all.some(t=>norm(t)===norm(c.wildcard||''));if(!c.selfDraw&&!hard){reasons?.push('赖子限制：本桌含赖子的手牌只能自摸，不能点炮和牌。');return null;}
    const big=pung||pure||all258||allHonors;if(!pair258&&!big){reasons?.push('将牌限制：普通胡需要二、五、八作将，当前也不符合大胡例外。');return null;}
    if(pung)add('碰碰胡',2);if(pure)add('清一色',4);if(all258)add('将一色',4);if(allHonors)add('字一色',8);
    if(!big)add('开口二五八将',1);let base=fan;if(hard){yaku.push({name:'硬胡',han:2});base*=2;}
    return {fan,fu:0,base,yakuman:0,yaku};
  }
  if(p.id==='changsha'){
    const big=seven||pung||pure||all258||singleWait||c.kongDraw;
    if(!big&&!pair258){reasons?.push('将牌限制：普通小胡需要二、五、八作将，当前也不符合大胡例外。');return null;}
    if(seven)add('七对',6);if(pung)add('碰碰胡',6);if(pure)add('清一色',6);if(all258)add('将一色',6);if(singleWait)add('全求人',6);if(c.kongDraw)add('杠上花',6);if(c.robbingKong)add('抢杠胡',6);
    if(!fan)add('二五八将小胡',1);return {fan,fu:0,base:fan,yakuman:0,yaku};
  }
  if(p.id==='northeast'){
    const hasPung=player.melds.some(m=>m.type!=='chi')||forms.some(f=>f.sets.some(s=>s.type==='pon'));
    if(!open||suits.size!==3||!all.some(isTerminal)||!hasPung){
      if(!open)reasons?.push('尚未开门：本桌需要至少一副明吃、碰或杠才能和牌。');
      if(suits.size!==3)reasons?.push('三门不齐：本桌和牌须同时有万、筒、条三种花色。');
      if(!all.some(isTerminal))reasons?.push('缺少幺九：本桌和牌须有一、九或字牌。');
      if(!hasPung)reasons?.push('缺少刻子：本桌和牌须至少有一副刻子或杠。');
      return null;
    }
    add('开门三门齐有幺九',1);if(c.selfDraw)add('自摸',1);return {fan,fu:0,base:fan,yakuman:0,yaku};
  }
  if(orphan)add('十三幺',6);else{if(pure)add('清一色',3);else if(mixed)add('混一色',1);if(pung)add('碰碰胡',1);if(seven)add('七对',2);if(c.kongDraw)add('杠上花',1);if(c.robbingKong)add('抢杠',1);}
  if(!fan)yaku.push({name:'平胡',han:0});return {fan,fu:0,base:2**Math.min(6,fan),yakuman:0,yaku};
}

export function nextWildcard(indicator:string):string{const i=tileIndex(indicator);return indicator[0]==='z'?'z'+(Number(indicator[1])%7+1):indicator[0]+((i%9+1)%9+1);}
export function isBurstReady(tiles:string[],melds:MeldView[],wildcard?:string):boolean {
  if(!wildcard)return false;const rest=[...tiles],index=rest.findIndex(t=>norm(t)===wildcard);if(index<0)return false;rest.splice(index,1);
  return decompose([...rest,'z1','z1'],melds,4).some(f=>f.pair==='z1'&&!f.sevenPairs&&!f.orphans);
}
