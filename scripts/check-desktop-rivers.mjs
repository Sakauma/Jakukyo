import assert from 'node:assert/strict';
import { checkPixelType } from './check-pixel-type.mjs';
import { fileURLToPath } from 'node:url';

// Runs on a paused human turn in the actual standalone game, not a screenshot fixture.
export async function checkDesktopRivers(page, screenshot) {
  const toggle = page.getByRole('switch', { name:'读牌视图' });
  const seats = page.locator('.desk-river-seat'), rack = page.locator('.pixel-hand-tile');
  const hand = () => rack.evaluateAll(cards => cards.map(b => [b.dataset.tileId, b.getAttribute('aria-pressed')]));
  const wall = () => page.locator('.round-chip b').textContent();
  const liveCanvas = await page.locator('.table-area canvas').elementHandle();
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'),'false');
  assert.equal(await seats.count(),0,'fresh and legacy default-on profiles start on the quiet table');
  if (!await page.locator('.pixel-hand-tile[aria-pressed=true]').count()) await page.locator('.pixel-hand-tile:enabled').first().click();
  const before = await hand(), left = await wall();
  const menu = page.getByRole('button', {name:'对局菜单', exact:true}), dialog = page.getByRole('dialog', {name:'对局菜单'});
  await menu.click(); await dialog.waitFor();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Escape');
  await dialog.waitFor({state:'detached'}); assert.ok(await menu.evaluate(el => el === document.activeElement));
  assert.deepEqual(await hand(), before, 'menu keyboard navigation must not select another tile');
  await menu.click(); await dialog.waitFor();
  const hit = await page.locator('.pixel-hand-tile[aria-pressed=true]').boundingBox();
  await page.mouse.click(hit.x + hit.width/2, hit.y + hit.height/2);
  await dialog.waitFor({state:'detached'});
  assert.deepEqual(await hand(), before); assert.equal(await wall(), left, 'backdrop click must not submit a discard');
  await toggle.click(); await seats.first().waitFor(); assert.equal(await seats.count(),4);
  await toggle.click(); assert.equal(await seats.count(), 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('jakukyo.preferences.v2')).desktopReadView), false);
  await toggle.click(); await seats.first().waitFor();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('jakukyo.preferences.v2')).desktopReadView), true);
  assert.deepEqual(await hand(), before); assert.equal(await wall(), left);
  assert.ok(await liveCanvas.evaluate(el => el === document.querySelector('.table-area canvas')));

  const seat = seats.first(), id = await seat.getAttribute('data-seat'), opener = seat.locator('.desk-river-meta button');
  await opener.click();
  assert.equal(await page.locator(`[data-river-seat="${id}"]`).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.river-history-tile').count(), await seat.locator('.desk-discard').count());
  await page.keyboard.press('Escape');
  assert.ok(await opener.evaluate(el => el === document.activeElement), 'closing the seat history restores its opener');

  // Reach the second row in an actual seeded round, not a fabricated preview.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Escape');
    const remaining = Number(await wall());
    await page.locator('.pixel-hand-tile:enabled').first().click();
    await page.locator('.discard-button:enabled').click();
    await page.waitForFunction(n => Number(document.querySelector('.round-chip b')?.textContent) < n, remaining);
    await page.locator('.pixel-hand-tile:enabled').first().waitFor();
  }
  const readingTurn = await wall();
  // Select a real matching hand tile without submitting any action.
  await page.keyboard.press('Escape');
  let found = false;
  for (const card of await rack.all()) {
    await card.click();
    if (await page.locator('.desk-discard[data-match]').count()) { found = true; break; }
  }
  assert.ok(found, 'the seeded hand has a visible public match');
  assert.equal(await wall(), readingTurn);
  const matches = page.locator('.desk-discard[data-match]');
  assert.ok(await matches.evaluateAll(items => items.every(el => el.getAttribute('aria-label').includes('同种'))));
  assert.equal(await page.locator('.desk-discard[data-latest]').count(), 1);
  assert.equal(await page.locator('.desk-last-label').count(), 1);
  const latest = await page.locator('.desk-river-seat:has([data-latest])').evaluate(el => ({
    player:el.querySelector('.seat-name').textContent, tile:el.querySelector('[data-latest]').getAttribute('aria-label').split(' · ')[0],
  }));
  const selected = await hand();
  await page.mouse.move(2, 2);
  for (const [width,height] of [[1366,768], [1920,1080]]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.table-area canvas'), area = document.querySelector('.table-area');
      return canvas && Math.abs(canvas.clientWidth - area.clientWidth) <= 1;
    });
    assert.ok(await page.locator('.table-workspace').evaluate(work => {
      const bounds = el => el.getBoundingClientRect();
      const [l,b,r] = [...work.children].map(bounds), rack = bounds(document.querySelector('.pixel-hand-rack'));
      const heading = bounds(document.querySelector('.game-heading')), nav = bounds(document.querySelector('.header-actions'));
      return l.left >= 0 && l.right <= b.left + 1 && b.right <= r.left + 1 && r.right <= innerWidth &&
        heading.right + 8 <= nav.left && [...work.querySelectorAll('.desk-seat-header')].every(h =>
          bounds(h.querySelector('.desk-identity')).right <= bounds(h.querySelector('.desk-score')).left) &&
        Math.abs(b.left+b.width/2 - innerWidth/2) < 1 && b.bottom <= rack.top + 1 &&
        [...work.querySelectorAll('.desk-river-scroll')].every(el => el.scrollWidth <= el.clientWidth) &&
        [...work.querySelectorAll('.desk-discard')].every(el => el.offsetWidth === 32 && el.offsetHeight === 44 &&
          (el.dataset.suit === 'honor' ? el.querySelector('img').naturalWidth===64 : el.querySelector('.river-index i').offsetHeight===16));
    }), `readable full-size public tiles, centered table and separate rack at ${width}×${height}`);
    await checkPixelType(page, 'desktop rivers ' + width, ['.desk-identity strong','.desk-score strong','.desk-last-label','.desk-match-count']);
    if (width === 1366) await screenshot('pixel-desktop-reading');
    await toggle.click(); await page.mouse.move(2,2);
    await page.waitForFunction(() => {
      const c = document.querySelector('.table-area canvas');
      return c && Math.abs(c.clientWidth-innerWidth) <= 1;
    });
    assert.equal(await page.locator('.desk-river-wing,.riichi-assist,.table-tools,.auto-difficulty-control').count(),0);
    assert.equal(await page.locator('.desk-navigation > button:visible').count(),2);
    assert.deepEqual(await hand(),selected); assert.equal(await wall(),readingTurn);
    assert.ok((await page.locator('.desk-latest').textContent()).includes(latest.player + ' 打出 ' + latest.tile));
    assert.equal(await page.locator('.round-chip').isVisible(),false);
    assert.ok(await page.locator('.pixel-readout span').isVisible(),'remaining wall count still has a visible home');
    assert.ok(await page.locator('.discard-button:enabled').isVisible());
    const field = page.locator('.table-river-field');
    await page.locator('canvas[data-river-renderer=screen]').waitFor();
    assert.equal(await field.locator('.field-river').count(),4);
    const lastTile = field.locator('.indexed-discard[data-latest]');
    assert.equal(await lastTile.count(),1);
    assert.ok((await lastTile.getAttribute('aria-label')).startsWith(latest.tile));
    assert.ok(await field.locator('[data-match]').count()>0);
    const shape = () => field.locator('.indexed-discard:not([data-sideways])').evaluateAll(tiles => tiles.map(el => {
      const b=el.getBoundingClientRect(); return [b.width,b.height];
    }));
    const dimensions = await shape();
    await screenshot('pixel-desktop-' + width);
    assert.equal(dimensions.length,28,'all seven discards from each real seat are visible');
    assert.ok(dimensions.every(([w,h]) => w === (width===1366?48:62) && h === (width===1366?60:72)));
    assert.ok(await field.evaluate(root => {
      const bounds = el => el.getBoundingClientRect(), well=bounds(document.querySelector('.pixel-readout')), area=bounds(root);
      const collide = (a,b) => a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;
      const cards = [...root.querySelectorAll('.indexed-discard')];
      return cards.every((el,i) => {
        const b=bounds(el), symbol=el.querySelector('img');
        return (symbol ? symbol.src.startsWith('data:image/webp;base64,') && symbol.naturalWidth===64 : el.querySelector('.river-index i').textContent==='万') &&
          b.left>=area.left && b.right<=area.right && b.top>=area.top && b.bottom<=area.bottom &&
          el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)) && !collide(b,well) &&
          cards.slice(i+1).every(other => !collide(b,bounds(other)));
      });
    }),'rivers are on-screen; no tile, control or round counter covers another tile');
    await checkPixelType(page, 'focus ' + width, ['.prompt-title','.desk-latest','.seat-name','.desk-nav-button','.field-river .river-index b','.field-river .river-index i']);
    if (width === 1366) {
      const clip = await lastTile.evaluate(el => {
        const b=el.closest('.field-river').getBoundingClientRect();
        return {x:Math.floor(b.x)-8, y:Math.floor(b.y)-8, width:Math.ceil(b.width)+16, height:Math.ceil(b.height)+16, scale:1};
      });
      await screenshot('pixel-river-native',clip);
      await lastTile.click();
      await page.locator('.river-overview .is-single').waitFor();
      assert.equal(await page.locator('.river-history .indexed-discard').count(),7);
      assert.equal(await page.locator('.river-history [data-latest]').count(),1);
      assert.deepEqual(await page.locator('.river-history [data-latest]').evaluate(el=>[el.offsetWidth,el.offsetHeight]),[88,96]);
      assert.ok(await page.locator('.river-history-row').evaluateAll(rows => rows.every(r =>
        r.querySelector('.indexed-discard').getBoundingClientRect().left===rows[0].querySelector('.indexed-discard').getBoundingClientRect().left)));
      await page.mouse.move(2,2); await screenshot('pixel-river-detail');
      await page.keyboard.press('Escape');
      assert.ok(await lastTile.evaluate(el=>el.closest('button')===document.activeElement));
      const switchCamera = async label => { await menu.click(); await dialog.getByRole('button',{name:label}).click(); };
      await switchCamera('切换俯视视角'); assert.deepEqual(await shape(),dimensions);
      await switchCamera('切换透视视角'); assert.deepEqual(await hand(),selected); assert.equal(await wall(),readingTurn);
      await menu.click(); await dialog.waitFor();
      await checkPixelType(page, 'desktop menu', ['.desk-play-menu header strong','.desk-command-grid button','.desk-play-menu summary']);
      await page.mouse.move(2,2); await screenshot('pixel-desktop-menu');
      await page.keyboard.press('Escape'); await dialog.waitFor({state:'detached'});
      await toggle.click(); await seats.first().waitFor();
    }
  }
  // A smaller desktop window still has both modes and a real path to the history.
  await page.setViewportSize({width:1024,height:650});
  await page.locator('.desk-focus').waitFor();
  assert.ok(await page.locator('.pixel-readout span').isVisible());
  await toggle.click();
  const overview = page.getByRole('button',{name:'牌河全览', exact:true});
  await overview.waitFor(); assert.equal(await seats.count(),0); await overview.click();
  await page.getByRole('button',{name:'关闭牌河全览'}).click();
  await toggle.click(); assert.deepEqual(await hand(),selected); assert.equal(await wall(),readingTurn);
  await page.setViewportSize({ width:1440, height:900 });
  const discardable = page.locator('.pixel-hand-tile:enabled').first();
  const from = await discardable.boundingBox(), onto = await page.locator('.field-river [data-latest]').boundingBox();
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2); await page.mouse.down();
  await page.mouse.move(onto.x+onto.width/2,onto.y+onto.height/2,{steps:8}); await page.mouse.up();
  await page.waitForFunction(n => Number(document.querySelector('.round-chip b')?.textContent)<n, Number(readingTurn));
  await discardable.waitFor(); assert.equal(await page.locator('.river-overview').count(),0);
  console.log('PASS: native, seat-aligned rivers at 1366×768 / 1920×1080; unchanged sizes in both cameras, click-to-enlarge, focus restoration and drag-to-river discard');
}

// Fixed, unmodified deals in the release, with automation off. The win seed
// naturally gives East a legal first-draw tsumo; no injected actions or saves.
export async function checkFocusActions(browser, url) {
  for (const [seed, win] of [['Jakukyo-Pocket-01',false],['Focus-Win-726161',true]]) {
    const page = await browser.newPage({viewport:{width:1366,height:768}, reducedMotion:'reduce'});
    const faults = [];
    page.on('pageerror',e => faults.push(e.message));
    try {
      await page.addInitScript(() => localStorage.setItem('jakukyo.preferences.v2', JSON.stringify({
        mode:'riichi', pixelMode:true, difficulty:'novice', matchLength:'single', sound:false, winEffects:false, speed:250,
      })));
      await page.goto(url,{waitUntil:'load',timeout:90_000});
      await page.getByRole('button',{name:'游戏设置',exact:true}).click();
      await page.getByPlaceholder('留空使用新牌山').fill(seed);
      await page.getByRole('button',{name:'关闭面板'}).click();
      await page.locator('.start-button').click();
      const dock = page.locator('.desk-focus .play-dock:not([inert])');
      const assertDirect = async button => {
        assert.equal(await page.getByRole('switch',{name:'读牌视图'}).getAttribute('aria-checked'),'false');
        assert.equal(await page.locator('dialog[open],.desk-river-wing').count(),0);
        assert.ok(await button.evaluate(el => {
          const b=el.getBoundingClientRect();
          return b.left>=0 && b.right<=innerWidth && b.top>=0 && b.bottom<=innerHeight &&
            el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));
        }), 'response button is on screen and directly actionable');
      };
      if (win) {
        const tsumo = dock.locator('.win-actions .win-button');
        await tsumo.waitFor(); assert.match(await tsumo.textContent(),/自摸/);
        assert.match(await dock.locator('.response-feedback').textContent(),/可以自摸/);
        await assertDirect(tsumo); await tsumo.click();
        await page.locator('.settlement-panel').waitFor({timeout:45_000});
        console.log('PASS: first-draw tsumo shown and settled directly from the focus dock');
      } else {
        const pass = dock.locator('.game-actions .pass-button');
        const call = dock.locator('.game-actions button').filter({hasText:/吃|碰|杠/}).first();
        const rack = page.locator('.desk-focus .pixel-hand-tile:enabled');
        for (let i=0; i<18; i++) {
          await rack.first().or(pass).first().waitFor();
          if (await pass.isVisible()) break;
          const tile = rack.first(), id = await tile.getAttribute('id');
          await tile.click(); await dock.locator('.discard-button:enabled').click();
          await page.waitForFunction(id => !document.getElementById(id), id);
        }
        await pass.waitFor(); await call.waitFor();
        const name = await call.locator('span').first().textContent();
        await assertDirect(call); await assertDirect(pass); await call.click();
        await rack.first().waitFor(); assert.equal(await pass.count(),0);
        console.log('PASS: a real ' + name + ' and 跳过 were directly actionable; playing the call opens the human discard');
      }
      assert.deepEqual(faults,[]);
    } finally { await page.close(); }
  }
}

// Exercise long rivers and sanma through the production component. Build to memory so
// these states need neither a debug entry in the release nor a second game client.
export async function checkRiverEdgeCases(browser) {
  const { build } = await import('vite');
  const bundle = await build({ configFile:false, logLevel:'error', publicDir:false, esbuild:{jsx:'automatic'},
    define:{'process.env.NODE_ENV':'"production"'}, build:{write:false, target:'es2022',
      lib:{ entry:fileURLToPath(new URL('./fixtures/desktop-river.tsx',import.meta.url)), name:'RiverFixture', formats:['iife'] } } });
  const assets = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(out => out.output);
  const page = await browser.newPage({ viewport:{width:1366,height:768} });
  try {
    await page.setContent('<!doctype html><meta charset=utf-8><div id=test></div>');
    await page.addStyleTag({ content:String(assets.find(a=>a.fileName.endsWith('.css')).source) });
    await page.addScriptTag({ content:assets.find(a=>a.type==='chunk').code });
    await page.evaluate(() => window.RiverFixture.mount());
    const seat = page.locator('.desk-river-seat[data-seat="2"]'), list = seat.locator('.desk-river-scroll');
    await seat.waitFor();
    assert.equal(await page.locator('.desk-river-seat').count(),4);
    assert.deepEqual(JSON.parse(await page.locator('#flower-labels').textContent()), [...'春夏秋冬梅兰竹菊'].map(c => [c,c]));
    assert.equal(await seat.locator('.desk-discard').count(),28, 'the called tile is absent');
    const declaration = seat.locator('[data-source-index="1"]');
    assert.deepEqual(await declaration.evaluate(el=>[el.offsetWidth,el.offsetHeight,el.querySelector('.river-index').textContent]),[44,32,'5筒']);
    assert.ok((await declaration.getAttribute('aria-label')).includes('立直横牌'));
    assert.ok(await seat.locator('[data-code="p0"][data-match]').count() > 0 && await seat.locator('[data-code="p5"][data-match]').count() > 0);
    const fieldSeat = page.locator('.field-river[data-seat="2"]');
    const start = Number(await fieldSeat.getAttribute('data-start'));
    assert.ok(start>0 && start%6===0 && Number(await fieldSeat.locator('.indexed-discard').first().getAttribute('data-source-index'))===start+1);
    assert.equal(await fieldSeat.locator('[data-latest]').getAttribute('data-source-index'),'28');
    await fieldSeat.focus(); await page.keyboard.press('Home');
    assert.equal(await fieldSeat.getAttribute('data-start'),'0');
    assert.equal(await fieldSeat.locator('[data-sideways][data-red][data-match]').getAttribute('data-source-index'),'1');
    await fieldSeat.locator('.field-heading').hover(); await page.mouse.wheel(0,120);
    await page.waitForFunction(el => el.getAttribute('data-start')==='6', await fieldSeat.elementHandle());
    await page.keyboard.press('End');
    assert.equal(Number(await fieldSeat.getAttribute('data-start')),start);
    await fieldSeat.locator('.field-history').click();
    const history = page.locator('.river-overview');
    assert.equal(await history.locator('.indexed-discard').count(),28);
    assert.equal(await history.locator('[data-sideways][data-red][data-match]').getAttribute('data-source-index'),'1');
    await history.getByRole('button',{name:'关闭牌河全览'}).click();
    await page.waitForFunction(el => el.scrollHeight > el.clientHeight && el.scrollTop > 0 && el.scrollWidth <= el.clientWidth, await list.elementHandle());
    await list.evaluate(el => { el.scrollTop=0; el.dispatchEvent(new Event('scroll')); });
    await page.locator('#append').click();
    assert.equal(await seat.locator('[data-latest]').getAttribute('data-source-index'),'29');
    assert.equal(await list.evaluate(el=>el.scrollTop),0, 'stay in history when another tile arrives');
    await page.locator('#call').click(); assert.equal(await seat.locator('[data-latest],.desk-last-label').count(),0);
    assert.equal(await fieldSeat.locator('[data-latest]').count(),0,'a claimed discard is not marked as latest on the felt');
    await page.locator('#three').click();
    assert.equal(await page.locator('.desk-river-seat').count(),3, 'three players, not four placeholder seats');
    assert.equal(await page.locator('.field-river').count(),3);
    assert.equal(await fieldSeat.getAttribute('data-side'),'3');
    assert.ok((await seat.getAttribute('aria-label')).includes('上家'), 'sanma uses the actual left opponent');
    console.log('PASS: sanma, scroll history, called latest, transferred sideways riichi, red-five matches and all eight flower names');
  } finally { await page.close(); }
}
