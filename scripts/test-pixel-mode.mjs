// Browser smoke test against the actual self-contained release. Uses an isolated
// profile, so it never reads or writes a player's settings, saves or replays.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { checkPixelType } from './check-pixel-type.mjs';
import { checkDesktopRivers, checkFocusActions, checkRiverEdgeCases } from './check-desktop-rivers.mjs';
import { checkPrintMotion } from './check-print-motion.mjs';

const target = pathToFileURL(resolve(process.argv[2] ?? 'release/Jakukyo-offline.html')).href;
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  headless: true, args: ['--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(45_000);
  const errors = [], network = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('request', req => { if (/^https?:/.test(req.url())) network.push(req.url()); });
  await page.addInitScript(() => {
    localStorage.setItem('jakukyo.preferences.v1', JSON.stringify({
      sound: false, speed: 250, difficulty: 'novice', quickControls: { noCall: true }, desktopRivers:true,
    }));
    window.previewEncodings = [];
    const encode = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
      window.previewEncodings.push([type, quality]); return encode.call(this, type, quality);
    };
  });
  const button = name => page.getByRole('button', { name, exact: true });
  const toggle = page.getByRole('switch', { name: '像素模式', exact: true });
  const command = async (name, more = false) => {
    if (!await button('对局菜单').isVisible()) return button(name).click();
    await button('对局菜单').click();
    const dialog = page.getByRole('dialog', { name:'对局菜单' });
    if (more) await dialog.locator('summary').click();
    await dialog.getByRole('button', { name, exact:true }).click();
  };
  const settings = () => command('游戏设置');
  const close = () => button('关闭面板').click();
  const waitPixel = () => page.waitForSelector('.pixel-mode canvas[data-table-quality="pixel"]');
  const screenshot = async (name, clip) => {
    if (!process.env.PIXEL_PREVIEW_DIR) return;
    const dir = resolve(process.env.PIXEL_PREVIEW_DIR); await mkdir(dir, { recursive: true });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const cdp = await page.context().newCDPSession(page);
    try {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'webp', quality: 90, clip });
      await writeFile(join(dir, name + '.webp'), Buffer.from(data, 'base64'));
    } finally { await cdp.detach(); }
  };

  await page.goto(target, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForSelector('canvas[data-table-quality]');
  await settings();
  assert.equal(await toggle.getAttribute('aria-checked'), 'false', 'older preferences default to classic');
  const classicBody = await page.locator('.pixel-setting-copy small').evaluate(el => getComputedStyle(el).fontFamily);
  await toggle.focus(); await page.keyboard.press('Space'); await waitPixel();
  assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  await button('春樱庭院').click(); await page.waitForSelector('.pixel-mode.theme-sakura');
  await close(); await page.reload({ waitUntil: 'load', timeout: 90_000 }); await waitPixel();
  await page.waitForSelector('.pixel-mode.theme-sakura');
  await settings(); await button('竹影茶室').click();
  await checkPixelType(page, 'settings', ['.panel h2', '.pixel-setting-copy small', '.volume-slider output'], true);
  await page.locator('.panel').evaluate(el => el.scrollTop = 0);
  const panelBounds = await page.locator('.panel').boundingBox();
  const lastRow = await page.locator('.auto-sort-setting').boundingBox();
  await screenshot('pixel-settings', { x: panelBounds.x - 8, y: panelBounds.y - 8, width: panelBounds.width + 16, height: Math.ceil(lastRow.y + lastRow.height - panelBounds.y) + 8, scale: 1 });
  if (await page.evaluate(() => CSS.supports('appearance', 'base-select'))) {
    const select = page.getByRole('combobox', { name: '设置托管等级' });
    await select.click();
    await page.locator('select[aria-label="设置托管等级"]:open').waitFor();
    await checkPixelType(page, 'open picker', ['select[aria-label="设置托管等级"] option:checked']);
    await page.keyboard.press('Escape');
  }
  const [backup] = await Promise.all([page.waitForEvent('download'), button('备份全部数据').click()]);
  const preferences = JSON.parse(JSON.parse(await readFile(await backup.path(), 'utf8')).data['jakukyo.preferences.v2']);
  assert.equal(preferences.pixelMode, true); assert.equal(preferences.theme, 'jade'); await close();
  console.log('PASS: keyboard toggle, independent room palette, persistence and v1 migration');
  await checkPixelType(page, 'lobby', ['.brand-name','.pixel-kicker','.lobby-config h1 em','.mode-card strong','.mode-description','.start-button']);
  await page.locator('.mode-card.selected').hover(); await page.getByRole('tooltip').waitFor();
  assert.equal(await page.getByRole('tooltip').textContent(), await page.locator('.mode-card.selected').getAttribute('aria-description'));
  await checkPixelType(page, 'tooltip', ['.pixel-hint']);
  await page.keyboard.press('Escape'); await page.getByRole('tooltip').waitFor({ state: 'hidden' }); await page.mouse.move(6, 6);
  await screenshot('pixel-lobby');
  await button('新手帮助').click();
  await checkPixelType(page, 'help', ['.help-lead h3','.help-lead p','.help-keyboard kbd']);
  await button('关闭新手帮助').click();
  await button('本地战绩').click();
  await checkPixelType(page, 'stats', ['.experience-header h2']);
  await button('关闭本地战绩').click();
  await button('规则').click();
  await checkPixelType(page, 'rules', ['.rule-notes li','.panel-intro']); await close();

  await settings(); await page.getByPlaceholder('留空使用新牌山').fill('Jakukyo-Pocket-01'); await close();
  await page.locator('.start-button').click();
  const hand = page.locator('.pixel-hand-tile'), legal = page.locator('.pixel-hand-tile:enabled');
  const identities = () => hand.evaluateAll(buttons => buttons.map(b => [b.dataset.tileId, b.getAttribute('aria-label')]));
  await legal.first().waitFor();
  await page.keyboard.press('ArrowRight');
  const discard = page.locator('.discard-button:not(:disabled)');
  await discard.waitFor();
  const labels = await identities(), selected = await discard.textContent();
  const canvas = await page.locator('.table-area canvas').elementHandle();
  await settings(); await toggle.click();
  await page.waitForSelector('.is-playing:not(.pixel-mode) canvas:not([data-table-quality="pixel"])');
  assert.equal(await page.locator('.pixel-setting-copy small').evaluate(el => getComputedStyle(el).fontFamily), classicBody);
  await close(); assert.equal(await hand.count(), 0);
  assert.equal(await page.locator('.accessible-hand button').count(), labels.length);
  // Classic play keeps the original raycast targets instead of a second DOM rack.
  const bounds = await canvas.boundingBox();
  let hit = false;
  for (let row = 97; row >= 60 && !hit; row--) {
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height * row / 100);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    hit = await page.evaluate(() => document.body.style.cursor === 'grab');
  }
  assert.ok(hit, 'classic hand is reachable above the dock');
  await settings(); await toggle.click(); await waitPixel(); await close();
  assert.ok(await canvas.evaluate(el => el === document.querySelector('.table-area canvas')), 'renderer not remounted');
  assert.deepEqual(await identities(), labels);
  assert.equal(await discard.textContent(), selected, 'selected tile and turn survived both switches');
  assert.equal(await page.locator('.accessible-hand').count(), 0, 'only one set of accessible play buttons');
  assert.ok(await hand.first().locator('img').evaluate(el => el.width === 64 && el.height === 88 && el.naturalWidth === 64));
  const wall = page.locator('.round-chip b');
  // Play the same first three discards by pointer, keyboard and action button.
  await page.keyboard.press('Escape');
  for (const method of ['click', 'Enter', 'confirm']) {
    const left = Number(await wall.textContent()), before = await identities();
    await legal.first().click();
    assert.equal(await legal.first().getAttribute('aria-pressed'), 'true', 'first pointer press selects only');
    assert.deepEqual(await identities(), before);
    if (method === 'Enter') {
      await page.keyboard.press('ArrowRight');
      assert.ok(await legal.nth(1).evaluate(el => document.activeElement === el && el.getAttribute('aria-pressed') === 'true'));
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Enter');
    } else if (method === 'click') await legal.first().click();
    else await discard.click();
    await page.waitForFunction(n => Number(document.querySelector('.round-chip b')?.textContent) < n, left);
    await legal.first().waitFor();
  }
  await checkPixelType(page, 'table', ['.seat-name','.seat-points','.my-seat strong','.pixel-readout strong','.quick-controls button']);
  assert.equal(await page.locator('.desk-focus .desk-navigation > button:visible').count(), 2);
  assert.equal(await page.locator('.desk-river-wing, #table-tools, .riichi-assist, .auto-difficulty-control').count(), 0);
  assert.equal(await page.getByRole('switch', {name:'不鸣牌', exact:true}).getAttribute('aria-checked'),'true');
  assert.equal(await page.locator('.turn-prompt .quick-controls button').count(),1, 'only active automatic behavior stays visible');
  await settings();
  assert.ok(await page.getByRole('combobox', {name:'设置托管等级'}).evaluate(el => {
    const ctx = document.createElement('canvas').getContext('2d'), style = getComputedStyle(el);
    ctx.font = style.fontSize + ' ' + style.fontFamily;
    return el.clientWidth >= ctx.measureText(el.selectedOptions[0].textContent).width + parseFloat(style.paddingInlineStart) + 12;
  }), 'the current autoplay difficulty fits without truncation');
  await close();
  await screenshot('pixel-table');
  console.log('PASS: classic raycast, scoped live rack, click/keyboard/confirm discards and round-trip style switching');

  const riverImage = page.locator('.river-history-tile img').first();
  for (const [index, width] of [64, 256, 64].entries()) {
    await command('牌河全览');
    await riverImage.waitFor();
    await page.waitForFunction(w => document.querySelector('.river-history-tile img')?.naturalWidth === w, width);
    if (!index) await checkPixelType(page, 'rivers', ['.river-overview h2','.river-view-tabs button','.river-history-row small']);
    assert.ok((await riverImage.getAttribute('src')).startsWith('data:image/webp;base64,'));
    await button('关闭牌河全览').click();
    if (index < 2) {
      await settings(); await toggle.click(); await close();
    }
  }
  assert.ok(await page.evaluate(() => window.previewEncodings.some(([type]) => type === 'image/webp') &&
    window.previewEncodings.filter(([type]) => type === 'image/webp' || type === 'image/png').every(([type, q]) => type === 'image/webp' && q === .9)));
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForSelector('canvas[data-table-layout="landscape"]');
  assert.equal(await page.locator('.desk-river-wing').count(), 0, 'desktop rails do not mount in compact play');
  const nativeBuffer = () => page.waitForFunction(() => {
    const c = document.querySelector('.table-area canvas');
    return c && c.width === Math.floor(c.clientWidth * Math.min(2, devicePixelRatio));
  });
  await nativeBuffer();
  await checkPixelType(page, 'landscape', ['.seat-name','.seat-points','.my-seat strong','.prompt-title']);
  const compactScoresFit = await page.locator('.seat-points, .my-seat strong').evaluateAll(items => items.every(el => {
    const card = el.closest('.seat,.my-seat').getBoundingClientRect();
    const text = document.createRange(); text.selectNodeContents(el);
    const r = text.getBoundingClientRect();
    return getComputedStyle(el).fontSize === '16px' && r.left >= card.left && r.right <= card.right &&
      r.top >= card.top - 1 && r.bottom <= Math.min(innerHeight, card.bottom + 1);
  }));
  assert.ok(compactScoresFit, 'all compact scores and their units stay inside their cards');
  const rackGeometry = () => hand.evaluateAll(items => {
    const rect = el => el.getBoundingClientRect(), drawn = items.findIndex(el => el.hasAttribute('data-drawn'));
    const face = items[0].querySelector('.pixel-hand-face'), art = face.querySelector('img');
    return {
      count: items.length, hit: [rect(items[0]).width, rect(items[0]).height], face: [rect(face).width, rect(face).height],
      sprite: [rect(art).width, rect(art).height], sampling: getComputedStyle(art).imageRendering,
      drawn, gap: drawn > 0 ? rect(items[drawn]).left - rect(items[drawn - 1]).right : 0,
      inView: rect(items[0]).left >= 0 && rect(items.at(-1)).right <= innerWidth &&
        rect(items[0]).top >= rect(document.querySelector('.table-area')).bottom &&
        rect(items[0]).bottom <= rect(document.querySelector('.play-dock')).top,
    };
  });
  const compactRack = await rackGeometry();
  assert.deepEqual(compactRack, { count: 14, hit:[44,66], face:[42,58], sprite:[32,44], sampling:'pixelated', drawn:13, gap:12, inView:true });
  // Leave a selected tile in the real preview, distinct from the separated draw.
  const pick = legal.nth(4); await pick.click(); await page.mouse.move(2, 2);
  assert.ok(await pick.evaluate(el => el.getAttribute('aria-pressed') === 'true' &&
    new DOMMatrixReadOnly(getComputedStyle(el.querySelector('.pixel-hand-face')).transform).m42 === -6));
  await screenshot('pixel-landscape');
  const display = await page.context().newCDPSession(page);
  await display.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: false });
  await page.waitForFunction(() => devicePixelRatio === 2); await nativeBuffer();
  assert.deepEqual(await rackGeometry(), compactRack);
  await display.send('Emulation.clearDeviceMetricsOverride'); await display.detach();
  await page.setViewportSize({ width: 1440, height: 900 });
  await nativeBuffer(); await page.locator('.pixel-readout strong').waitFor();
  await checkDesktopRivers(page, screenshot);
  assert.ok(await page.locator('.seat-name').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 14));
  await command('保存并查看牌谱', true); await button('打开回放').first().click();
  await page.waitForSelector('.replay-board canvas[data-table-quality="pixel"]');
  assert.equal(await hand.count(), 0, 'replay does not get live controls');
  await checkPixelType(page, 'replay', ['.replay-header h2','.replay-seat b','.replay-seat span','.replay-progress output']);
  await button('关闭牌谱库').click(); await page.locator('.resume-button').click();
  await command('开启托管'); await button('接管对局').waitFor();
  await page.locator('.settlement-panel').waitFor({ timeout: 150_000 });
  assert.equal(await hand.count(), 0, 'the physical reveal replaces the play rack at settlement');
  await checkPixelType(page, 'settlement', ['.settlement-header h2','.settlement-header p','.settlement-score-card header strong']);
  assert.deepEqual(errors, []); assert.deepEqual(network, []);
  console.log('PASS: one actual font for game characters and UI; both portrait caches, WebP Q90, native desktop/compact/HiDPI rendering, offline replay');
  await page.close();
  await checkFocusActions(browser, target);
  await testRackVariants(browser, target);
  await checkRiverEdgeCases(browser);
  await checkPrintMotion(browser,target);
} finally { await browser.close(); }

async function testRackVariants(browser, url) {
  for (const mode of ['taiwan', 'sichuan-blood']) {
    const page = await browser.newPage({ viewport: { width:844, height:390 }, reducedMotion:'reduce', hasTouch:true, isMobile:true, deviceScaleFactor:2 });
    page.setDefaultTimeout(30_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.addInitScript(mode => localStorage.setItem('jakukyo.preferences.v2', JSON.stringify({
        mode, pixelMode:true, exchangeThree:true, sound:false, speed:250, difficulty:'novice', quickControls:{ noCall:true },
      })), mode);
      await page.goto(url, { waitUntil:'load', timeout:90_000 });
      await page.getByRole('button', { name:'游戏设置', exact:true }).click();
      await page.getByPlaceholder('留空使用新牌山').fill('Pocket-hand-' + mode);
      await page.getByRole('button', { name:'关闭面板', exact:true }).click();
      await page.locator('.start-button').tap();
      const all = page.locator('.pixel-hand-tile'), legal = page.locator('.pixel-hand-tile:enabled');
      await legal.first().waitFor();
      if (mode === 'taiwan') {
        assert.equal(await all.count(), 17);
        assert.ok(await all.evaluateAll(tiles => tiles.every(b => {
          const r = b.getBoundingClientRect(); return r.width === 44 && r.left >= 0 && r.right <= innerWidth;
        })), 'a full Taiwanese draw fits in landscape at native size');
        const draw = page.locator('.pixel-hand-tile[data-drawn]');
        const pos = await draw.boundingBox();
        await page.getByRole('button', { name:'牌桌工具', exact:true }).tap();
        await page.getByRole('button', { name:'切换俯视视角' }).tap();
        assert.deepEqual(await draw.boundingBox(), pos, 'turning the camera does not move the draw or change its size');
        await page.setViewportSize({ width:667, height:375 });
        await page.waitForFunction(() => {
          const s = document.querySelector('.pixel-hand-scroll'), d = document.querySelector('[data-drawn]');
          return s.scrollWidth > s.clientWidth && d.getBoundingClientRect().right <= innerWidth;
        });
        assert.equal((await draw.boundingBox()).width, 44, 'extra narrow screens scroll rather than shrinking targets');
        await page.setViewportSize({ width:844, height:390 });
        const mid = legal.nth(8);
        await mid.tap();
        assert.equal(await mid.getAttribute('aria-pressed'), 'true', 'real touch selects without discarding');
        const press = await mid.boundingBox(), x = Math.round(press.x + press.width / 2), y = Math.round(press.y + press.height / 2);
        const wall = page.locator('.round-chip b'), left = Number(await wall.textContent());
        // Moving sideways across the row must not commit the already selected tile.
        await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x+55, y, { steps:4 }); await page.mouse.up();
        assert.equal(Number(await wall.textContent()), left); assert.equal(await all.count(), 17);
        const board = await page.locator('.table-area').boundingBox(), tableY = Math.round(board.y + board.height * .63);
        // Cancelling a valid drag must remove the ghost and suppress the trailing click.
        await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, tableY, { steps:6 });
        await page.locator('.pixel-hand-ghost[data-valid=true]').waitFor();
        await page.keyboard.press('Escape'); await page.mouse.up();
        await page.locator('.pixel-hand-ghost').waitFor({ state:'detached' }); assert.equal(Number(await wall.textContent()), left);
        // Drag the same physical touchscreen tile into the public table and release.
        const cdp = await page.context().newCDPSession(page);
        try {
          const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints:y == null ? [] : [{ x, y, id:1 }] });
          await touch('touchStart', y); await touch('touchMove', y-15); await touch('touchMove', tableY);
          await page.locator('.pixel-hand-ghost[data-valid=true]').waitFor();
          await touch('touchEnd');
        } finally { await cdp.detach(); }
        await page.waitForFunction(n => Number(document.querySelector('.round-chip b').textContent) < n, left);
        console.log('PASS: 17-tile landscape, camera-independent hit boxes, narrow panning, real touchscreen drag and cancellation');
      } else {
        assert.equal(await all.count(), 13);
        assert.equal(await page.locator('.pixel-hand-tile[data-drawn]').count(), 0);
        assert.ok(await all.evaluateAll(cards => cards.every(el => getComputedStyle(el).marginInlineStart === '0px')));
        const names = await legal.evaluateAll(cards => cards.map(el => el.getAttribute('aria-label')));
        const group = ['万','筒','条'].map(suit => names.flatMap((name,i) => name.includes(suit) ? [i] : [])).find(ids => ids.length >= 3);
        assert.ok(group);
        const chosen = page.locator('.pixel-hand-tile[aria-pressed=true]');
        await legal.nth(group[0]).tap(); assert.equal(await chosen.count(), 1);
        await legal.nth(group[0]).tap(); assert.equal(await chosen.count(), 0);
        for (const i of group.slice(0,3)) await legal.nth(i).tap();
        assert.equal(await chosen.count(), 3);
        await page.getByRole('button', { name:'确认换三张', exact:true }).tap();
        await page.getByRole('button', { name:'定缺万', exact:true }).waitFor();
        assert.equal(await all.count(), 13); assert.equal(await legal.count(), 0, 'all waiting tiles are visible and read-only');
        const suit = page.getByRole('button', { name:'定缺' + /[万筒条]/.exec(await all.first().getAttribute('aria-label'))[0], exact:true });
        await suit.tap(); await legal.first().waitFor();
        assert.ok(await page.locator('.pixel-hand-tile[data-muted]:disabled').count() > 0, 'void suit legality is indicated on the rack');
        console.log('PASS: Sichuan exchange multiselect, no false draw gap, visible read-only hand and void-suit restrictions');
      }
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
}
