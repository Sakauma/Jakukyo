// Observe real, committed turns in an isolated copy of the single-file game.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { previewPrints } from './print-previews.mjs';

export async function checkPrintMotion(browser, url, study = false) {
  const page = await browser.newPage({viewport:{width:1366,height:768}, reducedMotion:'no-preference'});
  page.setDefaultTimeout(35_000);
  const errors = []; page.on('pageerror', e=>errors.push(e.message));
  try {
    if(!study && process.env.PIXEL_PREVIEW_DIR) await page.clock.install();
    await page.addInitScript(() => {
      localStorage.setItem('jakukyo.preferences.v2', JSON.stringify({mode:'riichi',pixelMode:true,sound:false,difficulty:'novice',speed:650}));
      window.turnClips=[];
      document.addEventListener('animationstart', e=>window.turnClips.push([e.animationName,
        e.target.closest('[data-seat]')?.dataset.seat,e.target.dataset.call]), true);
      const printed=new Set();
      new MutationObserver(changes=>{for(const {target:el} of changes) {
        if(!el.matches?.('.meld-call-cut:not([hidden])') || printed.has(el.dataset.event)) continue;
        printed.add(el.dataset.event); window.turnClips.push(['meld-cut',el.dataset.seat,el.dataset.call]);
      }}).observe(document,{attributes:true,attributeFilter:['hidden'],subtree:true});
    });
    await page.goto(url,{waitUntil:'load',timeout:90_000});
    const button = name=>page.getByRole('button',{name,exact:true});
    await button('游戏设置').click(); await page.getByPlaceholder('留空使用新牌山').fill('Jakukyo-Pocket-01');
    await button('关闭面板').click(); await page.locator('.start-button').click();
    const dock=page.locator('.desk-focus .play-dock:not([inert])'), rack=page.locator('.desk-focus .pixel-hand-tile:enabled');
    const pass=dock.locator('.game-actions .pass-button');
    for (let i=0;i<18;i++) {
      await rack.first().or(pass).first().waitFor(); if (await pass.isVisible()) break;
      const id=await rack.first().getAttribute('id');
      await rack.first().click(); await dock.locator('.discard-button:enabled').click();
      await page.waitForFunction(id=>!document.getElementById(id),id);
    }
    const call=dock.locator('.game-actions button').filter({hasText:/吃|碰|杠/}).first();
    await call.waitFor(); const label=await call.locator('span').first().textContent();
    await call.click(); await rack.first().waitFor();
    if(!study) await page.waitForFunction(()=>window.turnClips.some(c=>c[0]==='meld-cut'));
    const clips=await page.evaluate(()=>window.turnClips.map(a=>a[0]));
    console.log(study?'BEFORE':'AFTER',label,[...new Set(clips)].join(', '));
    if (!study) {
      for (const name of ['print-draw','print-discard','meld-cut']) assert.ok(clips.includes(name),name);
      const seats=await page.evaluate(()=>[...new Set(window.turnClips.filter(c=>c[0]==='print-discard').map(c=>c[1]))].sort());
      assert.deepEqual(seats,['0','1','2','3'],'arrivals attributed to their own seat');
      assert.deepEqual(await page.evaluate(()=>window.turnClips.filter(c=>c[0]==='meld-cut'&&c[1]==='0').at(-1)),['meld-cut','0','pon']);
      const layers=page.locator('[data-print-draw],[data-print-discard],.meld-call-cut:not([hidden]),.print-call');
      await layers.first().waitFor({state:'detached'});
      const n=await page.evaluate(()=>window.turnClips.length);
      await page.getByRole('switch',{name:'读牌视图'}).click();
      await page.getByRole('switch',{name:'读牌视图'}).click();
      await page.locator('.field-river[data-seat="0"]').focus(); await page.keyboard.press('Enter');
      await page.keyboard.press('Escape'); assert.equal(await layers.count(),0);
      assert.equal(await page.evaluate(()=>window.turnClips.length),n,'history and view changes do not replay an old move');
      if(process.env.PIXEL_PREVIEW_DIR) await previewPrints(page,process.env.PIXEL_PREVIEW_DIR);
      await page.emulateMedia({reducedMotion:'reduce'});
      const reducedBefore=await page.evaluate(()=>window.turnClips.filter(c=>c[0].startsWith('print-')).length);
      await rack.first().or(pass).first().waitFor(); if(await pass.isVisible()) await pass.click();
      const tile=rack.first(); await tile.waitFor(); const id=await tile.getAttribute('id');
      await tile.click(); await dock.locator('.discard-button:enabled').click();
      await page.waitForFunction(id=>!document.getElementById(id),id);
      assert.equal(await layers.count(),0);
      assert.equal(await page.evaluate(()=>window.turnClips.filter(c=>c[0].startsWith('print-')).length),reducedBefore,'motion preference takes effect live');
      console.log('PASS: live draw/discard/pon, quiet history and live reduced motion');
    }
    assert.deepEqual(errors,[]);
  } finally { await page.close(); }
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),headless:true,args:['--enable-unsafe-swiftshader']});
  try { await checkPrintMotion(browser,pathToFileURL(resolve(process.argv[2]??'release/Jakukyo-offline.html')).href,process.argv.includes('--study')); }
  finally { await browser.close(); }
}
