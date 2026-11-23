import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {animatedWebP} from './print-previews.mjs';

// On the real raycast surface; do not dispatch a synthetic hover on the tooltip.
export async function inspectPublicMeld(page,kind,pixel,grab,dir) {
  const tip=page.locator('.meld-source-hint'), focus=page.locator('[data-meld-key="0:0"]');
  const label=kind==='chi'?'吃 · 上家打出三条':'碰 · 对家打出红中';
  await page.mouse.move(2,2); await page.clock.runFor(32);
  assert.equal(await tip.isVisible(),false);
  const points=await page.evaluate(()=>[0,1,2].map(i=>window.pieceScreen('meld:0:0:'+i)));
  assert.ok(points.every(p=>p && p.x>0 && p.y>0));
  await page.mouse.move(points[0].x,points[0].y); await page.clock.runFor(320);
  assert.equal(await tip.isVisible(),true,(pixel?'pixel':'classic')+' real hover over meld');
  assert.equal(await tip.textContent(),label);
  await page.mouse.move(points[1].x,points[1].y); await page.clock.runFor(320);
  assert.equal(await tip.textContent(),label,'the same source on all three faces');
  const rect=await tip.boundingBox(), bounds=await page.evaluate(()=>[0,1,2].map(i=>window.meshVerticalExtent('meld:0:0:'+i)));
  assert.ok(rect && bounds.every(b=>rect.y+rect.height<=b.top-4 || rect.y>=b.bottom+4),'the tooltip does not cover any printed face');
  if(dir && kind==='chi') await writeFile(join(dir,(pixel?'pixel':'classic')+'-reading-source.webp'),await grab());
  await page.mouse.move(2,2); await page.clock.runFor(32); assert.equal(await tip.isVisible(),false);
  await page.keyboard.press('ArrowRight');
  const pending=page.locator('.play-dock:not([inert]) .discard-button:enabled');
  assert.ok(await pending.count()>0,'a real tile is selected before inspecting');
  await focus.focus(); assert.equal(await tip.isVisible(),true,'keyboard inspection');
  await page.keyboard.press('Enter'); assert.equal(await tip.isVisible(),true,'reading a meld is not a discard');
  await page.keyboard.press('Escape'); assert.equal(await tip.isVisible(),false,'Escape dismisses source');
  assert.ok(await pending.count()>0,'inspection did not play or cancel the selected discard');
  await focus.evaluate(el=>el.blur());
  const [wall,closed,face]=await page.evaluate(()=>['wall:0','opponent:1:0','meld:0:0:0'].map(window.sideLuminance));
  assert.ok(wall>0 && wall<face*.84 && closed===wall,'both long edge stripes quieter than the meld ivory');
  if(pixel && kind==='chi') {
    const index=page.locator('.field-river:not([data-side="0"]) .indexed-discard[data-suit=m]:not([data-red]) .river-index b').first();
    assert.equal(await index.evaluate(el=>getComputedStyle(el).color),'rgb(25, 43, 54)','remote pixel index uses the deeper ink');
  }
  console.log('PASS:',pixel?'pixel':'classic',label,'/ real hover, keyboard, leave / wall-to-face luminance', (wall/face).toFixed(2));
}

export async function recordPixelCall(page,call,rack,kind,claimed,grab,dir) {
  const clip={x:140,y:70,width:1120,height:491,scale:1}, frames=dir ? [[await grab(clip),320]] : [], path=[];
  await call.evaluate(el=>el.click());
  for(let ms=16;ms<=272;ms+=16) {
    await page.clock.runFor(16); path.push(await page.evaluate(()=>window.meldSample()));
    if(dir) frames.push([await grab(clip),16]);
  }
  assert.ok(path.every(row=>row.every(Boolean)),'all pixel faces visible at first exposure');
  const end=path.at(-1), others=[0,1,2].filter(i=>i!==claimed);
  if(kind==='chi') assert.ok(end[0].left<end[1].left && end[1].left<end[2].left,'pixel 234s: called middle tile is in its final rank slot');
  assert.ok(path.every(row=>others.every(i=>row[i].pos.every((n,j)=>Math.abs(n-end[i].pos[j])<1e-5)) &&
    row.every(p=>p.heading>.9999 && p.up>.9999 && Math.abs(p.pos[1]-end[claimed].pos[1])<1e-5)),'no jumping or secondary rearrangement on pixel table');
  const z=path.map(row=>row[claimed].pos[2]);
  assert.ok(z.at(-1)-z[0]>.12 && z.every((v,i)=>!i || v>=z[i-1]-1e-5),'only the source prints towards the slot');
  const exposures=new Set(z.map(n=>n.toFixed(4))).size;
  assert.ok(exposures>=5 && exposures<=7,'pixel keeps distinct movement exposures, not the classic interpolation');
  assert.ok(await rack.count()>0,'rack immediately actionable');
  if(dir) { frames.at(-1)[1]=680; await writeFile(join(dir,'pixel-'+kind+'-readable.webp'),animatedWebP(clip.width,clip.height,frames)); }
  await inspectPublicMeld(page,kind,true,grab,dir);
}
