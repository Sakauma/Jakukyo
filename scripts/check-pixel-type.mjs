import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A CSS family name alone can't tell whether individual Chinese glyphs ended
// up in a system font. Ask Chromium which font actually painted the text.
export async function checkPixelType(page, screen, selectors, checkCorpus = false) {
  await page.evaluate(() => document.fonts.ready.then(() => true));
  const issues = await page.locator('.app.pixel-mode').evaluate(root => {
    const bad = [];
    for (const el of root.querySelectorAll('[title]:not([title=""])')) bad.push(['native tooltip', el.title]);
    function check(el, pseudo = null) {
      const s = getComputedStyle(el, pseudo);
      if (s.fontFamily.replaceAll('"', '') !== 'Jakukyo Pixel' ||
          ![16, 32, 48].includes(parseFloat(s.fontSize)) || s.fontWeight !== '400' || s.fontStyle !== 'normal') {
        bad.push([el.className || el.tagName, pseudo, s.fontFamily, s.fontSize, s.fontWeight, s.fontStyle]);
      }
    }
    for (const el of root.querySelectorAll('*')) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.matches('button,input,select,option,textarea') ||
          [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) check(el);
      if (el.matches('[placeholder]')) check(el, '::placeholder');
    }
    return bad;
  });
  assert.deepEqual(issues, [], screen + ': mixed typography');

  const cdp = await page.context().newCDPSession(page);
  try {
    if (checkCorpus) {
      const src = fileURLToPath(new URL('../src/', import.meta.url));
      const files = (await readdir(src, { recursive: true })).filter(f => /\.tsx?$/.test(f) && !/^generated[/\\]/.test(f));
      const glyphs = new Set(Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)));
      for (const file of files) for (const char of await readFile(join(src, file), 'utf8')) {
        if (char.codePointAt(0) >= 0xa0 && !/\s/.test(char)) glyphs.add(char);
      }
      await page.locator('.app.pixel-mode').evaluate((root, corpus) => {
        const probe = document.createElement('span'); probe.id = 'type-coverage-probe';
        probe.style.cssText = 'position:fixed;top:-100px;left:0;white-space:nowrap';
        probe.textContent = corpus; root.append(probe);
      }, [...glyphs].join(''));
      selectors = [...selectors, '#type-coverage-probe'];
      console.log(`Checking ${glyphs.size} distinct characters from the game source`);
    }
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    for (const selector of selectors) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      assert.ok(nodeId, screen + ': missing ' + selector);
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      assert.ok(fonts.length && fonts.every(f => f.isCustomFont && f.postScriptName === 'Unifont'),
        screen + ' ' + selector + ': ' + JSON.stringify(fonts));
    }
  } finally {
    if (checkCorpus) await page.evaluate(() => document.querySelector('#type-coverage-probe')?.remove());
    await cdp.detach();
  }
}
