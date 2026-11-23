// Capture the real release. Only the test clock and the CSS animation playheads
// are held for exposure; there is no preview/debug event in the game.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

function chunk(tag, payload) {
  const head=Buffer.alloc(8); head.write(tag); head.writeUInt32LE(payload.length,4);
  return Buffer.concat([head,payload,...(payload.length%2?[Buffer.alloc(1)]:[])]);
}
// Mux the original full opaque Q90 frames without transcoding. Ignore capture
// metadata; each recorded image is a stand-alone VP8 keyframe.
export function animatedWebP(w,h,frames) {
  const canvas=Buffer.alloc(10); canvas[0]=2;
  canvas.writeUIntLE(w-1,4,3); canvas.writeUIntLE(h-1,7,3);
  const chunks=[chunk('VP8X',canvas),chunk('ANIM',Buffer.alloc(6))];
  for(const [image,ms] of frames) {
    const hdr=Buffer.alloc(16); hdr.writeUIntLE(w-1,6,3); hdr.writeUIntLE(h-1,9,3);
    hdr.writeUIntLE(ms,12,3); hdr[15]=2;
    let bitstream=null;
    for(let i=12;i<image.length;) {
      const end=i+8+image.readUInt32LE(i+4), next=end+(end%2);
      if(image.toString('ascii',i,i+4)==='VP8 ') bitstream=image.subarray(i,next);
      i=next;
    }
    assert.ok(bitstream,'expected a lossy WebP screenshot');
    chunks.push(chunk('ANMF',Buffer.concat([hdr,bitstream])));
  }
  return chunk('RIFF',Buffer.concat([Buffer.from('WEBP'),...chunks]));
}

export async function previewPrints(page,dir) {
  dir=resolve(dir); await mkdir(dir,{recursive:true});
  const cdp=await page.context().newCDPSession(page);
  const capture=async clip=>Buffer.from((await cdp.send('Page.captureScreenshot',{format:'webp',quality:90,clip})).data,'base64');
  const seek=t=>page.evaluate(t=>{
    for(const a of document.getAnimations()) if(a.animationName?.startsWith('print-')) { a.pause(); a.currentTime=t; }
    document.documentElement.getBoundingClientRect();
  },t);
  const stop=async()=>page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+60_000)));
  const interact=loc=>loc.evaluate(el=>el.click());
  const render=async(clip,frames,filename)=>{
    const file=animatedWebP(clip.width,clip.height,frames);
    if(frames.length>2) assert.ok(new Set(frames.map(([f])=>f.toString('base64'))).size>=3,'three or more distinct real poses');
    await writeFile(join(dir,filename+'.webp'),file);
  };
  try {
    await stop(); // The player has the next legal discard after the pon.
    await page.locator('.pixel-hand-tile:enabled').first().evaluate(el=>{ el.focus({preventScroll:true}); el.click(); });
    const clip=await page.locator('.field-river[data-seat="0"]').evaluate(el=>{
      const r=el.getBoundingClientRect(), tiles=el.querySelectorAll('.indexed-discard');
      const stride=tiles[0].offsetWidth+3, next=tiles.length+1;
      return { x:Math.floor(r.left)-12,y:Math.floor(r.top)-7,width:Math.min(el.offsetWidth,Math.min(6,next)*stride)+28,
        height:22+Math.ceil(next/6)*(tiles[0].offsetHeight+3)+26,scale:1 };
    });
    const frames=[[await capture(clip),600]];
    await interact(page.locator('.discard-button:enabled'));
    const ink=page.locator('.field-river[data-seat="0"] [data-print-discard]');
    for(let i=0;i<10 && !await ink.count();i++) await page.clock.runFor(8);
    assert.equal(await ink.count(),1);
    // Use authored offsets and contact/settle durations, not a synthetic slow-mo.
    const travel=await ink.evaluate(el=>parseFloat(el.style.getPropertyValue('--print-travel')));
    const times=[0,.23,.49,.72,.89,1.02].map(p=>Math.round(travel*p)).concat(travel+62,travel+110,travel+152);
    for(let i=0;i<times.length;i++) {
      await seek(times[i]); frames.push([await capture(clip),times[i+1]-times[i]||950]);
    }
    await render(clip,frames,'pixel-print-discard');
    await page.clock.resume();
    await page.getByRole('button',{name:'对局菜单',exact:true}).click();
    await page.getByRole('button',{name:'游戏设置',exact:true}).click();
    await stop();
    await interact(page.getByRole('button',{name:'预览特效',exact:true}));
    await seek(950);
    const box=await page.locator('.celebration-copy').boundingBox(); assert.ok(box);
    const sealClip={x:Math.floor(box.x)-6,y:Math.floor(box.y)-6,width:Math.ceil(box.width)+16,height:Math.ceil(box.height)+25,scale:1};
    const flight=[];
    for(const [t,ms] of [[0,85],[85,68],[153,95],[248,60],[308,175],[483,115],[598,1400]]) {
      await seek(t); flight.push([await capture(sealClip),ms]);
    }
    await render(sealClip,flight,'pixel-print-win');
    await interact(page.getByRole('button',{name:'结束预览',exact:true}));
    assert.equal(await page.locator('.win-celebration').count(),0);
    console.log('PASS: original rendered discard and five-pose victory at WebP quality 90');
  } finally { await page.clock.resume(); await cdp.detach(); }
}
