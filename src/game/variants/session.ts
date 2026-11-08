import type { Difficulty, BotObservation, GenericCandidate } from '../ai/types';
import { AI_VERSION, validDifficulty } from '../ai/types';
import { rankPublicCandidates, samplePublicDraws } from '../ai/evaluator';
import { getMode } from '../catalog';
import type { ConfirmedWinEvent, EndlessCheckpoint, GameLogEntry, GameSessionAPI, GameSnapshot, LegalAction, MeldView, ModeId, QuickControls, ReplayData, ReplayFrame, RonNotice, RoundResult, SavedGame, SelfWinNotice, SessionOptions, WinnerView } from '../types';
import { decompose, shanten } from './hand';
import { getProfile, isBurstReady, nextWildcard, profileTiles, scoreHand } from './rules';
import type { HandScore, RuleProfile, ScoreContext, ScoringPlayer } from './rules';
import { coreMeld, coreString, countsOf, norm, seededRandom, shuffle, sortTiles, tileCode, tileIndex, tileLabel, WINDS } from './tiles';
import { createRiichiAssistCalculator, projectRiichiAssist } from '../assist/riichiAssist';
import { chooseQuickAction, DEFAULT_QUICK_CONTROLS, updateQuickControls } from '../quickControls';
import { appendReplayFrame, finishReplayFrames, MAX_REPLAY_STEPS, validateReplayData, yieldReplayWork } from '../replaySupport';
import { furitenView } from '../assist/furiten';
import { furitenReasons } from '../ronNotice';
import { restoredStartPoints, validStartPoints } from '../startingPoints';
import { newEndlessSessionId } from '../endlessCheckpoint';

interface Player extends ScoringPlayer {
  id:number;points:number;drawn:string|null;discards:GameSnapshot['players'][number]['discards'];
  hasWon:boolean;winCount:number;temporaryFuriten:boolean;permanentFuriten:boolean;lastDrawKan:boolean;canSelfWin:boolean;floatCount:number;
}
interface Choice extends LegalAction { key:string;index?:number;meldIndex?:number;consume?:string[];kind?:'concealed'|'added'|'open' }
interface ResponseEvent { kind:'discard'|'kan';from:number;tile:string;meldIndex?:number;riichi?:boolean;choices:Map<number,Choice[]>;replies:Map<number,Choice|undefined> }
type Stage='exchange'|'void'|'draw'|'discard'|'response'|'settlement'|'match';
const NAMES=['你','青岚','千鹤','北辰'];
let displaySessionSequence=0;

export class RegionalSession implements GameSessionAPI {
  private options:SessionOptions&{seed:string;mode:ModeId;difficulty:Difficulty;startPoints:number;autoPlayDifficulty:Difficulty;autoExchangeThree:boolean;speed:number;autoPlay:boolean;matchLength:'single'|'east'|'hanchan'|'endless'};
  private profile:RuleProfile;
  private players:Player[]=[];
  private wall:string[]=[];
  private replacement:string[]=[];
  private dora:string[]=[];
  private ura:string[]=[];
  private doraReserve:string[]=[];
  private uraReserve:string[]=[];
  private wildcard?:string;
  private stage:Stage='draw';
  private turn=0;
  private dealer=0;
  private roundNumber=0;
  private handSequence=0;
  private endlessSessionId='';
  private checkpoint?:EndlessCheckpoint;
  private honba=0;
  private sticks=0;
  private kanCount=0;
  private callsMade=false;
  private actions:Choice[]=[];
  private response:ResponseEvent|null=null;
  private result:RoundResult|null=null;
  private latestWin?:ConfirmedWinEvent;
  private ronNotice?:RonNotice;
  private selfWinNotice?:SelfWinNotice;
  private selfWinNoticeSequence=0;
  private ronEventSequence=0;
  private readonly displaySessionId=++displaySessionSequence;
  private winEventSequence=0;
  private roundWinners:WinnerView[]=[];
  private roundStart:number[]=[];
  private kongTransfers:{from:number;to:number;amount:number}[]=[];
  private exchangeSelection=new Set<number>();
  private logs:GameLogEntry[]=[];
  private logSequence=0;
  private decisions:{key:string}[]=[];
  private random:()=>number;
  private snapshot!:GameSnapshot;
  private calculateAssist=createRiichiAssistCalculator();
  private quickControls:QuickControls={...DEFAULT_QUICK_CONTROLS};
  private replayFrames:ReplayFrame[]|null=null;
  private revision=0;
  private listeners=new Set<()=>void>();
  private timer:ReturnType<typeof setTimeout>|null=null;
  private disposed=false;
  private replaying=false;
  private aiVersion=AI_VERSION;
  private step=0;
  private regionalHintCache?:{key:string;shanten:number|null;waits:string[]};

  constructor(options:SessionOptions={}){
    const mode=options.mode||'guangdong';
    this.profile=getProfile(mode);if(!this.profile)throw new Error('未实现的规则');
    this.options={...options,mode,seed:options.seed||`table-${Date.now()}`,difficulty:options.difficulty||'standard',startPoints:validStartPoints(mode,options.startPoints)?options.startPoints:this.profile.startPoints,autoPlayDifficulty:validDifficulty(options.autoPlayDifficulty)?options.autoPlayDifficulty:'expert',autoExchangeThree:options.autoExchangeThree??false,speed:options.speed??450,autoPlay:options.autoPlay??false,matchLength:options.matchLength||'east'};
    this.random=seededRandom(this.options.seed);this.newGame(this.options);
  }
  getSnapshot=():GameSnapshot=>this.snapshot;
  subscribe=(listener:()=>void):(()=>void)=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
  private log(text:string,playerId?:number,tile?:string){this.logs.push({id:++this.logSequence,text,playerId,tile});if(this.logs.length>180)this.logs.shift();}
  private cancel(){if(this.timer!==null)clearTimeout(this.timer);this.timer=null;}
  private seat(id:number){return (id-this.dealer+this.profile.players)%this.profile.players;}
  private playerAtSeat(seat:number){return (this.dealer+seat)%this.profile.players;}
  private distance(tiles:string[],melds:MeldView[]=[]){return shanten(tiles,melds,this.profile.sets,this.wildcard,this.profile.sevenPairs,this.profile.orphans);}
  private nextActive(id:number){for(let n=1;n<=this.profile.players;n++){const next=(id+n)%this.profile.players;if(!this.players[next].hasWon||this.profile.continuing!=='blood')return next;}return id;}
  private active(){return this.players.filter(p=>!p.hasWon||this.profile.continuing!=='blood');}
  private makePlayer(id:number):Player{return {id,points:this.options.startPoints,hand:[],melds:[],flowers:[],kita:0,riichi:false,drawn:null,discards:[],hasWon:false,winCount:0,temporaryFuriten:false,permanentFuriten:false,lastDrawKan:false,canSelfWin:true,floatCount:0};}
  newGame(options:SessionOptions={}){this.initialize(options);}
  private initialize(options:SessionOptions,checkpoint?:EndlessCheckpoint){
    if(!this.replaying)this.aiVersion=AI_VERSION;
    this.quickControls=updateQuickControls(this.quickControls,options.quickControls);
    this.cancel();const mode=options.mode||this.options.mode;this.profile=getProfile(mode);if(!this.profile)throw new Error('未实现的规则');
    this.options={...this.options,...options,mode,seed:options.seed||this.options.seed,startPoints:validStartPoints(mode,options.startPoints)?options.startPoints:this.profile.startPoints,autoPlayDifficulty:validDifficulty(options.autoPlayDifficulty)?options.autoPlayDifficulty:this.options.autoPlayDifficulty,autoExchangeThree:options.autoExchangeThree??this.options.autoExchangeThree};
    if(this.options.matchLength!=='endless')checkpoint=undefined;
    this.random=seededRandom(this.options.seed);this.dealer=checkpoint?.dealer??0;this.roundNumber=checkpoint?.rotation??0;this.handSequence=checkpoint?checkpoint.sequence-1:0;this.honba=checkpoint?.honba??0;this.sticks=checkpoint?.sticks??0;this.disposed=false;this.step=0;this.decisions=[];this.logs=[];this.logSequence=0;this.regionalHintCache=undefined;
    this.endlessSessionId=this.options.matchLength==='endless'?(checkpoint?.sessionId??newEndlessSessionId()):'';this.checkpoint=undefined;
    this.players=Array.from({length:this.profile.players},(_,id)=>this.makePlayer(id));
    if(checkpoint)this.players.forEach((player,id)=>{player.points=checkpoint.points[id];});
    this.deal();this.publish();this.schedule();
  }
  private deal(){
    this.handSequence++;this.regionalHintCache=undefined;
    const points=this.players.map(p=>p.points);
    if(this.options.matchLength==='endless'){
      this.checkpoint={version:1,sessionId:this.endlessSessionId,sequence:this.handSequence,points:[...points],dealer:this.dealer,rotation:this.roundNumber,honba:this.honba,sticks:this.sticks};
      this.random=seededRandom(`${this.options.seed}|endless:${this.handSequence}`);this.decisions=[];this.step=0;
    }
    this.players=points.map((points,id)=>({...this.makePlayer(id),points}));
    this.roundStart=[...points];this.roundWinners=[];this.kongTransfers=[];this.result=null;this.latestWin=undefined;this.ronNotice=undefined;this.selfWinNotice=undefined;this.response=null;this.actions=[];this.kanCount=0;this.callsMade=false;this.exchangeSelection.clear();
    this.wall=shuffle(profileTiles(this.profile),this.random);this.replacement=[];this.dora=[];this.ura=[];this.doraReserve=[];this.uraReserve=[];this.wildcard=undefined;
    if(this.profile.id==='sanma'){
      const dead=this.wall.splice(0,14);this.replacement=dead.slice(0,4);this.doraReserve=dead.slice(4,9);this.uraReserve=dead.slice(9,14);this.dora.push(this.doraReserve[0]);this.ura.push(this.uraReserve[0]);
    }else if(this.profile.deadWall)this.wall.splice(0,this.profile.deadWall);
    if(this.profile.wild){const indicator=this.wall.shift()!;this.dora=[indicator];this.wildcard=nextWildcard(indicator);}
    for(let n=0;n<this.profile.sets*3+1;n++)for(let seat=0;seat<this.profile.players;seat++){
      const player=this.players[this.playerAtSeat(seat)];const tile=this.takeTile(player,false,false);if(tile)player.hand.push(tile);
    }
    this.players.forEach(p=>p.hand=sortTiles(p.hand));this.turn=this.dealer;
    this.stage=this.profile.voidSuit?(this.options.variantOptions?.exchangeThree?'exchange':'void'):'draw';
    this.log(`${getMode(this.profile.id).name} · ${WINDS[Math.floor(this.roundNumber/this.profile.players)%4]}${this.roundNumber%this.profile.players+1}局 ${this.honba}本场`);
    if(this.stage==='exchange')this.exchangeActions();else if(this.stage==='void')this.voidActions();
  }
  private takeTile(player:Player,replacement:boolean,kan:boolean):string|undefined{
    let tile:string|undefined;
    if(replacement&&this.profile.id==='sanma'){
      if(!this.wall.length||!this.replacement.length)return undefined;
      tile=this.replacement.pop();this.replacement.unshift(this.wall.shift()!);
    }else tile=replacement&&this.profile.id!=='sichuan-blood'&&this.profile.id!=='sichuan-river'?this.wall.shift():this.wall.pop();
    while(tile?.[0]==='f'){player.flowers.push(tile);this.log(`${NAMES[player.id]}补花 ${tileLabel(tile)}`,player.id,tile);tile=this.wall.shift();}
    if(tile&&kan)player.lastDrawKan=true;
    return tile;
  }
  private draw(replacement=false,kan=false){
    const player=this.players[this.turn];player.temporaryFuriten=false;player.lastDrawKan=false;
    if(player.id===0){this.ronNotice=undefined;this.selfWinNotice=undefined;}
    const tile=this.takeTile(player,replacement,kan);if(!tile){this.finishDraw();return;}
    player.hand=sortTiles(player.hand);player.hand.push(tile);player.drawn=tile;player.canSelfWin=true;this.stage='discard';this.actions=this.ownChoices(player);
    if(!this.actions.length)throw new Error(`没有合法出牌：${this.profile.id}`);
  }
  private action(type:Choice['type'],key:string,label:string,extra:Partial<Choice>={}):Choice{return {id:`${this.options.matchLength==='endless'?`${this.handSequence}:`:''}${this.step}:${key}`,key,type,label,...extra};}
  private exchangeActions(){
    const player=this.players[0];this.actions=player.hand.map((tile,index)=>this.action('exchange',`exchange:${index}`,`${this.exchangeSelection.has(index)?'取消':'选'}${tileLabel(tile)}`,{tile,tileId:this.handId(0,index),index}));
    const selected=[...this.exchangeSelection];if(selected.length===3&&new Set(selected.map(i=>player.hand[i][0])).size===1)this.actions.push(this.action('confirm','confirm-exchange','确认换三张'));
  }
  private chooseExchange(player:Player):number[]{
    const suits=['m','p','s'].map(suit=>({suit,indices:player.hand.flatMap((tile,i)=>tile[0]===suit?[i]:[])})).filter(s=>s.indices.length>=3).sort((a,b)=>a.indices.length-b.indices.length);
    return suits[0].indices.slice(0,3);
  }
  private exchange(){
    const selections=this.players.map(p=>p.id===0?[...this.exchangeSelection]:this.chooseExchange(p));
    const removed=this.players.map((p,id)=>selections[id].map(i=>p.hand[i]));
    this.players.forEach((p,id)=>{p.hand=p.hand.filter((_,i)=>!selections[id].includes(i));});
    this.players.forEach((p,id)=>{p.hand=sortTiles([...p.hand,...removed[(id+this.profile.players-1)%this.profile.players]]);});
    this.log('四家向下家交换同花色三张牌');this.exchangeSelection.clear();this.stage='void';this.voidActions();
  }
  private voidActions(){this.actions=['m','p','s'].map(suit=>this.action('void',`void:${suit}`,`定缺${({m:'万',p:'筒',s:'条'} as Record<string,string>)[suit]}`,{tile:suit}));}
  private declareVoid(suit:string){
    this.players.forEach(player=>{player.voidSuit=player.id===0?suit:['m','p','s'].sort((a,b)=>player.hand.filter(t=>t[0]===a).length-player.hand.filter(t=>t[0]===b).length)[0];this.log(`${NAMES[player.id]}定缺${({m:'万',p:'筒',s:'条'} as Record<string,string>)[player.voidSuit]}`,player.id);});
    this.actions=[];this.stage='draw';
  }
  private context(player:Player,winningTile:string,selfDraw:boolean,robbingKong=false,withUra=false):ScoreContext{
    const shown=this.players.reduce((sum,p)=>sum+p.discards.filter(d=>!d.called&&norm(d.tile)===norm(winningTile)).length+p.melds.flatMap(m=>m.tiles).filter(t=>norm(t)===norm(winningTile)).length,0)-(!selfDraw&&!robbingKong?1:0);
    return {profile:this.profile,player,selfDraw,winningTile,seat:this.seat(player.id),roundWind:Math.floor(this.roundNumber/this.profile.players)%4,wildcard:this.wildcard,lastTile:this.wall.length===0,kongDraw:selfDraw&&player.lastDrawKan,robbingKong,dora:this.dora,ura:withUra?this.ura:[],visibleWinningCopies:shown,firstDraw:!this.callsMade&&player.discards.length===0};
  }
  private winning(player:Player,tile:string,selfDraw:boolean,robbing=false,withUra=false,reasons?:string[]){return scoreHand(this.context(player,tile,selfDraw,robbing,withUra),reasons);}
  private tileUniverse(){return [...new Set(profileTiles(this.profile).filter(t=>t[0]!=='f').map(norm))];}
  private shapeWaits(player:Player,tiles=player.hand,melds=player.melds):string[]{
    if(tiles.length%3!==1)return [];
    return this.tileUniverse().filter(tile=>{
      if(tiles.filter(t=>norm(t)===tile).length+melds.flatMap(m=>m.tiles).filter(t=>norm(t)===tile).length>=4)return false;
      return decompose([...tiles,tile],melds,this.profile.sets,this.wildcard).some(f=>(!f.sevenPairs||this.profile.sevenPairs)&&(!f.orphans||this.profile.orphans));
    });
  }
  private isFuriten(player:Player){return player.temporaryFuriten||player.permanentFuriten||this.shapeWaits(player).some(tile=>player.discards.some(d=>norm(d.tile)===tile));}
  private handId(id:number,index:number){return `${id}-tile-${index}`;}
  getRegionalHint(discardId:string):{shanten:number|null;waits:string[]}|null{
    if(this.disposed||this.profile.id==='sanma'||this.stage!=='discard'||this.turn!==0)return null;
    const player=this.players[0];
    if(player.hasWon&&this.profile.continuing==='blood')return null;
    const choice=this.actions.find(action=>action.type==='discard'&&action.tileId===discardId);
    if(choice?.index==null||choice.index<0||choice.index>=player.hand.length)return null;
    const key=JSON.stringify([this.profile.id,this.wildcard,player.hand,player.melds,choice.index]);
    if(this.regionalHintCache?.key===key)return {shanten:this.regionalHintCache.shanten,waits:[...this.regionalHintCache.waits]};
    const after=player.hand.filter((_,index)=>index!==choice.index),distance=this.distance(after,player.melds);
    const hint={key,shanten:Number.isFinite(distance)?distance:null,waits:distance===0?this.shapeWaits(player,after):[]};
    this.regionalHintCache=hint;
    return {shanten:hint.shanten,waits:[...hint.waits]};
  }
  private ownChoices(player:Player):Choice[]{
    const choices:Choice[]=[];const drawn=player.drawn;
    if(player.id===0)this.selfWinNotice=undefined;
    if(drawn&&player.canSelfWin){
      const reasons:string[]=[];
      const score=this.winning(player,drawn,true,false,false,player.id===0?reasons:undefined);
      if(score)choices.push(this.action('tsumo','tsumo','自摸和牌'));
      else if(player.id===0&&reasons.length)this.selfWinNotice={id:`regional:${this.displaySessionId}:self:${++this.selfWinNoticeSequence}`,tile:drawn,reasons};
    }
    if(this.profile.id==='sanma'&&drawn&&this.wall.length&&player.hand.some(t=>t==='z4')&&(!player.riichi||drawn==='z4'))choices.push(this.action('kita','kita','拔北',{tile:'z4'}));
    const mustVoid=!!player.voidSuit&&player.hand.some(t=>t[0]===player.voidSuit);
    if(drawn&&this.wall.length>0&&(!mustVoid)&&this.kanCount<4){
      for(const tile of new Set(player.hand.map(norm))){
        if(this.wildcard&&tile===this.wildcard)continue;
        const indices=player.hand.flatMap((t,i)=>norm(t)===tile?[i]:[]);
        if(indices.length===4){
          const after=player.hand.filter((_,i)=>!indices.includes(i));
          const meld:MeldView={id:'tmp',type:'kan',tiles:indices.map(i=>player.hand[i]),concealed:true};
          const canKan=!player.riichi||JSON.stringify(this.shapeWaits(player,player.hand.slice(0,-1)))===JSON.stringify(this.shapeWaits(player,after,[...player.melds,meld]));
          if(canKan)choices.push(this.action('kan',`kan-closed:${tile}`,`暗杠${tileLabel(tile)}`,{tile,tiles:meld.tiles,kind:'concealed'}));
        }
        if(!player.riichi)for(let i=0;i<player.melds.length;i++)if(player.melds[i].type==='pon'&&norm(player.melds[i].tiles[0])===tile)choices.push(this.action('kan',`kan-added:${tile}`,`补杠${tileLabel(tile)}`,{tile,tiles:[...player.melds[i].tiles,player.hand[indices[0]]],meldIndex:i,kind:'added'}));
      }
    }
    player.hand.forEach((tile,index)=>{
      if(mustVoid&&tile[0]!==player.voidSuit)return;
      if(player.riichi&&index!==player.hand.length-1)return;
      choices.push(this.action('discard',`discard:${index}:${tile}`,`打出${tileLabel(tile)}`,{tile,tileId:this.handId(player.id,index),index}));
      if(this.profile.id==='sanma'&&!player.riichi&&player.points>=1000&&player.melds.every(m=>m.concealed)&&this.wall.length>=3){
        const after=player.hand.filter((_,i)=>i!==index);
        if(shanten(after,player.melds)===0&&this.shapeWaits(player,after).length)choices.push(this.action('riichi',`riichi:${index}:${tile}`,`立直 · ${tileLabel(tile)}`,{tile,tileId:this.handId(player.id,index),index}));
      }
    });
    return choices;
  }
  private reaction(player:Player,event:ResponseEvent,reasons?:string[]):Choice[]{
    const {tile,from}=event;const choices:Choice[]=[];if(player.id===from||player.hasWon&&this.profile.continuing==='blood')return choices;
    const furiten=this.profile.id==='sanma'&&this.isFuriten(player);
    const score=!furiten||reasons?this.winning(player,tile,false,event.kind==='kan',false,reasons):null;
    if(!furiten&&score)choices.push(this.action('ron',`ron:${from}:${tile}`,event.kind==='kan'?'抢杠和牌':'和牌',{tile}));
    if(furiten&&reasons&&(score||reasons.length))reasons.push(...furitenReasons(furitenView(this.shapeWaits(player),player.discards.map(d=>d.tile),{temporary:player.temporaryFuriten,riichiPass:player.permanentFuriten})));
    if(event.kind==='discard'&&this.wall.length>0&&!player.riichi&&(!player.voidSuit||!player.hand.some(t=>t[0]===player.voidSuit))&&(!this.wildcard||norm(tile)!==this.wildcard)){
      const matches=player.hand.filter(t=>norm(t)===norm(tile));
      if(matches.length>=2)choices.push(this.action('pon',`pon:${tile}`,`碰${tileLabel(tile)}`,{tile,consume:matches.slice(0,2),tiles:[...matches.slice(0,2),tile]}));
      if(matches.length>=3&&this.wall.length&&this.kanCount<4)choices.push(this.action('kan',`kan-open:${tile}`,`杠${tileLabel(tile)}`,{tile,consume:matches.slice(0,3),tiles:[...matches.slice(0,3),tile],kind:'open'}));
      if(this.profile.chi&&player.id===(from+1)%this.profile.players&&tile[0]!=='z'){
        const rank=Number(norm(tile)[1]);for(let start=rank-2;start<=rank;start++){
          if(start<1||start>7)continue;const wanted=[start,start+1,start+2].filter(n=>n!==rank).map(n=>tile[0]+n),consume:string[]=[];let valid=true;
          for(const wantedTile of wanted){const found=player.hand.find(t=>norm(t)===wantedTile&&(!this.wildcard||norm(t)!==this.wildcard));if(found)consume.push(found);else valid=false;}
          if(valid)choices.push(this.action('chi',`chi:${start}:${tile}`,`吃 ${[start,start+1,start+2].map(n=>tileLabel(tile[0]+n)).join(' ')}`,{tile,consume,tiles:sortTiles([...consume,tile])}));
        }
      }
    }
    if(choices.length)choices.push(this.action('pass','pass','跳过'));return choices;
  }
  private beginResponse(kind:'discard'|'kan',from:number,tile:string,riichi=false,meldIndex?:number){
    const event:ResponseEvent={kind,from,tile,riichi,meldIndex,choices:new Map(),replies:new Map()};
    if(this.ronNotice)this.ronNotice.active=false;
    for(const player of this.players){
      const reasons:string[]=[];
      const choices=this.reaction(player,event,player.id===0?reasons:undefined);
      if(player.id===0){
        if(choices.some(choice=>choice.type==='ron'))this.ronNotice=undefined;
        else if(reasons.length)this.ronNotice={id:`regional:${this.displaySessionId}:ron:${++this.ronEventSequence}`,tile,fromId:from,event:kind==='kan'?'addedKan':'discard',active:choices.length>0,reasons};
      }
      if(choices.length){event.choices.set(player.id,choices);if(player.id!==0)event.replies.set(player.id,this.botChoice(player,choices));}
    }
    this.response=event;this.stage='response';this.actions=event.choices.get(0)||[];
  }
  private remove(player:Player,tiles:string[]){for(const tile of tiles){const index=player.hand.indexOf(tile);if(index<0)throw new Error('副露牌不在手中');player.hand.splice(index,1);}}
  private execute(player:Player,choice:Choice){
    if(player.id===0)this.selfWinNotice=undefined;
    if(choice.type==='tsumo'){this.award([{id:player.id,score:this.winning(player,player.drawn!,true,false,true)!}],undefined,player.drawn!,true);return;}
    if(choice.type==='kita'){
      this.remove(player,['z4']);player.kita++;this.callsMade=true;this.players.forEach(p=>p.ippatsu=false);this.log(`${NAMES[player.id]}拔北`,player.id,'z4');this.draw(true,false);return;
    }
    if(choice.type==='kan'){
      if(choice.kind==='added'){this.beginResponse('kan',player.id,player.hand.find(t=>norm(t)===norm(choice.tile!))!,false,choice.meldIndex);return;}
      const tiles=player.hand.filter(t=>norm(t)===norm(choice.tile!));this.remove(player,tiles);player.melds.push({id:`meld-${this.step}`,type:'kan',tiles,concealed:true});this.kong(player.id,'concealed');return;
    }
    if(choice.type!=='discard'&&choice.type!=='riichi')return;
    const index=choice.index!,tile=player.hand[index];
    const tsumogiri=!!player.drawn&&index===player.hand.length-1;
    if(player.riichi)player.ippatsu=false;
    player.hand.splice(index,1);player.discards.push({tile,riichi:choice.type==='riichi',called:false,tsumogiri});player.drawn=null;player.hand=sortTiles(player.hand);player.lastDrawKan=false;
    if(this.profile.id==='hangzhou'){
      if(norm(tile)===this.wildcard&&isBurstReady(player.hand,player.melds,this.wildcard)){player.floatCount=Math.min(3,player.floatCount+1);this.log(`${NAMES[player.id]}财飘${player.floatCount}次`,player.id);}
      else if(!isBurstReady(player.hand,player.melds,this.wildcard))player.floatCount=0;
    }
    this.log(`${NAMES[player.id]}${choice.type==='riichi'?'宣告立直，':''}打出${tileLabel(tile)}`,player.id,tile);
    this.beginResponse('discard',player.id,tile,choice.type==='riichi');
  }
  private acceptRiichi(event:ResponseEvent){if(!event.riichi)return;const player=this.players[event.from];player.riichi=true;player.doubleRiichi=player.discards.length===1&&!this.callsMade;player.ippatsu=true;player.points-=1000;this.sticks++;}
  private resolve(){
    if(this.ronNotice)this.ronNotice.active=false;
    const event=this.response!;const replies=[...event.replies].sort((a,b)=>(a[0]-event.from+this.profile.players)%this.profile.players-(b[0]-event.from+this.profile.players)%this.profile.players);
    for(const [id,choices]of event.choices){if(this.profile.id==='sanma'&&choices.some(c=>c.type==='ron')&&event.replies.get(id)?.type!=='ron'){this.players[id].temporaryFuriten=true;if(this.players[id].riichi)this.players[id].permanentFuriten=true;}}
    let winners=replies.filter(([,choice])=>choice?.type==='ron').map(([id])=>({id,score:this.winning(this.players[id],event.tile,false,event.kind==='kan',true)!}));
    if(['mcr','hongkong'].includes(this.profile.id))winners=winners.slice(0,1);
    this.response=null;this.actions=[];
    if(winners.length){if(event.kind==='kan')this.remove(this.players[event.from],[event.tile]);this.award(winners,event.from,event.tile,false);return;}
    this.acceptRiichi(event);
    if(event.kind==='kan'){
      const player=this.players[event.from];this.remove(player,[event.tile]);player.melds[event.meldIndex!].tiles.push(event.tile);player.melds[event.meldIndex!].type='kan';this.turn=event.from;this.kong(player.id,'added');return;
    }
    const called=replies.find(([,choice])=>choice?.type==='pon'||choice?.type==='kan')||replies.find(([,choice])=>choice?.type==='chi');
    if(called){
      const [id,choice]=called as [number,Choice];const player=this.players[id];this.players[event.from].discards.at(-1)!.called=true;this.remove(player,choice.consume!);
      player.melds.push({id:`meld-${this.step}`,type:choice.type==='kan'?'kan':choice.type==='pon'?'pon':'chi',tiles:choice.tiles!,concealed:false,from:event.from});
      this.callsMade=true;this.players.forEach(p=>p.ippatsu=false);this.turn=id;player.drawn=null;
      this.log(`${NAMES[id]}${choice.type==='chi'?'吃':choice.type==='pon'?'碰':'明杠'}${tileLabel(event.tile)}`,id,event.tile);
      if(choice.type==='kan')this.kong(id,'open',event.from);else{this.stage='discard';this.actions=this.ownChoices(player);}return;
    }
    this.turn=this.nextActive(event.from);this.stage='draw';
  }
  private transfer(from:number,to:number,amount:number,kong=false){this.players[from].points-=amount;this.players[to].points+=amount;if(kong)this.kongTransfers.push({from,to,amount});}
  private kong(id:number,kind:'concealed'|'added'|'open',from?:number){
    this.kanCount++;this.callsMade=true;this.players.forEach(p=>p.ippatsu=false);
    this.log(`${NAMES[id]}${kind==='concealed'?'暗杠':kind==='added'?'补杠':'明杠'}`,id);
    if(this.profile.id==='sanma'){this.dora.push(this.doraReserve[this.kanCount]);this.ura.push(this.uraReserve[this.kanCount]);}
    if(this.profile.id.startsWith('sichuan')){
      if(kind==='open')this.transfer(from!,id,2,true);else for(const p of this.active())if(p.id!==id)this.transfer(p.id,id,kind==='concealed'?2:1,true);
    }
    this.turn=id;this.draw(true,true);
  }
  private award(winners:{id:number;score:HandScore}[],from:number|undefined,tile:string,selfDraw:boolean){
    const before=this.players.map(p=>p.points),eventWinners:WinnerView[]=[];let birds:string[]=[];
    if(this.profile.id==='changsha'){birds=[this.wall.pop(),this.wall.pop()].filter(Boolean) as string[];if(birds.length)this.log(`扎鸟：${birds.map(tileLabel).join('、')}`);}
    for(let index=0;index<winners.length;index++){
      const {id,score}=winners[index],player=this.players[id];
      const beforeWinner=this.players.map(p=>p.points);
      let birdMultiplier=1;if(birds.length)birdMultiplier+=birds.filter(t=>[1,5,9].includes(Number(t[1]))).length;
      if(this.profile.id==='sanma'){
        if(selfDraw){for(const payer of this.players)if(payer.id!==id)this.transfer(payer.id,id,(score.payments?.[this.seat(payer.id)]||0)+this.honba*100);}else this.transfer(from!,id,score.base+this.honba*300);
        if(index===0){player.points+=this.sticks*1000;this.sticks=0;}
      }else if(this.profile.id==='mcr'){
        for(const payer of this.players)if(payer.id!==id)this.transfer(payer.id,id,8+(selfDraw||payer.id===from?score.fan:0));
      }else{
        for(const payer of this.active())if(payer.id!==id&&(selfDraw||payer.id===from)){
          let payment=score.base*birdMultiplier;
          if(this.profile.id.startsWith('sichuan')&&selfDraw)payment++;
          if(this.profile.id==='taiwan'&&(id===this.dealer||payer.id===this.dealer))payment+=1+2*this.honba;
          if(this.profile.id==='hangzhou'&&(id===this.dealer||payer.id===this.dealer))payment*=2;
          this.transfer(payer.id,id,payment);
        }
      }
      const win:WinnerView={playerId:id,fromId:from,fu:score.fu,han:score.fan,points:player.points-before[id],yakuman:score.yakuman,yaku:[...score.yaku,...(birds.length?[{name:`扎鸟${birds.map(tileLabel).join('、')}`,han:`×${birdMultiplier}`}]:[])],hand:[...player.hand,...(selfDraw?[]:[tile])],winningTile:tile,melds:player.melds.map(meld=>({...meld,tiles:[...meld.tiles]})),payments:this.players.map((p,i)=>p.points-beforeWinner[i])};
      this.roundWinners.push(win);eventWinners.push(win);player.winCount++;player.hasWon=true;player.canSelfWin=false;
      this.log(`${NAMES[id]}${selfDraw?'自摸':'和牌'}，${score.yaku.map(y=>y.name).join('·')}，收取${player.points-before[id]}${this.profile.id==='sanma'?'点':'分'}`,id,tile);
    }
    this.latestWin=structuredClone({id:`regional:${this.displaySessionId}:${++this.winEventSequence}`,winners:eventWinners,deltas:this.players.map((p,i)=>p.points-before[i]),scores:this.players.map(p=>p.points),continuing:!(this.profile.continuing==='none'||this.profile.continuing==='blood'&&this.active().length<=1)});
    if(this.profile.continuing==='none'||this.profile.continuing==='blood'&&this.active().length<=1){this.finishRound('win',winners.length>1?'一炮多响':selfDraw?'自摸和牌':'和牌');return;}
    if(this.profile.continuing==='river'&&selfDraw){this.stage='discard';this.actions=this.ownChoices(this.players[this.turn]);return;}
    this.turn=this.nextActive(from??this.turn);this.stage='draw';this.actions=[];
  }
  private maxReadyValue(player:Player):number{
    const owned=countsOf([...player.hand,...player.melds.flatMap(m=>m.tiles)]);
    let max=0;
    for(const tile of this.tileUniverse()){
      if(owned[tileIndex(tile)]>=4)continue;
      // 查叫 is a hypothetical ordinary win, not the final discard/rob-kong event.
      const score=scoreHand({...this.context(player,tile,false),lastTile:false,kongDraw:false,robbingKong:false,firstDraw:false,visibleWinningCopies:0});
      if(score)max=Math.max(max,score.base);
    }
    return max;
  }
  private finishDraw(){
    const ready=this.players.map(p=>this.profile.id==='sanma'?this.shapeWaits(p).length>0:this.maxReadyValue(p)>0);
    if(this.profile.id==='sanma'){
      const count=ready.filter(Boolean).length;if(count>0&&count<this.profile.players)for(const p of this.players)if(!ready[p.id])for(const winner of this.players)if(ready[winner.id])this.transfer(p.id,winner.id,3000/count/(this.profile.players-count));
    }
    if(this.profile.id.startsWith('sichuan')){
      const pigs=this.players.filter(p=>p.hand.some(t=>t[0]===p.voidSuit));
      for(const pig of pigs)for(const p of this.players)if(!pigs.includes(p))this.transfer(pig.id,p.id,16);
      const remaining=this.players.filter(p=>!p.hasWon&&!pigs.includes(p));
      for(const p of remaining)if(!ready[p.id])for(const listener of remaining)if(ready[listener.id])this.transfer(p.id,listener.id,this.maxReadyValue(listener));
      const refund=new Set(this.players.filter(p=>!p.hasWon&&!ready[p.id]).map(p=>p.id));
      for(const payment of this.kongTransfers)if(refund.has(payment.to))this.transfer(payment.to,payment.from,payment.amount);
      this.log('流局查花猪、查大叫与退杠完成');
    }
    this.finishRound('draw',this.roundWinners.length?'牌山耗尽 · 本局结束':'荒牌流局',ready);
  }
  private finishRound(kind:'win'|'draw',title:string,tenpai?:boolean[]){
    this.stage='settlement';this.actions=[this.action('next','next',this.options.matchLength==='single'?'查看最终排名':'继续下一局')];
    this.result={kind,title,description:kind==='draw'?'牌山耗尽，按本桌规则完成结算。':'和牌、役种和收支如下。',winners:[...this.roundWinners],deltas:this.players.map((p,i)=>p.points-this.roundStart[i]),scores:this.players.map(p=>p.points),tenpai};
    this.log(title);
  }
  private continueRound(){
    const dealerWon=this.roundWinners.some(w=>w.playerId===this.dealer),dealerReady=!!this.result?.tenpai?.[this.dealer],draw=this.result?.kind==='draw';
    const repeat=this.profile.id!=='mcr'&&(dealerWon||(draw&&(this.profile.id==='sanma'?dealerReady:['taiwan','hangzhou','hongkong'].includes(this.profile.id))));
    if(repeat)this.honba++;else{this.dealer=(this.dealer+1)%this.profile.players;this.roundNumber++;this.honba=draw?this.honba+1:0;}
    const maxRounds=this.options.matchLength==='single'?0:this.options.matchLength==='east'?this.profile.players:this.profile.players*2;
    const end=this.options.matchLength!=='endless'&&(this.options.matchLength==='single'||this.roundNumber>=maxRounds||this.players.some(p=>p.points<0));
    if(end){
      const order=[...this.players].sort((a,b)=>b.points-a.points||a.id-b.id);if(this.sticks){order[0].points+=this.sticks*1000;this.sticks=0;}
      this.stage='match';this.actions=[];this.result={kind:'match',title:'对局结束',description:`${NAMES[order[0].id]}获得第一名`,winners:[],deltas:Array(this.profile.players).fill(0),scores:this.players.map(p=>p.points),ranks:this.players.map(p=>order.findIndex(x=>x.id===p.id)+1)};
    }else this.deal();
  }
  private observation(player:Player):BotObservation{
    return {ownId:player.id,seat:this.seat(player.id),roundWind:Math.floor(this.roundNumber/this.profile.players)%4,roundHand:this.roundNumber%this.profile.players+1,finalRound:this.options.matchLength!=='endless'&&this.roundNumber>=(this.options.matchLength==='hanchan'?2:1)*this.profile.players-1,playerCount:this.profile.players,ownHand:coreString(player.hand,player.melds,player.drawn||undefined),doraIndicators:this.profile.id==='sanma'?this.dora:[],additionalPublicTiles:[...this.players.flatMap(p=>Array(p.kita).fill('z4')),...(this.profile.id==='sanma'?[]:this.dora)],tilesLeft:this.wall.length,honba:this.honba,riichiSticks:this.sticks,players:this.players.map(p=>({id:p.id,seat:this.seat(p.id),points:p.points,dealer:p.id===this.dealer,riichi:p.riichi,melds:p.melds.map(coreMeld),discards:p.discards.map(d=>({...d}))})),allowOpenTanyao:true,seed:`public:${player.hand.join('')}:${this.players.map(p=>p.discards.map(d=>d.tile).join('')).join('/')}:${this.wall.length}`,discardFuriten:this.profile.id==='sanma',tileLimits:countsOf(profileTiles(this.profile)),wildcards:this.wildcard?[this.wildcard]:[],pointScale:this.profile.id==='sanma'?1:.001,expectedDealInValue:this.profile.id==='sanma'?5200:8,dealerValueMultiplier:this.profile.id==='sanma'?1.5:1};
  }
  private botChoice(player:Player,choices:Choice[]):Choice{
    const difficulty=player.id===0?this.options.autoPlayDifficulty:this.options.difficulty;
    // Every physical copy remains selectable by the human. The AI retains its
    // original canonical candidate set, including the separate actual drawn tile.
    const seen=new Set<string>();
    choices=choices.filter(choice=>{
      if(choice.type!=='discard'&&choice.type!=='riichi')return true;
      const key=`${choice.type}:${choice.tile}:${player.drawn&&choice.index===player.hand.length-1?'draw':'hand'}`;
      if(seen.has(key))return false;seen.add(key);return true;
    });
    const win=choices.find(c=>c.type==='ron'||c.type==='tsumo');if(win)return win;
    const kita=choices.find(c=>c.type==='kita');if(kita)return kita;
    const discards=choices.filter(c=>c.type==='discard'||c.type==='riichi');
    const observation=this.observation(player);
    const visible=countsOf([...player.hand,...this.players.flatMap(p=>[...p.discards.filter(d=>!d.called).map(d=>d.tile),...p.melds.flatMap(m=>m.tiles),...Array(p.kita).fill('z4')]),...this.dora]);
    const current=this.distance(player.hand,player.melds);
    const evaluations=new Map<number,{distance:number;ukeire:number;shape:number;after:string[]}>();
    const evaluate=(index:number)=>{
      let metric=evaluations.get(index);if(metric)return metric;
      const after=player.hand.filter((_,i)=>i!==index),distance=this.distance(after,player.melds);
      let ukeire=0;for(const tile of this.tileUniverse()){
        const remaining=Math.max(0,4-visible[tileIndex(tile)]);
        if(remaining>0&&this.distance([...after,tile],player.melds)<distance)ukeire+=remaining;
      }
      const shape=after.reduce((sum,t)=>sum+(after.some(q=>q!==t&&q[0]===t[0]&&Math.abs(Number(q[1])-Number(t[1]))<=2)?2:0)+(after.filter(q=>norm(q)===norm(t)).length>1?3:0),0);
      metric={distance,ukeire,shape,after};evaluations.set(index,metric);return metric;
    };
    if(discards.length){
      const candidates:GenericCandidate[]=discards.map(choice=>{const metric=evaluate(choice.index!);return {key:choice.key,tile:choice.tile,shanten:metric.distance,ukeire:metric.ukeire,shapeScore:metric.shape,estimatedValue:this.profile.id==='sanma'?(choice.type==='riichi'?3900:2000):this.profile.id==='mcr'?24:4};});
      if(difficulty==='expert'){
        const leading=[...candidates].sort((a,b)=>a.shanten-b.shanten||b.ukeire-a.ukeire).slice(0,3),draws=samplePublicDraws(observation,3,2);
        for(const candidate of leading){const choice=discards.find(c=>c.key===candidate.key)!,after=evaluate(choice.index!).after;let gain=0;
          for(const sequence of draws){let hand=[...after],distance=candidate.shanten;
            for(const tile of sequence){hand.push(tile);let best=Infinity,bestIndex=hand.length-1;for(let i=0;i<hand.length;i++){const d=this.distance(hand.filter((_,j)=>j!==i),player.melds);if(d<best){best=d;bestIndex=i;}}hand.splice(bestIndex,1);distance=best;}
            gain+=candidate.shanten-distance;
          }
          candidate.lookahead=gain/Math.max(1,draws.length)*(this.profile.id==='sanma'?350:1);
        }
      }
      const ranked=rankPublicCandidates(observation,candidates,difficulty);return discards.find(choice=>choice.key===ranked.key)||discards[0];
    }
    for(const choice of choices.filter(c=>['pon','chi','kan'].includes(c.type))){
      if(this.profile.id==='sanma'&&this.players.some(p=>p.id!==player.id&&p.riichi))continue;
      const after=[...player.hand];for(const tile of choice.consume||choice.tiles||[]){const i=after.indexOf(tile);if(i>=0)after.splice(i,1);}
      const melds=[...player.melds,{id:'candidate',type:choice.type==='kan'?'kan':choice.type==='pon'?'pon':'chi',tiles:choice.tiles||[],concealed:choice.kind==='concealed'} as MeldView];
      const distance=this.distance(after,melds);
      const needsOpen=['wuhan','northeast'].includes(this.profile.id)&&!player.melds.some(m=>!m.concealed);
      if(distance<current||needsOpen&&distance<=current||choice.type==='kan'&&distance<=current)return choice;
    }
    return choices.find(c=>c.type==='pass')||choices[0];
  }
  private tick(){
    if(this.disposed||this.stage==='settlement'||this.stage==='match')return;
    if(this.stage==='exchange'&&(!this.options.autoPlay||!this.options.autoExchangeThree))return;
    this.step++;
    if(this.stage==='exchange'){
      this.exchangeSelection=new Set(this.chooseExchange(this.players[0]));this.record(`exchange-auto:${[...this.exchangeSelection].join(',')}`);this.exchange();
    }else if(this.stage==='void'){
      if(!this.options.autoPlay)return;const p=this.players[0],suit=['m','p','s'].sort((a,b)=>p.hand.filter(t=>t[0]===a).length-p.hand.filter(t=>t[0]===b).length)[0];this.record(`void:${suit}`);this.declareVoid(suit);
    }else if(this.stage==='draw')this.draw();
    else if(this.stage==='discard'){
      const quick=this.turn===0&&!this.options.autoPlay?this.quickChoice():undefined;
      if(this.turn===0&&!this.options.autoPlay&&!quick)return;
      const player=this.players[this.turn],choice=quick||this.botChoice(player,this.actions);if(player.id===0)this.record(choice.key);this.execute(player,choice);
    }else if(this.stage==='response'){
      if(this.actions.length&&!this.response!.replies.has(0)){
        const quick=!this.options.autoPlay?this.quickChoice():undefined;
        if(!this.options.autoPlay&&!quick)return;const choice=quick||this.botChoice(this.players[0],this.actions);this.record(choice.key);this.response!.replies.set(0,choice);
      }
      this.resolve();
    }
    this.publish();
  }
  private record(key:string){this.decisions.push({key});}
  private quickChoice():Choice|undefined{
    if(this.replaying||!((this.stage==='discard'&&this.turn===0)||(this.stage==='response'&&!this.response?.replies.has(0))))return undefined;
    const player=this.players[0],drawn=this.stage==='discard'&&player.drawn?this.handId(0,player.hand.length-1):undefined;
    return chooseQuickAction(this.actions,this.quickControls,drawn);
  }
  private waitingForHuman(){
    if(this.stage==='exchange')return !this.options.autoPlay||!this.options.autoExchangeThree;
    return (this.stage==='void'||this.stage==='discard'&&this.turn===0||this.stage==='response'&&this.actions.length>0&&!this.response?.replies.has(0))&&!this.options.autoPlay&&!this.quickChoice();
  }
  private schedule(){
    if(this.replaying||this.disposed||this.timer!==null||this.stage==='settlement'||this.stage==='match'||this.waitingForHuman())return;
    this.timer=setTimeout(()=>{this.timer=null;this.tick();this.schedule();},this.options.speed);
  }
  dispatch(actionId:string):boolean{
    const choice=this.actions.find(c=>c.id===actionId);if(!choice||this.disposed)return false;this.cancel();
    if(this.stage==='exchange'){
      if(choice.type==='exchange'){if(this.exchangeSelection.has(choice.index!))this.exchangeSelection.delete(choice.index!);else if(this.exchangeSelection.size<3)this.exchangeSelection.add(choice.index!);this.exchangeActions();}
      else{this.record(`exchange-auto:${[...this.exchangeSelection].join(',')}`);this.step++;this.exchange();}
    }else if(this.stage==='void'){this.record(choice.key);this.step++;this.declareVoid(choice.tile!);}
    else if(this.stage==='settlement'){this.record('next');this.step++;this.continueRound();}
    else if(this.stage==='response'){this.record(choice.key);this.step++;this.response!.replies.set(0,choice);this.resolve();}
    else if(this.stage==='discard'&&this.turn===0){this.record(choice.key);this.step++;this.execute(this.players[0],choice);}
    else return false;
    this.publish();this.schedule();return true;
  }
  setAutoPlay(enabled:boolean){this.options.autoPlay=enabled;this.cancel();this.publish();this.schedule();}
  setAutoPlayDifficulty(difficulty:Difficulty){if(!validDifficulty(difficulty)||this.options.autoPlayDifficulty===difficulty)return;this.options.autoPlayDifficulty=difficulty;this.cancel();this.publish();this.schedule();}
  setAutoExchangeThree(enabled:boolean){this.options.autoExchangeThree=enabled;this.cancel();this.publish();this.schedule();}
  setQuickControls(controls:Partial<QuickControls>){this.quickControls=updateQuickControls(this.quickControls,controls);this.cancel();this.publish();this.schedule();}
  setSpeed(milliseconds:number){this.options.speed=Math.max(0,Math.min(3000,Number.isFinite(milliseconds)?milliseconds:450));this.cancel();this.publish();this.schedule();}
  private publish(){
    if(this.replaying&&!this.replayFrames)return;
    const humanActions=this.stage==='discard'&&this.turn!==0?[]:this.actions;
    const human=this.players[0],distance=this.distance(human.hand,human.melds);
    this.snapshot={status:this.stage==='match'?'matchEnd':this.stage==='settlement'?'roundEnd':'playing',phase:this.stage==='exchange'?'exchange':this.stage==='void'?'void':this.stage==='settlement'||this.stage==='match'?'settlement':this.stage==='discard'&&this.turn===0?'discard':this.stage==='response'&&humanActions.length?'response':'waiting',seed:this.options.seed,players:this.players.map(player=>({id:player.id,name:NAMES[player.id],wind:WINDS[this.seat(player.id)],points:player.points,dealer:player.id===this.dealer,riichi:player.riichi,isHuman:player.id===0,hand:player.id===0?player.hand.map((tile,index)=>({id:this.handId(player.id,index),tile,label:tileLabel(tile),drawn:!!player.drawn&&index===player.hand.length-1})):[],concealedCount:player.hand.length,discards:player.discards.map(d=>({...d})),melds:player.melds.map(m=>({...m,tiles:[...m.tiles]})),flowers:[...player.flowers],kita:player.kita,voidSuit:player.voidSuit,hasWon:player.hasWon,winCount:player.winCount,...(this.stage==='settlement'&&this.roundWinners.some(w=>w.playerId===player.id)?{revealedHand:[...this.roundWinners.filter(win=>win.playerId===player.id).at(-1)!.hand]}:{})})),round:{wind:WINDS[Math.floor(this.roundNumber/this.profile.players)%4],hand:this.roundNumber%this.profile.players+1,honba:this.honba,riichiSticks:this.sticks,tilesLeft:this.wall.length,doraIndicators:[...this.dora],uraIndicators:this.stage==='settlement'&&this.roundWinners.some(w=>this.players[w.playerId].riichi)?[...this.ura]:[],dealer:this.dealer,wildcard:this.wildcard},turn:this.turn,humanId:0,actions:humanActions.map(({key:_key,index:_index,consume:_consume,kind:_kind,meldIndex:_meldIndex,...action})=>action),message:this.stage==='exchange'?'选择三张同花色的牌交换':this.stage==='void'?'请选择本局定缺花色':this.stage==='settlement'?this.result?.title||'本局结束':this.stage==='match'?'对局结束':this.stage==='discard'&&this.turn===0?'轮到你了 · 选择一张牌打出':this.stage==='response'&&humanActions.length?'请选择和牌、鸣牌或跳过':`${NAMES[this.turn]}正在思考…`,log:[...this.logs],result:this.result?structuredClone(this.result):null,...(this.latestWin?{latestWin:structuredClone(this.latestWin)}:{}),autoPlay:this.options.autoPlay,speed:this.options.speed,revision:++this.revision,shanten:distance,waits:distance===0?this.shapeWaits(human):[],mode:this.profile.id,modeName:getMode(this.profile.id).name,difficulty:this.options.difficulty,playerCount:this.profile.players,handSize:this.profile.sets*3+1,scoreUnit:this.profile.id==='sanma'?'点':'分',setupSelection:[...this.exchangeSelection].map(i=>this.handId(0,i)),ruleSummary:[...this.profile.summary]};
    if(this.options.matchLength==='endless')this.snapshot.round.sequence=this.handSequence;
    if(this.profile.id==='sanma')this.snapshot.riichiAssist=this.calculateAssist(projectRiichiAssist(this.snapshot),{temporary:human.temporaryFuriten,riichiPass:human.permanentFuriten});
    this.snapshot.quickControls={...this.quickControls};
    this.snapshot.autoPlayDifficulty=this.options.autoPlayDifficulty;
    this.snapshot.autoExchangeThree=this.options.autoExchangeThree;
    if(this.ronNotice)this.snapshot.ronNotice=structuredClone(this.ronNotice);
    if(this.selfWinNotice&&this.stage==='discard'&&this.turn===0)this.snapshot.selfWinNotice=structuredClone(this.selfWinNotice);
    if(this.stage==='exchange'&&this.options.autoPlay&&!this.options.autoExchangeThree)this.snapshot.message='选择三张同花色的牌，确认换三张后继续托管';
    if(this.replayFrames)appendReplayFrame(this.replayFrames,this.snapshot,Object.fromEntries(this.players.map(player=>[player.id,[...player.hand]])));
    if(this.replaying)return;
    for(const listener of this.listeners)listener();
  }
  getSavedGame():SavedGame{return {version:1,seed:this.options.seed,matchLength:this.options.matchLength,mode:this.profile.id,difficulty:this.options.difficulty,startPoints:this.options.startPoints,autoPlayDifficulty:this.options.autoPlayDifficulty,autoExchangeThree:this.options.autoExchangeThree,aiVersion:this.aiVersion,replayPosition:this.step,variantOptions:this.options.variantOptions,decisions:this.decisions.map(d=>({...d})),...(this.checkpoint?{checkpoint:structuredClone(this.checkpoint)}:{})};}
  exportReplay():ReplayData{return {...this.getSavedGame(),rules:{mode:this.profile.id,version:getMode(this.profile.id).ruleVersion,summary:this.profile.summary},log:this.logs.map(l=>({...l}))};}
  loadSavedGame(data:SavedGame):boolean{
    if(!data||data.version!==1||data.mode!==this.profile.id||typeof data.seed!=='string'||!Array.isArray(data.decisions)||data.decisions.length>20000||!data.decisions.every(d=>typeof d?.key==='string')||data.difficulty&&!validDifficulty(data.difficulty))return false;
    try{validateReplayData(data);}catch{return false;}
    const previous=this.getSavedGame();
    const restore=(save:SavedGame)=>{
      this.aiVersion=save.aiVersion??2;
      this.replaying=true;this.initialize({seed:save.seed,mode:save.mode,difficulty:save.difficulty||'standard',startPoints:restoredStartPoints(save),autoPlayDifficulty:save.autoPlayDifficulty??'expert',autoExchangeThree:save.autoExchangeThree??false,variantOptions:save.variantOptions,matchLength:save.matchLength,autoPlay:false,quickControls:DEFAULT_QUICK_CONTROLS},save.checkpoint);let cursor=0;
      for(let guard=0;guard<100000;guard++){
        if(save.replayPosition!=null&&this.step>=save.replayPosition&&cursor===save.decisions.length)break;
        if(save.replayPosition!=null&&this.step>save.replayPosition)return false;
        const manual=this.stage==='exchange'||this.stage==='void'||this.stage==='settlement'||this.stage==='discard'&&this.turn===0||this.stage==='response'&&this.actions.length>0&&!this.response?.replies.has(0);
        if(manual){if(cursor>=save.decisions.length)break;const key=save.decisions[cursor++].key;
          if(this.stage==='exchange'&&key.startsWith('exchange-auto:')){const selected=key.slice(14).split(',').map(Number);if(selected.length!==3||new Set(selected).size!==3||selected.some(n=>!Number.isInteger(n)||n<0||n>=this.players[0].hand.length)||new Set(selected.map(i=>this.players[0].hand[i][0])).size!==1)return false;this.exchangeSelection=new Set(selected);this.record(key);this.step++;this.exchange();}
          else{const choice=this.actions.find(c=>c.key===key);if(!choice||!this.dispatch(choice.id))return false;}
        }else if(this.stage==='match')break;else this.tick();
      }
      return cursor===save.decisions.length&&(save.replayPosition==null||this.step===save.replayPosition);
    };
    let success=false;try{success=restore(data);}catch{success=false;}
    if(!success){try{restore(previous);}catch{this.newGame({autoPlay:false});}}
    this.replaying=false;this.publish();this.schedule();return success;
  }
  /** Used only on a disposable session; never emits reconstructed live events. */
  async captureReplayFrames(data:SavedGame):Promise<ReplayFrame[]>{
    validateReplayData(data);this.cancel();this.replaying=true;this.replayFrames=[];this.aiVersion=data.aiVersion??2;
    this.initialize({seed:data.seed,mode:data.mode,difficulty:data.difficulty||'standard',startPoints:restoredStartPoints(data),autoPlayDifficulty:data.autoPlayDifficulty??'expert',autoExchangeThree:data.autoExchangeThree??false,variantOptions:data.variantOptions,matchLength:data.matchLength,autoPlay:false,speed:0,quickControls:DEFAULT_QUICK_CONTROLS},data.checkpoint);
    let cursor=0;
    for(let guard=0;guard<MAX_REPLAY_STEPS;guard++){
      const exactEnd=data.replayPosition!=null;
      if(exactEnd&&this.step>data.replayPosition!)throw new Error('牌谱结束位置与操作记录不一致。');
      if(cursor===data.decisions.length&&(!exactEnd||this.step===data.replayPosition))break;
      const manual=this.stage==='exchange'||this.stage==='void'||this.stage==='settlement'||this.stage==='discard'&&this.turn===0||this.stage==='response'&&this.actions.length>0&&!this.response?.replies.has(0);
      if(manual){
        if(cursor>=data.decisions.length)throw new Error('牌谱在等待玩家操作处提前结束。');
        const key=data.decisions[cursor++].key;
        if(this.stage==='exchange'&&key.startsWith('exchange-auto:')){
          const selected=key.slice(14).split(',').map(Number);
          if(selected.length!==3||new Set(selected).size!==3||selected.some(n=>!Number.isInteger(n)||n<0||n>=this.players[0].hand.length)||new Set(selected.map(i=>this.players[0].hand[i][0])).size!==1)throw new Error('牌谱包含无效换三张操作。');
          this.exchangeSelection=new Set(selected);this.record(key);this.step++;this.exchange();this.publish();
        }else{
          const choice=this.actions.find(action=>action.key===key);
          if(!choice||!this.dispatch(choice.id))throw new Error('牌谱包含当前规则不允许的操作。');
        }
      }else if(this.stage==='match')break;else this.tick();
      if(guard%48===47)await yieldReplayWork();
    }
    if(cursor!==data.decisions.length||(data.replayPosition!=null&&this.step!==data.replayPosition))throw new Error('牌谱未能在记录的位置结束，可能已损坏或超限。');
    return finishReplayFrames(this.replayFrames);
  }
  dispose(){this.disposed=true;this.cancel();this.listeners.clear();}
}
