// Public board fixtures for the long tails (sanma, added kan, restore). They
// never run in the game and do not need a neural model, timers or WebGL.
import type { GameSnapshot, HandTile, MeldView, ModeId } from '../../src/game/types';
import { riverSelectionScope } from '../../src/presentation/riverMatches';
import { continuousClaimPreview, cueTravel, motionDuration, riverClaimMs, soundStartDelay, tableMotionCues, type TableMotionKind } from '../../src/presentation/tableTimeline';
import { claimLane, classicDeal, classicGesture, classicReveal, emptyGesture, type PhysicalMove } from '../../src/table/motion/classicGestures';
import { createTableMotionController, wallMotionKey } from '../../src/table/motion/tableMotion';
import { wallTileTransform } from '../../src/table/wallLayout';
import { classicBlockers, footprint, lowerExtent, meldEntryOffset, meldEntryRun, strokeHeight, tightEnd, touchedBlocks } from '../../src/table/motion/classicClearance';
import { meldView } from '../../src/game/meldView';
import { seatLayout, HAND_ROW_Z } from '../../src/table/tableLayout';
import { meldReadingOrder } from '../../src/game/meldView';
import { meldSourceText } from '../../src/presentation/meldSource';
import { prepareTileArt } from '../../src/table/tileArt';
import { tileSurface } from '../../src/table/tileTextures';
import { getTheme } from '../../src/table/themes';
import { riverLayout } from '../../src/table/riverLayout';
import { tableSeat } from '../../src/table/themes';
import { tilePlacement } from '../../src/table/tilePlacement';
import { tileRestHeight } from '../../src/table/tableMaterials';
import { SoundLibrary, tableSample } from '../../src/audio/synthesis';
import { placeMeldCall } from '../../src/table/motion/meldCallLayout';

const eq=(a:unknown,b:unknown,why:string)=>{if(JSON.stringify(a)!==JSON.stringify(b)) throw Error(why+': '+JSON.stringify(a)+' vs '+JSON.stringify(b));};
const near=(a:number,b:number,why:string)=>{if(!Number.isFinite(a) || Math.abs(a-b)>1e-6) throw Error(why+': '+a+' vs '+b);};
const tile=(id:string,drawn=false): HandTile=>({id,tile:id.split('-')[0],label:'',drawn});
export async function checkRiverInk() {
  await prepareTileArt();
  const coverage=(c:HTMLCanvasElement)=>{
    const pixels=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;
    let ink=0; for(let i=0;i<pixels.length;i+=4) if(.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2]<145) ink++;
    return ink;
  };
  for(const code of ['m2','s3','m0']) {
    const theme=getTheme(), hand=tileSurface(code,theme), river=tileSurface(code,theme,true);
    const original=coverage(hand.map.image), enhanced=coverage(river.map.image);
    eq(original>0 && enhanced>original*1.10,true,code+' readable strokes retain more ink before minification');
    eq(tileSurface(code,theme).map===hand.map && river.map!==hand.map,true,'the hand texture is independent of the river ink');
  }
  const dots=tileSurface('s3',getTheme(undefined,true),true);
  eq([dots.map.image.width,dots.map.image.height,dots.map.generateMipmaps],[32,44,false],'mesh fallback keeps its native pixel strike');
  return 'PASS: stronger classic manzu/souzu and red-five river strokes, untouched hand art, native pixel mesh ink';
}
function table(mode:ModeId='riichi'): GameSnapshot {
  return {mode, status:'playing',phase:'discard',seed:'movement-fixture',turn:0,humanId:0,actions:[],message:'',log:[],result:null,
    autoPlay:false,speed:650,revision:11,shanten:null,waits:[],
    round:{wind:'东',hand:1,honba:0,dealer:0,riichiSticks:0,tilesLeft:30,doraIndicators:['p2'],uraIndicators:[]},
    players:Array.from({length:mode==='sanma'?3:4},(_,id)=>({id,name:String(id),wind:'东南西北'[id],points:25000,dealer:id===0,
      riichi:false,isHuman:id===0,hand:[],concealedCount:13,discards:[],melds:[]}))};
}
export function run() {
  const face={left:450,top:258,right:540,bottom:295};
  for(const pixel of [false,true]) for(const side of [0,1,2,3]) {
    const placed=placeMeldCall(face,side,1000,650,pixel)!;
    eq(side===1 ? placed.left>face.right : side===3 ? placed.right<face.left : placed.bottom<face.top,true,'call on clear side '+side);
    if(pixel) eq([placed.left%2,placed.top%2],[0,0],'native integer pixel strike');
    const alt=placeMeldCall(face,side,1000,650,pixel,[placed])!;
    eq(alt.right<=placed.left || alt.left>=placed.right || alt.top>=placed.bottom || alt.bottom<=placed.top,true,'take a free shoulder or edge, not the wall');
    eq(placeMeldCall(face,side,1000,650,pixel,[{left:0,top:0,right:1000,bottom:650}]),null,'do not paint across a busy surface');
  }
  const g=emptyGesture();
  const basic:TableMotionKind[]=['draw','discard','chi','pon','kan','riichi','kita'];
  const beats={draw:105,discard:0,chi:0,pon:0,kan:0,riichi:100,kita:174};
  const source={seat:1,riverIndex:0,tile:'z5',tileIndex:2};
  for (const k of basic) for(const speed of [250,650,1100]) {
    const d=motionDuration(k,speed,false,'classic');
    const across=continuousClaimPreview && (k==='chi' || k==='pon');
    eq(d<speed && d<=(across ? riverClaimMs : 232),true,k+' brief, inside engine step'); eq(motionDuration(k,speed,true,'classic'),0,'reduced motion');
    near(soundStartDelay({kind:k,source},speed,false,'classic')+beats[k],d,k+' last clack is the stop');
  }
  for(const kind of [...basic,'indicator','insert'] as PhysicalMove[]) for(const t of [0,.2,.5,.8,1]) {
    classicGesture(g,kind,t,3); eq(Object.values(g).every(Number.isFinite),true,kind+' finite');
    if(t===0||t===1) eq([g.travel,g.heightMix,g.turn,g.lift,g.across,g.forward],[t,t,t,0,0,0],kind+' exact endpoint');
  }
  classicGesture(g,'insert',.5,3); eq(g.forward>.65 && g.travel>.2 && g.travel<.8,true,'clearance in front of the row');
  classicGesture(g,'indicator',.5,0); near(g.turn,.5,'indicator pivots on the stack instead of hovering'); eq(g.lift<=.32,true,'only edge clearance');
  let prev=0;
  for(let i=1;i<=20;i++) {
    classicGesture(g,'discard',i/20,4); eq(g.travel>prev && g.travel<=1 && g.lift<=.066,true,'low monotone push'); prev=g.travel;
    if(i>=13) near(g.turn,1,'already face-up on approach');
    classicGesture(g,'discard',i/20,4,'released'); near(g.lift,0,'no second pickup for a dragged tile');
  }
  eq(motionDuration('discard',650,false,'classic'),160,'discard tempo'); eq(motionDuration('pon',650,false,'classic'),continuousClaimPreview?riverClaimMs:128,'pon contact'); eq(motionDuration('chi',650,false,'classic'),continuousClaimPreview?riverClaimMs:160,'chi contact');
  for(const style of ['pixel','classic'] as const) for(const call of ['chi','pon','kan'] as const) {
    for(const speed of [80,250,650]) {
      near(soundStartDelay({kind:call,source},speed,false,style),motionDuration(call,speed,false,style),'reward at actual discard contact');
      near(soundStartDelay({kind:call},speed,false,style),0,'an ambiguous source never invents a slide');
      if(call==='kan') for(const kanEntry of ['concealed','added'] as const) {
        near(soundStartDelay({kind:call,kanEntry},speed,false,style),motionDuration('kan',speed,false,style),'self-kan contact follows the slide');
        near(cueTravel({kind:call,kanEntry},speed,true,style),0,'reduced motion is instantaneous even on self-kan');
      }
    }
    near(soundStartDelay({kind:call,source},650,true,style),0,'reduced motion hears the contact immediately');
  }
  eq(motionDuration('discard',650,false,'pixel'),230,'pixel exposures unchanged');
  const track=[0,5.8,0,1.9], occupied=touchedBlocks(classicBlockers(100),track,1), empty=touchedBlocks(classicBlockers(68),track,1);
  eq(occupied.length,1,'route crosses one wall'); eq(empty.length,0,'depleted wall causes no phantom lift');
  eq(touchedBlocks(classicBlockers(100),[-3,5.9,3,5.9],.75).length,0,'rack-side movement is not a wall crossing');
  const bottom=lowerExtent({x:-Math.SQRT1_2,y:0,z:0,w:Math.SQRT1_2},1);
  near(bottom,.21,'flat rigid tile extent');
  near(strokeHeight(empty,0,4.5,.32,bottom,1,.5),.32,'open felt is a push, not a lob');
  eq(strokeHeight(occupied,0,4.5,.32,bottom,1,.5)-bottom>=occupied[0].top,true,'bottom clears the occupied stack');
  near(strokeHeight(occupied,0,4.5,.32,bottom,1,1),.32,'exact endpoint on a congested path');
  near(classicBlockers(86).at(-1)!.top-classicBlockers(85).at(-1)!.top,.395*.96,'partial stacks are one layer low');
  const rows=table('sanma');
  const d={tile:'m3',riichi:false,called:false,tsumogiri:false};
  rows.players[0].discards=[{...d},{...d}]; rows.players[2].discards=[{...d,called:true,riichi:true},{...d}];
  const faces=classicBlockers(0,rows.players).filter(b=>b.piece);
  eq(faces.length,3,'only visible public discard faces');
  const dest=faces.find(b=>b.piece==='river:0:1')!, neighbour=faces[0];
  const r=footprint({x:-Math.SQRT1_2,y:0,z:0,w:Math.SQRT1_2},.78);
  eq(touchedBlocks(faces,[dest.x,dest.z+1,dest.x,dest.z],.78,[r,r],dest.piece).length,0,'normal docking ignores self and misses adjacent slot');
  eq(touchedBlocks(faces,[neighbour.x-1,neighbour.z,neighbour.x+1,neighbour.z],.78,[r,r]).includes(neighbour),true,'crossed river stops a low sweep');
  const extraction=[dest.x,dest.z,dest.x-.12,dest.z+.08,dest.x-.32,dest.z+.18], feet=[r,r,r];
  const edge=touchedBlocks(faces,extraction,.78,feet,dest.piece);
  eq(tightEnd(edge,extraction,feet,false,.086),true,'clear the neighbouring edge before pulling diagonally out of a row');
  eq(tightEnd([],extraction,feet,false,.086),false,'no takeoff pause on an open route');
  near(faces.at(-1)!.cos,1,'three-player physical seat and transferred sideways declaration');
  const p0=classicDeal(emptyGesture(),0,0,1.2), p1=classicDeal(emptyGesture(),0,1,1.2);
  eq(Math.abs(.695+p1.across-p0.across)<.01 && p1.lift>p0.lift+.4,true,'adjacent tiles start stacked');
  eq(classicReveal(.2,0,14)>classicReveal(.2,13,14),true,'public reveal travels along hand');
  near(classicReveal(1,13,14),1,'last tile reaches reveal contact'); near(classicReveal(0,13,14),0,'return-to-hand complete');

  const local=createTableMotionController(), s=table(), held=[tile('m1'),tile('p9'),tile('z1'),tile('m3',true)];
  const base=local.update(s,held,'z1',false), drawnKey=base.hand.at(-1)!.key;
  const scope=riverSelectionScope(s), release:[number,number,number]=[-1,1.45,3.6];
  local.captureReleaseOrigin('z1',scope,release,[-.31,0,0]);
  const next=structuredClone(s); next.revision++; next.players[0].discards.push({tile:'z1',called:false,riichi:false,tsumogiri:false});
  const ordered=[tile('m1'),tile('m3'),tile('p9')];
  const frame=local.update(next,ordered,null,false,{sequence:2,tileId:'z1',selectionScope:scope});
  eq(frame.motions.get('river:0:0')?.from,release,'release from actual dragged location');
  eq(frame.motions.get('river:0:0')?.origin,'released','drag origin');
  eq(frame.hand[1].key,drawnKey,'new slot preserves drawn tile identity');
  eq(frame.motions.get(drawnKey)?.kind,'insert','formerly drawn tile inserts');
  eq([...frame.motions.values()].filter(m=>m.kind==='insert').length,1,'one lead insertion');
  const insert=frame.motions.get(drawnKey);
  eq(local.update(next,ordered,null,false).motions.get(drawnKey)===insert,true,'rerenders do not restart the path');
  eq(local.update(next,ordered,null,false,null,undefined,0,0,'pixel').motions.size,0,'mode switch is quiet');

  const cc=createTableMotionController(), offer=table();
  offer.players[2].discards=[{tile:'p5',riichi:false,called:false,tsumogiri:false}];
  const copies=[tile('p5-a'),tile('p5-b'),tile('p5-c')], sourceSlots=cc.update(offer,copies,null,false).hand;
  const pon=structuredClone(offer); pon.revision++; pon.players[2].discards[0].called=true;
  pon.players[0].melds=[{id:'triplet',tiles:['p5','p5','p5'],type:'pon',from:2,concealed:false,calledIndex:2}];
  const calledFrame=cc.update(pon,[copies[0]],null,false);
  eq(calledFrame.hand[0].key,sourceSlots[0].key,'the spare third copy keeps its slot identity');
  eq([...calledFrame.motions.keys()],['meld:0:0:2'],'only the river dragon moves on pon');
  const moving=calledFrame.motions.get('meld:0:0:2')!;
  eq(moving.origin,continuousClaimPreview ? 'river-claim' : 'meld-edge','only the claimed tile has a stroke');
  near(moving.duration,motionDuration('pon',650,false,'classic'),'one impact at the stop');
  if (continuousClaimPreview) {
    // Interrupt the source discard while its body is tilted, airborne and
    // at its old scale. A fast second input must not replace it with a cell centre.
    const c=createTableMotionController(), empty=structuredClone(offer); empty.revision--; empty.players[2].discards=[];
    c.update(empty,copies,null,false); c.update(offer,copies,null,false);
    const live={position:[-.87,.65,-3.1],rotation:[-.93,.42,.58],scale:.91} as const;
    const taken=c.update(pon,[copies[0]],null,false,null,undefined,0,0,'classic',(key,seat)=>{
      eq([key,seat],['river:2:0',0],'exact source, correct receiving seat');
      return {position:[...live.position],rotation:[...live.rotation],scale:live.scale};
    });
    const m=taken.motions.get('meld:0:0:2')!;
    eq([m.from,m.rotation,m.scale],[live.position,live.rotation,live.scale],'handoff retains the actual full pose');
    eq(taken.motions.has('river:2:0'),false,'source stroke retired');
    for(const z of [1.35,4,8]) {
      let last=0;
      for(let i=0;i<=50;i++) {
        const t=i/50, g=classicGesture(emptyGesture(),'pon',t,z,'river-claim');
        const x=claimLane(g.travel,z);
        eq(x>=last && x<=1 && g.lift===0,true,'no backwards travel or height flourish');
        last=x;
      }
      near(last,1,'exact slot column');
    }
  }
  const seq=['p4','p0','p6'];
  for(const [caller,from] of [[0,3],[2,1]]) for(const claimed of [0,1,2]) {
    const controller=createTableMotionController(), before=table(), tiles=seq.filter((_,i)=>i!==claimed).map(t=>tile(t));
    before.players[from].discards=[{tile:seq[claimed],riichi:claimed===1,called:false,tsumogiri:false}];
    const baseline=controller.update(before,caller===0 ? tiles : [],null,false);
    const chi=structuredClone(before); chi.revision++; chi.players[from].discards[0].called=true;
    chi.players[caller].melds=[{id:'seq',tiles:seq,type:'chi',concealed:false,from,calledIndex:claimed}];
    const moves=controller.update(chi,[],null,false).motions, key='meld:'+caller+':0:'+claimed;
    eq([...moves.keys()],[key],'exactly the called tile travels, including a red five or a side seat');
    const move=moves.get(key)!;
    eq(move.origin,continuousClaimPreview ? 'river-claim' : 'meld-edge','only the public chi tile registers in its slot');
    near(move.duration,motionDuration('chi',650,false,'classic'),'chi lands on its single clack');
    const slots=seatLayout([],chi.players[caller].melds,caller===0,false,false,{seat:caller,playerCount:4}).melds;
    const sorted=[...slots].sort((a,b)=>a.position[0]-b.position[0]);
    const calledSlot=slots.find(s=>s.tileIndex===claimed)!;
    if(continuousClaimPreview) eq([sorted[0].tileIndex,sorted[0].rotation[2]],[claimed,Math.PI/2],'archived sideways order');
    else eq(sorted.map(t=>t.tile),seq,'entire chi reads in rank order with the red five preserved');
    if (continuousClaimPreview) {
      const src=riverLayout(before.players[from].discards).items[0];
      const j=tilePlacement(baseline.placementSeed,'river:'+from+':0','river'), x=src.position[0]+j.x, z=src.position[2]+j.z;
      const yaw=(tableSeat(from,4)-tableSeat(caller,4))*Math.PI/2;
      near(move.from[0],Math.cos(yaw)*x+Math.sin(yaw)*z,'pickup x in receiving seat');
      near(move.from[2],-Math.sin(yaw)*x+Math.cos(yaw)*z,'pickup z in receiving seat');
      near(move.from[1],tileRestHeight(src.rotation,src.scale),'pickup height'); near(move.scale,src.scale,'pickup scale');
      near(move.rotation[2],src.rotation[2]+yaw+j.yaw,'preserve sideways riichi and the physical seat');
    } else {
      const run=Math.abs(calledSlot.position[2]-move.from[2]);
      eq(move.from[0]===calledSlot.position[0] && run>.15*calledSlot.scale &&
        run<=.52*calledSlot.scale+.00001 && move.arc===0,true,'readable short stroke from the clear end of its own column');
      eq(move.rotation,[-Math.PI/2,0,0],'face already reads in the same direction on the very first pose');
      eq(slots.every(t=>t.rotation[2]===0 && t.position[2]===HAND_ROW_Z),true,'three parallel faces seated in one row');
    }
  }
  const unordered:MeldView={id:'red',tiles:['s6','s4','s0'],type:'chi',concealed:false,from:3,calledIndex:2};
  eq(meldReadingOrder(unordered),[1,2,0],'settlement uses original evidence indices');
  for(const seat of [undefined,{seat:0,playerCount:4}]) {
    if(continuousClaimPreview && seat) continue;
    const tiles=seatLayout([],[unordered],true,false,false,seat).melds.sort((a,b)=>a.position[0]-b.position[0]);
    eq(tiles.map(t=>t.tileIndex),[1,2,0],'both modes & old replay inputs are read left to right');
    eq(tiles[1].tile,'s0','red-five art is not normalized away');
  }
  eq(unordered.tiles,['s6','s4','s0'],'never reorder replay/game arrays');
  eq(meldSourceText(unordered,0,0,4),'吃 · 上家打出赤五条','actual red discard, not the first displayed tile');
  eq(meldSourceText({...unordered,type:'pon',tiles:['z7','z7','z7'],from:2},0,0,4),'碰 · 对家打出红中','named source of identical copies');
  eq(meldSourceText({...unordered,from:0},1,0,3),'吃 · 你打出赤五条','other seat inspected from viewer perspective');
  eq(meldSourceText({...unordered,from:2},0,0,3),'吃 · 上家打出赤五条','three-player left neighbor');
  eq(meldSourceText({...unordered,calledIndex:undefined},0,0,4),'吃 · 上家供牌','incomplete old record does not invent rank');
  eq(meldSourceText({...unordered,from:undefined},0,0,4),null,'no invented giver');
  eq(meldSourceText({...unordered,type:'kan',concealed:true},0,0,4),null,'no source or tile exposed for a concealed kan');
  const ids=[2,3,0,1];
  for(const [notation,idx,source] of [['s2-34',0,3],['s23-4',1,3],['s234-',2,3],['p550=',2,2],['p505+5',2,1]] as const) {
    const m=meldView(notation,'id',2,ids);
    eq([m.calledIndex,m.from],[idx,source],'physical wind converted to player id from the direction mark');
  }
  eq(meldView('z4444','hidden',2,ids).calledIndex,undefined,'concealed kan never receives a giver');
  for(const n of [3,4]) for(let caller=0;caller<n;caller++) for(let rel=1;rel<n;rel++) {
    const from=(caller+rel)%n, seat={seat:caller,playerCount:n}, m={...pon.players[0].melds[0],from};
    const slots=seatLayout([], [m],caller===0,false,false,seat).melds, ordered=[...slots].sort((a,b)=>a.position[0]-b.position[0]);
    const slot=rel===1?2:rel===n-1?0:1;
    eq(ordered[slot].tileIndex,m.calledIndex,'the actual giver still determines the slot');
    eq(ordered.map(t=>t.rotation[2]!==0),[0,1,2].map(i=>continuousClaimPreview && i===slot),'only the archived study turns the called tile');
    for(const t of slots) near(t.position[2]+(t.rotation[2] ? .275 : .385)*t.scale,HAND_ROW_Z+.385*t.scale,'flush leading edges');
    const kan={...m,type:'kan' as const,tiles:[...m.tiles,'p0']};
    const extended=seatLayout([],[kan],caller===0,false,false,seat).melds;
    eq(extended.slice(0,3).map(t=>t.position),slots.map(t=>t.position),'extending a pon leaves the original group untouched');
    near(extended[3].position[0],extended[2].position[0],'fourth stacks in the original called column');
    near(extended[3].stackHeight!,.395*extended[2].scale,'added tile rests exactly on the original called tile');
    eq(extended[3].rotation,extended[2].rotation,'added tile has the same orientation as its base');
    eq(extended[3].position[2]<extended[2].position[2],true,'setback reveals the edge of the original called tile');
    if(!continuousClaimPreview) {
      const open=seatLayout([],[{...kan,calledIndex:3}],caller===0,false,false,seat).melds;
      eq(open.every(t=>t.rotation[2]===0 && t.position[2]===HAND_ROW_Z && t.stackHeight===undefined),true,'a directly opened kan has four aligned columns');
    }
    eq(seatLayout([],[m],true).melds.every(t=>t.rotation[2]===0),true,'pixel keeps its existing registration');
  }
  const declared=riverLayout([{...d,riichi:true}]).items[0];
  eq([declared.sideways,declared.rotation[2]],[true,Math.PI/2],'a riichi discard still lies sideways in the river');
  const historical={...pon.players[0].melds[0],calledIndex:undefined};
  eq(seatLayout([],[historical],true,false,false,{seat:0,playerCount:4}).melds.every(t=>t.rotation[2]===0),true,'old snapshot with no source index does not invent one');
  // A full wall can abut the outside meld column; shorten the push, don't hop.
  const blocked=classicBlockers(112), outer=seatLayout([],[{...historical,from:1,calledIndex:2}],true,false,false,{seat:0,playerCount:4}).melds[2];
  const clearRun=meldEntryRun([],outer.position[0],outer.position[2],outer.scale,outer.rotation[2],0,.52);
  near(clearRun,.52,'open runway takes the complete stroke');
  const limited=meldEntryRun(blocked,outer.position[0],outer.position[2],outer.scale,outer.rotation[2],0,.52);
  eq(limited>0 && limited<clearRun,true,'occupied end stack shortens travel without raising a tile');
  const apron=meldEntryOffset(blocked,outer.position[0],outer.position[2],outer.scale,outer.rotation[2],0,.52);
  eq(apron>limited && outer.position[2]+apron+.385*outer.scale<6.38,true,'use the clear, supported end instead of an almost invisible nudge');
  for(const large of [false,true]) {
    const many=Array.from({length:4},(_,i)=>({...pon.players[0].melds[0],id:'m'+i}));
    const rack=Array.from({length:(large?17:14)-12},()=>({drawn:false}));
    const layout=seatLayout(rack,many,true,large,false,{seat:0,playerCount:4});
    const spans=layout.melds.map(t=>{const half=t.scale*(t.rotation[2] ? .385 : .275); return [t.position[0]-half,t.position[0]+half];}).sort((a,b)=>a[0]-b[0]);
    eq(spans.length,12,'four visible sets');
    eq(spans.every((v,i)=>!i || v[0]>spans[i-1][1]) && layout.hand.at(-1)!.position[0]+.33<spans[0][0],true,'dense melds and the standing rack keep separate lanes');
  }
  const unknownSource=structuredClone(pon); unknownSource.players[2].discards[0].called=false;
  const quiet=createTableMotionController(); quiet.update(offer,copies,null,false);
  eq(quiet.update(unknownSource,[copies[0]],null,false).motions.size,0,'no invented takeoff when the source is unknown');
  const pixel=createTableMotionController();
  pixel.update(offer,copies,null,false,undefined,undefined,2,0,'pixel');
  eq([...pixel.update(pon,[copies[0]],null,false,undefined,undefined,2,0,'pixel').motions.keys()],
    ['meld:0:0:2'],'only the public discard registers on the pixel table');

  for(const style of ['classic','pixel'] as const) for(const mode of ['riichi','sanma','mcr'] as const) {
    const cc=createTableMotionController(), before=table(mode);
    const update=(s:GameSnapshot,hand:HandTile[]=[],reduced=false)=>cc.update(s,hand,null,reduced,null,null,0,0,style);
    before.players[0].melds=[{id:'set',tiles:['z5','z5','z5'],type:'pon',concealed:false,from:2,calledIndex:2}];
    update(before,[tile('z5')]);
    const kan=structuredClone(before); kan.revision++; const m=kan.players[0].melds[0]; m.type='kan'; m.tiles.push('z5');
    const changed=update(kan), added=changed.motions.get('meld:0:0:3')!;
    eq([...changed.motions.keys()],['meld:0:0:3'],'only the fourth slides; never move the base triplet');
    const stamp=changed.impacts.get(0)!;
    near(stamp.contactAt,added.started+added.duration,'the word flashes on arrival, not takeoff');
    const layout=(s:GameSnapshot)=>seatLayout([],s.players[0].melds,true,false,false,style==='classic'?{seat:0,playerCount:s.players.length}:undefined).melds;
    eq(layout(kan).slice(0,3),layout(before),'original triplet stays in its exact pose');
    near(layout(kan)[3].stackHeight!,.395*layout(kan)[2].scale,'new tile already on its support');
    const top=layout(kan)[3];
    eq([added.origin,added.arc,added.rotation,added.scale],['meld-edge',0,top.rotation,top.scale],'same face and size at the start');
    near(added.from[1],tileRestHeight(top.rotation,top.scale)+top.stackHeight!,'fourth slides on its support at constant height');
    near(added.from[2],top.position[2],'no leaning in towards the stack');
    const overhang=top.position[0]-added.from[0];
    eq(overhang>.3*top.scale && overhang<.5*top.scale,true,'visible planar entry with continuous support');
    const exposed=structuredClone(kan); exposed.revision++; exposed.round.doraIndicators.push('s8');
    const face=update(exposed).motions.get(wallMotionKey(3));
    eq(update(exposed).impacts.get(0)===stamp,true,'dora reveal and re-render do not replay kan');
    if(mode==='mcr' || style==='pixel') eq(face,undefined,'no classic riichi flip in regional/pixel rules');
    else {
      eq(face?.kind,'indicator','published flip in '+mode); eq(face?.from,wallTileTransform(3,kan.round.doraIndicators).position,'from actual top of stack');
      eq(face?.rotation,wallTileTransform(3,kan.round.doraIndicators).rotation,'from face-down orientation');
    }
    cc.cancel(); eq(stamp.cancelled,true,'pinned scene refs see background cancellation');
    const resumed=update(exposed); eq([resumed.motions.size,resumed.impacts.size],[0,0],'return from background is quiet');
    const backwards=update(before); eq([backwards.motions.size,backwards.impacts.size],[0,0],'backward snapshot is quiet');
    const reduced=update(exposed,[],true); eq([reduced.motions.size,reduced.impacts.size],[0,0],'replay/reduced changes are quiet');
    const menu=createTableMotionController();
    menu.update(before,[],null,false,null,null,0,0,style);
    const behind=menu.update(kan,[],null,false,null,null,0,0,style,undefined,false);
    eq([behind.motions.has('meld:0:0:3'),behind.impacts.size],[true,0],'an upgrade behind the menu creates no word');
    eq(menu.update(kan,[],null,false,null,null,0,0,style,undefined,true).impacts.size,0,'closing the menu does not show an old call');
  }
  for(const style of ['classic','pixel'] as const) for(const mode of ['sanma','riichi'] as const) {
    const n=mode==='sanma'?3:4;
    for(let seat=0;seat<n;seat++) for(const closed of [true,false]) {
      const giver=(seat+n-1)%n, c=createTableMotionController(), before=table(mode);
      before.players[giver].discards=[{...d,tile:'p0'}]; const after=structuredClone(before); after.revision++;
      after.players[giver].discards[0].called=!closed;
      after.players[seat].concealedCount=closed?10:before.players[seat].concealedCount-3;
      after.players[seat].melds=[{id:'quad',type:'kan',tiles:['p5','p5','p5','p0'],concealed:closed,...(!closed && {from:giver,calledIndex:3})}];
      c.update(before,[],null,false,null,null,0,0,style);
      const frame=c.update(after,[],null,false,null,null,0,0,style);
      eq([...frame.motions.keys()],(closed?[0,1,2,3]:[3]).map(i=>`meld:${seat}:0:${i}`),'whole closed quad or one actual public red five');
      const call=tableMotionCues(before,after).find(c=>c.kind==='kan')!, ink=frame.impacts.get(seat)!;
      if(closed) {
        eq(call.kanEntry,'concealed','a concealed kan is not a river claim');
        const slots=seatLayout([],after.players[seat].melds,seat===0,false,false,style==='classic'?{seat,playerCount:n}:undefined).melds;
        const dx=frame.motions.get(`meld:${seat}:0:0`)!.from[0]-slots[0].position[0];
        eq(Math.abs(dx)>.45*slots[0].scale,true,'the quad has a visible horizontal entry');
        for(const s of slots) { const m=frame.motions.get(`meld:${seat}:0:${s.tileIndex}`)!;
          eq([m.origin,m.arc,m.rotation,m.scale],['meld-edge',0,s.rotation,s.scale],'each end keeps its final face even at takeoff');
          near(m.from[1],tileRestHeight(s.rotation,s.scale),'always on felt'); near(m.from[2],s.position[2],'unchanged depth');
          near(m.from[0]-s.position[0],dx,'one rigid row'); near(ink.contactAt,m.started+m.duration,'all four stop on the cue');
        }
      } else {
        const [move]=frame.motions.values();
        eq([move.origin,move.arc,move.rotation],['meld-edge',0,[-Math.PI/2,0,0]],'open kan slides flat, never turns');
        near(ink.contactAt-move.started,cueTravel(call,650,false,style),'open kan stamp coincides with the sole moving tile');
      }
      near(soundStartDelay(call,650,false,style),cueTravel(call,650,false,style),'kan sound uses the same clock');
    }
  }
  // Fast upgrade while the claimed tile is still sliding and its word is pending.
  const fast=createTableMotionController(); fast.update(offer,copies,null,false);
  const first=fast.update(pon,[copies[0]],null,false), travel=first.motions.get('meld:0:0:2')!, pending=first.impacts.get(0)!;
  const upgrade=structuredClone(pon); upgrade.revision++; upgrade.players[0].melds[0].type='kan'; upgrade.players[0].melds[0].tiles.push('p5');
  const last=fast.update(upgrade,[],null,false);
  eq([!!travel.cancelled,pending.cancelled,[...last.motions.keys()],last.impacts.get(0)?.kind],[true,true,['meld:0:0:3'],'kan'],'old pon is stopped; only the new fourth slides');
  // The separate drawn tile isn't necessarily the kan tile. If it is retained,
  // reclassifying it as an ordinary hand tile must not restart the sort gesture.
  for(const style of ['classic','pixel'] as const) {
    const c=createTableMotionController(), base=table(), draw=structuredClone(base), closed=structuredClone(base);
    const quad=['a','b','c','d'].map(s=>tile('p1-'+s)), rest=[tile('s8'),tile('z7')], other=tile('m1',true);
    c.update(base,[...quad,...rest],null,false,null,null,0,0,style);
    draw.revision++; draw.round.tilesLeft--; draw.players[0].concealedCount++;
    const f=c.update(draw,[...quad,...rest,other],null,false,null,null,0,0,style);
    const k=f.hand.at(-1)!.key, airborne=f.motions.get(k)!; eq(airborne.kind,'draw','test starts during a real draw');
    closed.revision+=2; closed.round.tilesLeft=draw.round.tilesLeft; closed.players[0].concealedCount=draw.players[0].concealedCount-4;
    closed.players[0].melds=[{id:'quad',type:'kan',tiles:quad.map(t=>t.tile),concealed:true}];
    const seated=c.update(closed,[{...other,drawn:false},...rest],null,false,null,null,0,0,style);
    eq([seated.hand[0].key,!!airborne.cancelled,seated.motions.has(k),seated.motions.size],[k,true,false,4],'only the quad slides; retained draw is never re-launched');
  }
  return 'PASS: rigid flat closed-kan slide, supported added-kan slide, stationary open companions, both styles, 3P/4P, interrupted calls, reduced motion and restore';
}

// The audition uses the game's own cached buffers, one centred dry take per call.
export function audition(style:'pixel'|'classic') {
  const rate=24000, library=new SoundLibrary(new OfflineAudioContext(1,rate,rate));
  return (['chi','pon','kan'] as const).map(k=>{
    const name=tableSample(k,style), take=library.get(name);
    eq(library.get(name)===take,true,'buffer reused for '+name);
    const samples=take.getChannelData(0), peak=(v:Float32Array)=>v.reduce((a,b)=>Math.max(a,Math.abs(b)),0);
    eq(peak(samples.subarray(0,rate*.014))>.24 && peak(samples)<.78 && peak(samples.subarray(-rate*.012))<.032,true,name+' immediate onset, capped peak and damped tail');
    return Array.from(samples,x=>Math.round(32767*x));
  });
}
