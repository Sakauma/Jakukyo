// A real offline deal, in a new browser profile. The test clock samples game
// time, not video playback time; the actual Three.js renderer draws every pose.
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {animatedWebP} from './print-previews.mjs';
import {inspectPublicMeld,recordPixelCall} from './check-readable-table.mjs';
import {checkQuietKan,checkVoices,observeTableSound,recordImpact} from './check-meld-impact.mjs';

const url=file=>pathToFileURL(resolve(file)).href;
const dist=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const frameMs=16;
const claimPreview=process.argv.includes('--claim-preview');
const impacts=process.argv.includes('--impacts') || process.argv.includes('--impact-previews');
const impactDir=process.argv.includes('--impact-previews') ? process.env.CLASSIC_PREVIEW_DIR ?? 'docs/previews' : null;
const index=ms=>ms/frameMs-1;
// Real novice deals: claim the last dragon for pon, or the *middle* of 234s for chi.
const deals={pon:{seed:'Jakukyo-Pocket-01',label:/碰/,claimed:2},chi:{seed:'Grounded-Chi-4',label:/吃/,claimed:1},kan:{seed:'Contact-Kan-29',label:/暗杠/}};

async function recordDiscard(page,discard,stop,grab,dir,study,reference) {
  await page.mouse.move(2,2); await stop(); await page.clock.runFor(160);
  if(study) await writeFile(join(dir,'classic-table-before.webp'),await grab());
  // Covers the near rack, wall and river, excluding the HUD and dock.
  const clip={x:280,y:310,width:512,height:304,scale:1};
  const frames=[[await grab(clip),416]];
  await discard.evaluate(el=>el.click());
  const path=[],tilts=[];
  for(let ms=frameMs;ms<=416;ms+=frameMs) {
    await page.clock.runFor(frameMs); frames.push([await grab(clip),frameMs]);
    if(!study) path.push(await page.evaluate(()=>window.readPiece('river:0:0')));
    if(!study && !reference) tilts.push(await page.evaluate(()=>window.faceUp('river:0:0')));
  }
  frames.at(-1)[1]=780;
  if(dir) await writeFile(join(dir,study?'classic-discard-before.webp':'classic-discard-snap.webp'),animatedWebP(clip.width,clip.height,frames));
  assert.ok(await page.locator('.river-page-note').count());
  if(study) { console.log('BEFORE: sampled the original classic discard'); return; }
  assert.ok(path.every(p=>p?.length===3),'observed live Three.js piece');
  const end=path.at(-1), height=path.map(p=>p[1]);
  const planted=(1+path.findIndex((_,i)=>path.slice(i).every(p=>dist(p,end)<.002)))*frameMs;
  console.log(reference?'previous':'current','discard planted by',planted,'ms, peak above final centre:',(Math.max(...height)-end[1]).toFixed(3));
  if(!reference) {
    assert.ok(Math.max(...height)-end[1]<.68,'clear corridor: no high toss and detached shadow');
    assert.ok(1-dist(path[index(64)],end)/dist(path[0],end)>.34,'direct movement during the first four frames');
    assert.ok(tilts[index(112)]>.994,'already face-up on approach');
    assert.ok(planted>=128 && planted<=176 && dist(path[index(112)],end)>.10,'one visible stroke, no post-contact drift');
    assert.ok(new Set(frames.map(([frame])=>frame.toString('base64'))).size>=6,'different rendered frames, not a static WebP');
    console.log('PASS: real discard, low flight, early turn and a single hard stop');
  }
  return {clip,frames};
}

async function committedPose(page,claimed) {
  // Page time is stopped. Let React commit (its scheduler uses real tasks),
  // without advancing the departing or receiving tile by a single frame.
  for(let i=0;i<16;i++) {
    const pose=await page.evaluate(i=>window.poseOf('meld:0:0:'+i),claimed);
    if(pose) return pose;
  }
}
function samePose(a,b) {
  return a && b && dist(a.pos,b.pos)<.00001 && Math.abs(a.scale-b.scale)<.00001 &&
    Math.abs(a.q.reduce((sum,v,i)=>sum+v*b.q[i],0))>.99999;
}
async function quickClaim(page,dock,discard,stop,kind,claimed) {
  const call=dock.locator('.game-actions button').filter({hasText:deals[kind].label}).first();
  const pass=dock.locator('.game-actions .pass-button');
  await stop(); await discard.evaluate(el=>el.click());
  for(let ms=0;ms<24_000;ms+=32) {
    await page.clock.runFor(32);
    if(await call.isVisible()) {
      // Wait for a genuinely intermediate pose, not the source hand or the
      // already-landed river cell. Only the newly discarded public mesh shrinks.
      let before;
      for(let i=0;i<10;i++) {
        await page.clock.runFor(frameMs);
        before=await page.evaluate(()=>Object.fromEntries(Object.keys(window.riverPositions()).map(k=>[k,window.poseOf(k)])));
        if(Object.values(before).some(p=>p.scale>.8 && p.scale<.99)) break;
      }
      await call.evaluate(el=>el.click());
      const pickup=await committedPose(page,claimed);
      const after=await page.evaluate(()=>window.riverPositions()), taken=Object.keys(before).filter(k=>!(k in after));
      assert.equal(taken.length,1,'exactly one interrupted discard');
      const src=before[taken[0]];
      assert.ok(src.scale>.8 && src.scale<.99,'clicked between the original 1.0-scale hand and the .78-scale river rest');
      assert.ok(samePose(src,pickup),'early call keeps all six axes and the scale of the last displayed frame');
      await page.clock.runFor(336);
      const settled=await page.evaluate(()=>window.meldSample());
      assert.ok(settled.every(t=>t.up>.999 && Math.abs(t.bottom-.086)<.0001),'all three arrive flat after an early call');
      console.log('PASS: immediate',kind,'interrupts a live discard at scale',src.scale.toFixed(3),'without jumping to the river cell');
      return;
    }
    if(await pass.isVisible()) { await pass.evaluate(el=>el.click()); continue; }
    if(await dock.locator('.accessible-hand button').count()) {
      await page.keyboard.press('Escape'); await page.keyboard.press('ArrowRight');
      if(await discard.count()) await discard.evaluate(el=>el.click());
    }
  }
  assert.fail('seed did not reach the fast claim');
}
async function check(browser, target, study, reference=false, kind='pon', quick=false, pixel=false, quiet=null, kanForm='concealed') {
  const page=await browser.newPage({viewport:{width:1366,height:768}, reducedMotion:quiet==='reduced'?'reduce':'no-preference'});
  const cdp=await page.context().newCDPSession(page);
  const dir=reference?null:study?'docs/studies':process.env.CLASSIC_PREVIEW_DIR ?? (process.argv.includes('--previews') ? 'docs/previews' : null);
  const callDir=dir ?? (process.argv.includes('--meld-previews') ? 'docs/previews' : null);
  const faults=[],network=[];
  page.on('pageerror',e=>faults.push(e.message)); page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  page.on('console',m=>{if(/Shader Error|shader failed to compile/i.test(m.text())) faults.push(m.text());});
  page.setDefaultTimeout(45_000); await page.clock.install();
  const grab=async (clip,lossless=false)=>Buffer.from((await cdp.send('Page.captureScreenshot',{...(lossless?{format:'png'}:{format:'webp',quality:90}),...(clip && {clip})})).data,'base64');
  const stop=async()=>page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+60_000)));
  try {
    if(callDir) await mkdir(callDir,{recursive:true});
    if(impacts) await page.addInitScript(observeTableSound);
    await page.addInitScript(({pixel,impacts,quiet})=>{
      localStorage.setItem('jakukyo.preferences.v2',JSON.stringify({
        pixelMode:pixel,speed:650,sound:impacts && quiet!=='muted',bgm:false,ambience:0,difficulty:'novice',mode:'riichi',autoSort:true,riichiHints:false
      }));
      // Three's own inspector hook; nothing is injected into the shipped game.
      window.__THREE_DEVTOOLS__=new EventTarget();
      const scenes=[];
      window.__THREE_DEVTOOLS__.addEventListener('observe',e=>{ if(e.detail.isScene) scenes.push(e.detail); });
      window.impactState=name=>{
        const anchor=scenes.map(s=>s.getObjectByName(name)).find(Boolean);
        if(!anchor) return null;
        const [,seat,,kind]=name.split(':'), el=document.querySelector('.meld-call-cut[data-seat="'+seat+'"][data-call="'+kind+'"]');
        if(!el) return null;
        const {camera,gl}=anchor.__r3f.root.getState(), r=gl.domElement.getBoundingClientRect();
        const p=anchor.getWorldPosition(anchor.position.clone()).project(camera);
        const font=getComputedStyle(el.querySelector('b')).fontFamily, cs=getComputedStyle(el);
        const tr=el.style.transform, m=new DOMMatrix(tr||undefined), host=el.parentElement.getBoundingClientRect();
        const planned=!!tr && new DOMRect(host.left+m.e,host.top+m.f,parseFloat(cs.width),parseFloat(cs.height)).toJSON();
        return {on:!el.hidden,x:r.left+(1+p.x)*r.width/2,y:r.top+(1-p.y)*r.height/2,box:el.getBoundingClientRect().toJSON(),planned,
          opacity:Number(getComputedStyle(el).opacity),word:el.textContent,font,pixel:Number(!!el.closest('.pixel-mode'))};
      };
      const bodyOf=name=>{
        const root=scenes.map(s=>s.getObjectByName(name)).find(Boolean);
        return root?.getObjectByName('tile-body-pose');
      };
      window.readPiece=name=>{
        const body=bodyOf(name);
        return body && body.getWorldPosition(body.position.clone()).toArray();
      };
      window.pieceScreen=name=>{
        const b=bodyOf(name), root=b?.__r3f?.root.getState(); if(!root) return null;
        const p=b.getWorldPosition(b.position.clone()).project(root.camera), r=root.gl.domElement.getBoundingClientRect();
        return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
      };
      window.sideLuminance=name=>{const c=bodyOf(name).children[1].material[0].color; return .2126*c.r+.7152*c.g+.0722*c.b;};
      window.meshVerticalExtent=name=>{
        const b=bodyOf(name), {camera,gl}=b.__r3f.root.getState(), r=gl.domElement.getBoundingClientRect();
        b.updateWorldMatrix(true,true); let top=Infinity,bottom=-Infinity,left=Infinity,right=-Infinity; const v=b.position.clone();
        for(const mesh of b.children.slice(0,2)) { const a=mesh.geometry.getAttribute('position');
          for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i).applyMatrix4(mesh.matrixWorld).project(camera);
            const y=r.top+(1-v.y)*r.height/2,x=r.left+(1+v.x)*r.width/2;
            top=Math.min(top,y); bottom=Math.max(bottom,y); left=Math.min(left,x); right=Math.max(right,x);}
        }
        return {top,bottom,left,right};
      };
      window.cutObstacles=box=>{
        const overlaps=b=>box.left<b.right && box.right>b.left && box.top<b.bottom && box.bottom>b.top;
        const hits=[];
        for(const scene of scenes) scene.traverseVisible(n=>{
          if(/^(hand|opponent|river|meld|wall):\d+/.test(n.name) && overlaps(window.meshVerticalExtent(n.name))) hits.push(n.name);
        });
        for(const el of document.querySelectorAll('.field-river-row,.field-heading,.table-tools,.seat,.pixel-readout')) {
          const r=el.getBoundingClientRect(); if(r.width && r.height && overlaps(r)) hits.push(el.className);
        }
        return hits;
      };
      window.faceUp=name=>{
        const b=bodyOf(name);
        return b && b.position.clone().set(0,0,1).applyQuaternion(b.getWorldQuaternion(b.quaternion.clone())).y;
      };
      window.poseOf=name=>{
        const b=bodyOf(name); if(!b) return null;
        return {pos:window.readPiece(name), screen:window.pieceScreen(name), q:b.getWorldQuaternion(b.quaternion.clone()).toArray(),
          scale:b.getWorldScale(b.scale.clone()).x};
      };
      const positionsOf=pattern=>{
        const pieces={};
        for(const scene of scenes) scene.traverse(node=>{
          if(pattern.test(node.name)) pieces[node.name]=window.readPiece(node.name);
        });
        return pieces;
      };
      window.riverPositions=()=>positionsOf(/^river:\d+:\d+$/);
      window.rackPositions=()=>positionsOf(/^hand:\d+:\d+$/);
      window.meldSample=()=>[0,1,2].map(i=>{
        const name='meld:0:0:'+i, b=bodyOf(name);
        if(!b) return null;
        // Lowest actual body/back vertex, not the group's centre or its shadow.
        b.updateWorldMatrix(true,true);
        let bottom=Infinity,top=-Infinity,left=Infinity,right=-Infinity,back=Infinity,front=-Infinity;
        for(const mesh of b.children.slice(0,2)) {
          const p=mesh.geometry.getAttribute('position'), e=mesh.matrixWorld.elements;
          for(let j=0;j<p.count;j++) {
            const x=p.getX(j),y=p.getY(j),z=p.getZ(j),wx=e[0]*x+e[4]*y+e[8]*z+e[12];
            const wy=e[1]*x+e[5]*y+e[9]*z+e[13], wz=e[2]*x+e[6]*y+e[10]*z+e[14];
            bottom=Math.min(bottom,wy); top=Math.max(top,wy);
            back=Math.min(back,wz); front=Math.max(front,wz); left=Math.min(left,wx); right=Math.max(right,wx);
          }
        }
        const e=b.matrixWorld.elements;
        // Local +Y points to the top of the printed glyph. For the human
        // seat it should face away from the player (world -Z), not sideways.
        const heading=-e[6]/Math.hypot(e[4],e[5],e[6]);
        return {pos:window.readPiece(name),up:window.faceUp(name),heading,bottom,top,left,right,back,front};
      });
    },{pixel,impacts,quiet});
    await page.goto(target,{waitUntil:'load',timeout:90_000});
    const button=name=>page.getByRole('button',{name,exact:true});
    const {label,claimed}=deals[kind], seed=kanForm==='concealed'?deals[kind].seed:'Slide-Kan-34';
    await button('游戏设置').click();
    if(impacts && kind==='kan' && kanForm==='concealed' && !quiet) {
      await page.evaluate(()=>{window.contacts=[];}); await button('试听牌声').click();
      await page.waitForFunction(()=>window.contacts.some(c=>Math.abs(c.peak-.73)<.001));
      const demo=await page.evaluate(()=>window.contacts.filter(c=>[.46,.62,.73].some(p=>Math.abs(p-c.peak)<.001)).map(c=>Number(c.peak.toFixed(2))));
      assert.deepEqual(demo,[.46,.62,.73],'existing settings audition includes chi, pon and kan in order');
    }
    await page.getByPlaceholder('留空使用新牌山').fill(seed); await button('关闭面板').click();
    await page.locator('.start-button').click();
    const dock=page.locator((pixel?'.app.pixel-mode':'.app:not(.pixel-mode)')+' .play-dock:not([inert])');
    const rack=pixel?page.locator('.pixel-hand-tile:enabled'):dock.locator('.accessible-hand button');
    await rack.first().waitFor({state:'attached'});
    await page.locator('canvas[data-round-phase=idle]').waitFor();
    if(impacts && kind==='kan') {
      // Same unedited novice deal: 1m -> call 7777m, OR pon, discard the
      // other 1m, and upgrade that very same group with its fourth tile.
      const act=re=>dock.locator('.game-actions button').filter({hasText:re}).first();
      const oneMan=async()=>{
        const tile=pixel?page.locator('.pixel-hand-tile[data-tile-id$="-m1"]:enabled').first()
          :dock.locator('.accessible-hand button').filter({hasText:'一万'}).first();
        await tile.waitFor({state:'attached'}); await tile.evaluate(el=>el.click());
        await dock.locator('.discard-button:enabled').click();
      };
      if(kanForm!=='concealed') await oneMan();
      if(kanForm==='added') { await act(/碰/).click(); await oneMan(); }
      const call=act(kanForm==='concealed'?label:kanForm==='added'?/加杠/:/明杠/);
      await call.waitFor(); await stop();
      if(quiet) await checkQuietKan(page,call,quiet); else await recordImpact(page,call,pixel,kind,grab,impactDir,kanForm);
      assert.deepEqual(faults,[]); assert.deepEqual(network,[]); return;
    }
    if(pixel) await rack.first().click(); else await page.keyboard.press('ArrowRight');
    const discard=dock.locator('.discard-button:enabled'); await discard.waitFor();
    if(quick) {
      await quickClaim(page,dock,discard,stop,kind,claimed);
      assert.deepEqual(faults,[]); assert.deepEqual(network,[]); return;
    }
    const piece=key=>page.evaluate(k=>window.readPiece(k),key);
    let recorded;
    if(kind==='pon' && !claimPreview && !pixel && !impacts) {
      recorded=await recordDiscard(page,discard,stop,grab,dir,study,reference);
      if(study || reference) { assert.deepEqual(faults,[]); assert.deepEqual(network,[]); return recorded; }
      await page.clock.resume();
    } else await discard.click();
    const pass=dock.locator('.game-actions .pass-button');
    const call=dock.locator('.game-actions button').filter({hasText:label}).first();
    for(let i=0;i<18;i++) {
      await rack.first().or(pass).first().waitFor({state:'attached'});
      if(await call.isVisible()) break;
      if(await pass.isVisible()) { await pass.click(); continue; }
      if(pixel) await rack.first().click(); else {await page.keyboard.press('Escape'); await page.keyboard.press('ArrowRight');}
      await discard.click();
    }
    await call.waitFor(); await stop();
    if(impacts) { await recordImpact(page,call,pixel,kind,grab,impactDir); assert.deepEqual(faults,[]); assert.deepEqual(network,[]); return; }
    if(pixel) { await recordPixelCall(page,call,rack,kind,claimed,grab,callDir); assert.deepEqual(faults,[]); assert.deepEqual(network,[]); return; }
    const before=await page.evaluate(()=>window.riverPositions());
    const riverPoses=claimPreview && await page.evaluate(()=>Object.fromEntries(Object.keys(window.riverPositions()).map(k=>[k,window.poseOf(k)])));
    // Keep both the claimed discard and the caller's rack visible; trim the dock.
    const meldClip={x:350,y:204,width:755,height:392,scale:1};
    const set=callDir ? [[await grab(meldClip),320]] : [];
    await call.evaluate(el=>el.click());
    // Read the committed pose before advancing even one animation frame.
    const pickup=await committedPose(page,claimed);
    const meldPath=[],rackPath=[], badge=page.locator('.meld-call-cut[data-seat="0"][data-call="'+kind+'"]:not([hidden]), .my-avatar .classic-declaration[data-call="'+kind+'"]');
    const readAt=claimPreview && await page.locator('.meld-call-layer').count() ? 320 : 208;
    for(let ms=frameMs;ms<=(claimPreview?336:272);ms+=frameMs) {
      await page.clock.runFor(frameMs);
      meldPath.push(await page.evaluate(()=>window.meldSample()));
      rackPath.push(await page.evaluate(()=>window.rackPositions()));
      if(ms===frameMs) assert.ok(await rack.count()>0,'next discard is selectable while the claimed tile is moving');
      if(ms===readAt) assert.equal(await badge.count(),1,'one declaration for the receiving seat');
      if(callDir) set.push([await grab(meldClip),frameMs]);
    }
    const tools=await page.locator('.table-tools').boundingBox();
    assert.ok(tools && tools.y>=meldClip.y+meldClip.height,'the desktop tool strip stays below the exposed faces');
    const after=await page.evaluate(()=>window.riverPositions()), taken=Object.keys(before).filter(key=>!(key in after));
    assert.equal(taken.length,1,'one public discard leaves its river');
    const finalMeld=meldPath.at(-1), companions=[0,1,2].filter(i=>i!==claimed);
    assert.ok(meldPath.every(row=>row.every(p=>p?.pos.length===3)),'all three faces present at the first frame');
    assert.ok(meldPath.every(row=>companions.every(i=>dist(row[i].pos,finalMeld[i].pos)<.0001
      && row[i].up>.99999 && Math.abs(row[i].bottom-.086)<.0001)),kind+': both hand tiles are flat on the felt at their final slots for every frame');
    const standing=Object.entries(rackPath.at(-1));
    assert.equal(standing.length,11,'remaining actual tiles after the first call');
    assert.ok(rackPath.every(row=>standing.every(([key,p])=>row[key] && Math.hypot(row[key][0]-p[0],row[key][2]-p[2])<.0001)),
      kind+': the remaining rack closes immediately, without sliding across the face of the meld');
    const from=+taken[0].split(':')[1], order=[0,1,2].sort((a,b)=>finalMeld[a].left-finalMeld[b].left);
    if(kind==='chi' && !claimPreview) assert.deepEqual(order,[0,1,2],'234s in rank order, with the claimed 3s in the middle');
    else assert.equal(order[kind==='chi' || from===3 ? 0 : from===2 ? 1 : 2],claimed,'原供牌者对应的牌位');
    assert.ok(finalMeld.every(p=>Math.abs(p.front-finalMeld[claimed].front)<.002),'player-facing edges are flush');
    const end=finalMeld[claimed].pos, travel=meldPath.map(row=>dist(row[claimed].pos,end));
    if(claimPreview) {
      assert.ok(companions.every(i=>finalMeld[claimed].right-finalMeld[claimed].left>finalMeld[i].right-finalMeld[i].left+.12),'archived A/B build retains its transverse face');
      const source=riverPoses[taken[0]], len=dist(source.pos,end), samples=meldPath.map(r=>r[claimed]);
      assert.ok(samePose(source,pickup),'exact mesh-to-mesh handoff before the first frame: position, facing and scale');
      assert.ok(len>3 && dist(samples[0].pos,source.pos)<.07*len,'starts at the discard, not at the receiving slot');
      const ground=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
      const progress=samples.map(p=>1-ground(p.pos,end)/ground(source.pos,end));
      assert.ok(progress.every((p,i)=>!i || p>=progress[i-1]-.00001),'one-way movement, no backwards correction');
      assert.ok([.22,.5,.78].every(mark=>progress.some(p=>Math.abs(p-mark)<.09)),'visible at multiple stages across the whole table');
      assert.ok(samples.every((p,i)=>p.up>.9999 && p.bottom>=.085 && (!i || dist(p.pos,samples[i-1].pos)<len*.17)),
        'no missing piece, blink, under-felt cut or single-frame jump');
      const clear=(a,b)=>a.left>=b.right-.001 || a.right<=b.left+.001 || a.back>=b.front-.001 || a.front<=b.back+.001 || a.bottom>=b.top-.001;
      assert.ok(meldPath.every(r=>companions.every(i=>clear(r[claimed],r[i]))),'incoming face never cuts through either flat companion');
    } else {
      assert.ok(meldPath.every(row=>row.every(p=>p.heading>.99999)),'all three glyphs point away from the caller on every frame, without a swivel');
      assert.ok(meldPath.every(row=>order.slice(1).every((i,k)=>row[i].left>=row[order[k]].right-.001)),'neighbors never intersect');
      assert.ok(pickup,'local stroke is present on the first committed pose');
      const stroke=dist(pickup.pos,end), length=finalMeld[claimed].front-finalMeld[claimed].back;
      // The middle rank slot can face the live wall. Verify a visible push in
      // actual screen pixels, not the former left column's world-space runway.
      const landed=await page.evaluate(i=>window.pieceScreen('meld:0:0:'+i),claimed);
      const screenStroke=Math.hypot(landed.x-pickup.screen.x,landed.y-pickup.screen.y);
      assert.ok(screenStroke>=7 && stroke<length*.7 &&
        meldPath.every(row=>Math.abs(row[claimed].pos[0]-end[0])<.00001 && row[claimed].up>.9999
        && Math.abs(row[claimed].bottom-.086)<.0001 && dist(row[claimed].pos,before[taken[0]])>2),
        'a visible local push straight down its column, including by a live wall; measured '+screenStroke.toFixed(2)+' px');
      assert.ok(travel.every((d,i)=>i===0 || d<=travel[i-1]+.0001) && travel[index(64)]<travel[0]*.68,
        'one compact push without wind-up, bounce or drift');
    }
    const landedAt=(1+meldPath.findIndex((_,i)=>meldPath.slice(i).every(row=>row.every((p,j)=>dist(p.pos,finalMeld[j].pos)<.002))))*frameMs;
    // The clock samples the last presented rAF, not an interpolated pose at
    // click time. Allow one display frame after the 128/160 ms local stroke.
    const deadline=(claimPreview ? 288 : kind==='pon'?128:160)+frameMs;
    assert.ok(landedAt>=deadline-3*frameMs && landedAt<=deadline,kind+': keeps the single-contact tempo; measured '+landedAt+' ms');
    if(callDir) { set.at(-1)[1]=680; await writeFile(join(callDir,'classic-'+kind+(claimPreview ? '-tracked.webp' : '-readable.webp')),animatedWebP(meldClip.width,meldClip.height,set)); }
    await page.clock.runFor(320);
    assert.equal(await badge.count(),0,'seat goes back to its original wind');
    assert.deepEqual(faults,[]); assert.deepEqual(network,[]);
    console.log('PASS:',kind,'/ flat companions /',claimPreview?'continuous river handoff':'parallel faces, straight local stroke',travel[0].toFixed(3),'settled by',landedAt,'ms / next discard immediately selectable');
    if(!claimPreview) await inspectPublicMeld(page,kind,false,grab,callDir);
    if(kind==='chi') return;
    await page.emulateMedia({reducedMotion:'reduce'}); await page.clock.runFor(64);
    const riverIds=()=>page.evaluate(()=>Array.from({length:40},(_,i)=>i).filter(i=>window.readPiece('river:0:'+i)));
    const riversBefore=await riverIds();
    await page.keyboard.press('Escape'); await page.keyboard.press('ArrowRight'); await discard.evaluate(el=>el.click());
    await page.clock.runFor(32);
    const next=(await riverIds()).find(i=>!riversBefore.includes(i)); assert.notEqual(next,undefined);
    const landed=await piece('river:0:'+next); assert.ok(landed);
    await page.clock.runFor(160); assert.ok(dist(landed,await piece('river:0:'+next))<.001,'live reduced-motion change lands immediately');
    assert.equal(await page.locator('.classic-declaration').count(),0);
    assert.deepEqual(faults,[]); assert.deepEqual(network,[]);
    console.log('PASS: temporary seat cue / live reduced motion / offline');
    return recorded;
  } finally { await cdp.detach(); await page.close(); }
}
// Same deal, camera, clip and 16 ms exposures. Both columns play on one
// WebP clock. Only the captions and divider are composited, not the poses.
async function compare(browser,before,after,dir,call=false) {
  const tracked=call==='tracked', impact=call==='kan-impact';
  if(call) assert.equal(before.clip.width,after.clip.width); else assert.deepEqual(before.clip,after.clip);
  if(tracked) {
    // Exposures are identical up to the old capture's held final pose.
    assert.ok(before.frames.length<=after.frames.length);
    assert.deepEqual(before.frames.slice(0,-1).map(f=>f[1]),after.frames.slice(0,before.frames.length-1).map(f=>f[1]));
  } else assert.equal(before.frames.length,after.frames.length);
  // Contact studies already frame the table and leave room above it for the lettering.
  const full=after.clip.width, h=Math.min(before.clip.height,after.clip.height), trim=call && !impact ? 152 : 0, w=full-trim, gap=4, header=32, width=w*2+gap,height=h+header;
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  const cdp=await page.context().newCDPSession(page);
  try {
    const labels=impact ? ['普通版 · 暗杠一筒','像素版 · 同一手牌'] : tracked ? ['旧短推版 · 三索在副露旁出现','小样 · 跟着三索从左家牌河入位'] :
      call ? ['之前 · 来牌在最左边','现在 · 二三四索顺排'] : ['上一版','新版'];
    await page.setContent(`<meta charset=utf-8><style>*{box-sizing:border-box}body{margin:0;background:#24362e;display:flex;gap:${gap}px;color:#f4e5c5;font:600 15px/32px "Microsoft YaHei",sans-serif}section{width:${w}px;overflow:hidden}header{padding:0 12px;background:#20332c}img{display:block;width:${full}px;height:auto;margin-left:-${trim}px}</style>${labels.map(label=>'<section><header>'+label+'</header><img></section>').join('')}`);
    const frames=[];
    for(let i=0;i<after.frames.length;i++) {
      const urls=[before,after].map(s=>'data:image/webp;base64,'+s.frames[Math.min(i,s.frames.length-1)][0].toString('base64'));
      await page.evaluate(async urls=>{await Promise.all([...document.images].map((img,i)=>{img.src=urls[i];return img.decode();}));},urls);
      const shot=await cdp.send('Page.captureScreenshot',{format:'webp',quality:90});
      frames.push([Buffer.from(shot.data,'base64'),after.frames[i][1]]);
    }
    await writeFile(join(dir,impact?'meld-kan-slide-comparison.webp':tracked?'classic-chi-tracked-comparison.webp':call?'classic-chi-reading-comparison.webp':'classic-discard-comparison.webp'),animatedWebP(width,height,frames));
    console.log('PASS: synchronized before/after, real-time WebP quality 90');
  } finally { await cdp.detach(); await page.close(); }
}
// Inverse of print-previews.mjs's full-frame mux: keep the actual Q90 captures
// and their game-clock exposures, never let two animated images run out of sync.
async function readCapture(path) {
  const data=await readFile(path), frames=[]; let clip;
  for(let i=12;i<data.length;) {
    const tag=data.toString('ascii',i,i+4), n=data.readUInt32LE(i+4), at=i+8;
    if(tag==='VP8X') clip={width:1+data.readUIntLE(at+4,3),height:1+data.readUIntLE(at+7,3)};
    if(tag==='ANMF') {
      const vp8=data.subarray(at+16,at+n); assert.equal(vp8.toString('ascii',0,4),'VP8 ');
      const head=Buffer.from('RIFF....WEBP'); head.writeUInt32LE(4+vp8.length,4);
      frames.push([Buffer.concat([head,vp8]),data.readUIntLE(at+12,3)]);
    }
    i=at+n+(n%2);
  }
  assert.ok(clip && frames.length>2); return {clip,frames};
}
async function edgeCases(browser) {
  const {build}=await import('vite');
  const bundle=await build({mode:claimPreview?'claim-preview':'production',configFile:false,publicDir:false,logLevel:'error',build:{write:false,target:'es2022',
    lib:{entry:fileURLToPath(new URL('./fixtures/classic-motion.ts',import.meta.url)),name:'ClassicFixture',formats:['iife']}}});
  const page=await browser.newPage();
  try {
    const js=[bundle].flat().flatMap(b=>b.output).find(a=>a.type==='chunk');
    await page.addScriptTag({content:js.code}); console.log(await page.evaluate(()=>window.ClassicFixture.run()));
    console.log(await page.evaluate(()=>window.ClassicFixture.checkRiverInk()));
    await checkVoices(page,impactDir);
  } finally { await page.close(); }
}
const browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),headless:true,args:['--enable-unsafe-swiftshader']});
try {
  if(!process.argv.includes('--study')) await edgeCases(browser);
  const target=url(process.argv[2]??'release/Jakukyo-offline.html'), study=process.argv.includes('--study');
  if(impacts) {
    const kinds=process.argv.includes('--kan-only')?['kan']:['chi','pon','kan'];
    if(!process.argv.includes('--meld-comparison-only')) {
      for(const pixel of [false,true]) {
        for(const kind of kinds) await check(browser,target,false,false,kind,false,pixel);
        for(const form of ['open','added']) await check(browser,target,false,false,'kan',false,pixel,null,form);
      }
      await check(browser,target,false,false,'kan',false,false,'muted');
      await check(browser,target,false,false,'kan',false,true,'reduced');
    }
    if(impactDir) {
      const [classic,pixel]=await Promise.all(['classic','pixel'].map(s=>readCapture(join(impactDir,s+'-kan-slide.webp'))));
      await compare(browser,classic,pixel,impactDir,'kan-impact');
    }
  } else {
  const compareCalls=process.argv.includes('--meld-comparison-only'), fastOnly=process.argv.includes('--fast-call-only');
  const pixelOnly=process.argv.includes('--pixel-reading-only');
  const result=compareCalls || fastOnly || pixelOnly ? null : await check(browser,target,study);
  if(!study && !compareCalls && !fastOnly && !pixelOnly) await check(browser,target,false,false,'chi');
  if(!claimPreview && !compareCalls && !study && !fastOnly)
    for(const k of ['chi','pon']) await check(browser,target,false,false,k,false,true);
  if(claimPreview && !compareCalls && !study) await check(browser,target,false,false,'pon',true);
  if(claimPreview && (compareCalls || process.argv.includes('--meld-previews'))) {
    const dir=process.env.CLASSIC_PREVIEW_DIR ?? 'docs/previews';
    const [old,now]=await Promise.all([join('docs/previews','classic-chi-sideways.webp'),join(dir,'classic-chi-tracked.webp')].map(readCapture));
    await compare(browser,old,now,dir,'tracked');
  } else if(compareCalls) {
    const dir=process.env.CLASSIC_PREVIEW_DIR ?? 'docs/previews';
    const [old,now]=await Promise.all([join('docs/previews','classic-chi-aligned.webp'),join(dir,'classic-chi-readable.webp')].map(readCapture));
    assert.deepEqual(old.frames.map(f=>f[1]),now.frames.map(f=>f[1]));
    await compare(browser,old,now,dir,true);
  }
  const i=process.argv.indexOf('--compare');
  if(i!==-1 && result) {
    const dir=process.env.CLASSIC_PREVIEW_DIR ?? 'docs/previews'; await mkdir(dir,{recursive:true});
    await compare(browser,await check(browser,url(process.argv[i+1]),false,true),result,dir);
  }
  }
}
finally { await browser.close(); }
