import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {animatedWebP} from './print-previews.mjs';

// Browser-only instrumentation: check the actual audio source, not a UI click.
export function observeTableSound() {
  const original=AudioBufferSourceNode.prototype.start;
  window.contacts=[];
  AudioBufferSourceNode.prototype.start=function(when,...args) {
    if(this.buffer && !this.loop && this.buffer.duration<=.3) {
      const sample=this.buffer.getChannelData(0);
      window.contacts.push({length:this.buffer.duration,peak:sample.reduce((m,v)=>Math.max(m,Math.abs(v)),0),delay:(when-this.context.currentTime)*1000});
    }
    return original.call(this,when,...args);
  };
}

// The final pocket for the word is known only after the call. Crop the
// unmodified pre-click frame in memory and encode it once, like all other Q90 frames.
async function cropQ90(page,raw,clip) {
  const data=await page.evaluate(async ({png,c})=>{
    const img=new Image(); img.src='data:image/png;base64,'+png; await img.decode();
    const canvas=document.createElement('canvas'); canvas.width=c.width; canvas.height=c.height;
    canvas.getContext('2d').drawImage(img,c.x,c.y,c.width,c.height,0,0,c.width,c.height);
    return canvas.toDataURL('image/webp',.90).split(',')[1];
  },{png:raw.toString('base64'),c:clip});
  return Buffer.from(data,'base64');
}

export async function recordImpact(page,call,pixel,kind,grab,dir,kanForm='concealed') {
  const style=pixel?'pixel':'classic', contact=(pixel?{chi:225,pon:225,kan:235}:{chi:160,pon:128,kan:232})[kind];
  const closed=kind==='kan' && kanForm==='concealed', added=kind==='kan' && kanForm==='added';
  const label=kind==='kan' && !closed ? kanForm+'-kan' : kind;
  const life={chi:220,pon:262,kan:348}[kind];
  const name='meld-cut:0:0:'+kind, read=()=>page.evaluate(n=>window.impactState(n),name);
  await page.mouse.move(4,4);
  const prior=added ? await page.evaluate(()=>[0,1,2].map(i=>window.poseOf('meld:0:0:'+i))) : null;
  const pending=dir?[[await grab(undefined,true),240]]:[], frames=[];
  await page.evaluate(()=>{window.contacts=[];});
  await call.evaluate(el=>el.click());
  let stamp;
  for(let i=0;i<50 && !stamp;i++) stamp=await read();
  assert.ok(stamp && (!contact || !stamp.on),style+' '+kind+' registered at the real group');
  let clip, prepared=false;
  const sample=()=>page.evaluate(({n,pixel})=>{
    const row=document.querySelector('.pixel-hand-row');
    const rack=pixel ? Object.fromEntries([...row.querySelectorAll('.pixel-hand-tile')].map(el=>[el.dataset.tileId,
      row.getBoundingClientRect().bottom-el.querySelector('.pixel-hand-face').getBoundingClientRect().bottom]))
      : Object.fromEntries(Object.entries(window.rackPositions()).map(([id,p])=>[id,p[1]]));
    return {tiles:Array.from({length:n},(_,i)=>window.poseOf('meld:0:0:'+i)),rack};
  },{n:kind==='kan'?4:3,pixel});
  const samples=[await sample()],track=[];
  const startBoxes=await page.evaluate(n=>Array.from({length:n},(_,i)=>window.meshVerticalExtent('meld:0:0:'+i)),kind==='kan'?4:3);
  for(let ms=16;ms<=Math.ceil((contact+life+48)/16)*16;ms+=16) {
    await page.clock.runFor(16);
    samples.push(await sample());
    const ink=await read();
    if(!clip && ink?.planned) {
      const pos=ink.planned, halfMeld=(kind==='kan'?94:73)*(pixel ? .58 : 1);
      clip={width:380,height:154,scale:1};
      clip.x=Math.round((Math.min(ink.x-halfMeld,pos.left,...startBoxes.map(b=>b.left))+Math.max(ink.x+halfMeld,pos.right,...startBoxes.map(b=>b.right))-clip.width)/2);
      clip.y=Math.round((Math.min(ink.y-39,pos.top,...startBoxes.map(b=>b.top))+Math.max(ink.y+21,pos.bottom,...startBoxes.map(b=>b.bottom))-clip.height)/2);
      assert.ok(startBoxes.every(b=>b.left>=clip.x && b.right<=clip.x+clip.width && b.top>=clip.y && b.bottom<=clip.y+clip.height),'complete starting pose is visible in the preview');
      prepared=!ink.on;
      for(const [raw,msHeld] of pending) frames.push([await cropQ90(page,raw,clip),msHeld]);
    }
    if(ink?.on) {
      track.push({ms,opacity:ink.opacity}); assert.equal(ink.pixel,Number(pixel));
      assert.equal(ink.word,{chi:'吃',pon:'碰',kan:'杠'}[kind]);
      assert.ok(ink.font.includes(pixel?'Jakukyo Pixel':'Jakukyo Call Brush'),style+' uses its own lettering');
      const area=ink.box, boxes=await page.evaluate(count=>Array.from({length:count},(_,i)=>window.meshVerticalExtent('meld:0:0:'+i)),kind==='kan'?4:3);
      assert.ok(boxes.every(b=>b.left>=clip.x && b.right<=clip.x+clip.width && b.top>=clip.y && b.bottom<=clip.y+clip.height),'complete final set in frame');
      assert.ok(boxes.every(b=>area.bottom<=b.top || area.top>=b.bottom || area.right<=b.left || area.left>=b.right),'no mark overlaps an actual face');
      assert.ok(area.left>=clip.x && area.right<=clip.x+clip.width && area.top>=clip.y && area.bottom<=clip.y+clip.height,'the complete call mark is in frame');
      if(track.length===3) {
        assert.deepEqual(await page.evaluate(b=>window.cutObstacles(b),area),[],'the word occupies empty space, not another hand, wall or river');
        assert.equal(await page.evaluate(b=>!!document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('.meld-call-layer'),area),false,'no new pointer target');
      }
      assert.equal(await page.locator('.print-call[data-call="'+kind+'"],.classic-declaration[data-call="'+kind+'"]').count(),0,'no second copy over the seat or river');
    }
    if(dir) { if(clip) frames.push([await grab(clip),16]); else pending.push([await grab(undefined,true),16]); }
  }
  if(contact) assert.ok(prepared,'a free pocket is prepared before the public discard arrives');
  const poses=samples.map(s=>s.tiles), final=poses.at(-1), claimed={chi:1,pon:2,kan:3}[kind];
  const hand=samples.at(-1).rack;
  assert.ok(Object.keys(hand).length>0 && samples.every(s=>Object.entries(hand).every(([id,h])=>Math.abs(s.rack[id]-h)<.001)),
    style+' '+kind+': remaining hand tiles stay on their rack from the first frame');
  for(let i=0;i<final.length;i++) {
    const path=poses.map(row=>row[i]); assert.ok(path.every(Boolean),'each public tile is there from registration');
    const ref=final[i], delta=(a,b)=>Math.hypot(...a.map((v,j)=>v-b[j]));
    const excursion=Math.max(...path.map(p=>Math.abs(p.pos[1]-ref.pos[1])));
    assert.ok(excursion<.0001,style+' '+kind+' tile '+i+' changes height by '+excursion.toFixed(3));
    assert.ok(path.every(p=>Math.abs(p.q.reduce((sum,v,j)=>sum+v*ref.q[j],0))>.99999 && Math.abs(p.scale-ref.scale)<.00001),'no tilt, flip or grow-in');
    if(!closed && i!==claimed) {
      assert.ok(path.every(p=>delta(p.pos,ref.pos)<.0001 && Math.hypot(p.screen.x-ref.screen.x,p.screen.y-ref.screen.y)<.5),
        style+' '+label+' held tile shifts on the table or on screen');
      if(prior) assert.ok(prior[i] && delta(ref.pos,prior[i].pos)<.0001,'original pon stays put even across the click');
    } else {
      const axis=closed||added?0:2, cross=2-axis, start=path[0], run=ref.pos[axis]-start.pos[axis];
      const px=Math.hypot(ref.screen.x-start.screen.x,ref.screen.y-start.screen.y);
      assert.ok(Math.abs(run)>(closed?.40:added?.22:.12) && px>=(closed?(pixel?14:24):5),'visible '+label+' slide, not a teleport or subpixel nudge: '+px.toFixed(1)+'px');
      const u=path.map(p=>(p.pos[axis]-start.pos[axis])/run);
      assert.ok(path.every(p=>Math.abs(p.pos[cross]-ref.pos[cross])<.0001) && u.every((v,j)=>v>=-.0001 && v<=1.0001 && (!j||v>=u[j-1]-.0001)),
        'straight monotone entry with no wind-up, overshoot or sideways correction');
      assert.ok(u[2]>.025 && u.some(v=>v>.15&&v<.65) && u.some(v=>v>.65&&v<.96),'moves in the first two frames and visibly passes through intermediate poses');
      if(closed) assert.ok(poses.every(row=>Math.abs((row[i].pos[0]-row[0].pos[0])-(final[i].pos[0]-final[0].pos[0]))<.0001),
        'four already-flat tiles slide as a single row in every exposure');
      if(added) assert.ok(poses.every(row=>Math.abs(row[3].pos[1]-row[2].pos[1]-.395*row[2].scale)<.0001
        && Math.abs(row[3].pos[0]-row[2].pos[0])<.55*row[2].scale),'fourth slides directly on the original support from frame zero');
    }
  }
  assert.ok(track.length>=8 && track[0].ms>=contact-16 && track[0].ms<=contact+32,style+' '+kind+' begins on the last tile, first ink at '+track[0]?.ms);
  assert.ok(track.at(-1).opacity<.75 && !await read(),'one clear exit even with no further player input');
  const cues=await page.evaluate(()=>window.contacts), peak={chi:.46,pon:.62,kan:.73}[kind];
  const sounds=cues.filter(c=>Math.abs(c.peak-peak)<.001 && Math.abs(c.length-({chi:.17,pon:.18,kan:.29}[kind]))<.002);
  assert.equal(sounds.length,1,style+' '+kind+' exactly one corresponding audio voice: '+JSON.stringify(cues));
  assert.ok(Math.abs(sounds[0].delay-contact)<44,'audio scheduled for tile contact: '+sounds[0].delay.toFixed(1)+'ms');
  if(dir) {
    frames.at(-1)[1]=510;
    await writeFile(join(dir,style+'-'+label+'-slide.webp'),animatedWebP(clip.width,clip.height,frames));
  }
  console.log('PASS:',style,label,'visible direct slide, fixed height and facing from frame zero, one sound and one clear word; audio at',Math.round(sounds[0].delay),'ms; first/last ink',track[0].ms,track.at(-1).ms,'ms');
}

export async function checkQuietKan(page,call,mode) {
  await page.evaluate(()=>{window.contacts=[];});
  await call.evaluate(el=>el.click());
  const stamp=()=>page.evaluate(()=>window.impactState('meld-cut:0:0:kan'));
  await page.clock.runFor(32);
  if(mode==='reduced') assert.equal(await stamp(),null);
  await page.clock.runFor(256);
  const ink=await stamp(), audio=await page.evaluate(()=>window.contacts.filter(c=>Math.abs(c.peak-.73)<.001));
  if(mode==='muted') {
    assert.ok(ink?.on,'muting sound does not disable the visual contact'); assert.equal(audio.length,0,'no call sample while muted');
  } else {
    assert.equal(ink,null); assert.equal(audio.length,1);
    assert.ok(Math.abs(audio[0].delay)<35,'reduced motion retains a single immediate contact');
  }
  console.log('PASS: live kan with',mode,': independent sound/motion preferences');
}

export async function checkVoices(page,dir) {
  const voices=[];
  for(const style of ['classic','pixel']) {
    const samples=await page.evaluate(s=>window.ClassicFixture.audition(s),style);
    // Distinguish rhythm/timbre (normalised), not just volume or file labels.
    for(const sample of samples) {
      for(const old of voices) {
        let xy=0,xx=0,yy=0;
        for(let i=0;i<2400;i++) { xy+=sample[i]*old[i]; xx+=sample[i]**2; yy+=old[i]**2; }
        assert.ok(Math.abs(xy/Math.sqrt(xx*yy))<.95,'six distinct attacks');
      }
      voices.push(sample);
    }
    if(dir) {
      const rate=24000, silence=n=>Array(n).fill(0);
      const pcm=[...silence(2400),...samples[0],...silence(11040),...samples[1],...silence(11040),...samples[2],...silence(4800)];
      const wav=Buffer.alloc(44+pcm.length*2);
      wav.write('RIFF',0); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16);
      wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(rate,24); wav.writeUInt32LE(rate*2,28);
      wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(pcm.length*2,40);
      pcm.forEach((v,i)=>wav.writeInt16LE(v,44+i*2));
      await mkdir(dir,{recursive:true}); await writeFile(join(dir,style+'-meld-sounds.wav'),wav);
    }
  }
  console.log('PASS: both foley banks: distinct, immediate, capped, cached and short tails');
}
