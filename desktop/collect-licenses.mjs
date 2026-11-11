import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';

async function findPackage(name, start) {
  let directory = start;
  while (true) {
    const candidate = join(directory, 'node_modules', name);
    try { return { directory: candidate, info: JSON.parse(await readFile(join(candidate, 'package.json'), 'utf8')) }; } catch { /* Try parent dependency root. */ }
    if (directory === parse(directory).root) return null;
    directory = dirname(directory);
  }
}

export async function collectLicenses(root, { electronRuntime = true } = {}) {
  const source = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const tileDirectory = join(root, 'src', 'table', 'assets', 'tiles');
  let tileSource, tileLicense;
  try {
    [tileSource, tileLicense] = await Promise.all([
      readFile(join(tileDirectory, 'SOURCE.md'), 'utf8'),
      readFile(join(tileDirectory, 'LICENSE.md'), 'utf8'),
    ]);
  } catch (cause) {
    throw new Error('Cannot package tile artwork: src/table/assets/tiles/SOURCE.md and LICENSE.md are required.', { cause });
  }
  if (!tileSource.trim() || !tileLicense.trim()) {
    throw new Error('Cannot package tile artwork with empty source attribution or license text.');
  }
  const modelSource = JSON.parse(await readFile(join(root, 'src/game/ai/models/mcr/source.json'), 'utf8'));
  const riichiSource = JSON.parse(await readFile(join(root, 'src/game/ai/models/riichi/source.json'), 'utf8'));
  const riichiLicense = await readFile(join(root, 'src/game/ai/models/riichi/LICENSE'), 'utf8');
  const modelLicense = `MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
  const queue = Object.keys(source.dependencies ?? {}).map(name => ({ name, from: root }));
  const visited = new Set(), sections = [
    `\n${'='.repeat(72)}\nBundled standard mahjong tile artwork\n\nSOURCE.md\n${tileSource}\nLICENSE.md\n${tileLicense}`,
    `\n${'='.repeat(72)}\nBundled MCR local policy model and feature/action adapter\nPublisher: ${modelSource.publisher}\nDeclared license: ${modelSource.license}\nLicense declaration: ${modelSource.licenseDeclaration}\nPinned source and runtime provenance\n${JSON.stringify(modelSource, null, 2)}\n\n${modelLicense}`,
    `\n${'='.repeat(72)}\nBundled TanyaoDojo local riichi policy model and public feature adapter\n${JSON.stringify(riichiSource, null, 2)}\n\n${riichiLicense}`,
  ];
  while (queue.length) {
    const item = queue.shift(), pkg = await findPackage(item.name, item.from);
    if (!pkg) continue;
    const key = `${pkg.info.name}@${pkg.info.version}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const filenames = (await readdir(pkg.directory)).filter(name => /^(licen[sc]e|copying|notice)(\.|$|-)/i.test(name));
    const notices = [];
    for (const file of filenames) {
      try { notices.push(`${file}\n${await readFile(join(pkg.directory, file), 'utf8')}`); } catch { /* Ignore directories with these names. */ }
    }
    sections.push(`\n${'='.repeat(72)}\n${key}\nLicense: ${JSON.stringify(pkg.info.license ?? 'See package notices')}\nSource: ${typeof pkg.info.repository === 'string' ? pkg.info.repository : pkg.info.repository?.url ?? pkg.info.homepage ?? ''}\n\n${notices.join('\n\n')}`);
    for (const name of Object.keys(pkg.info.dependencies ?? {})) queue.push({ name, from: pkg.directory });
  }
  return `Third-party notices for Jakukyo\nIncludes bundled tile artwork attribution and licenses.\nConservatively includes production dependency packages, including portions not emitted by the browser bundler.\n${electronRuntime ? 'Electron and Chromium notices are shipped separately in the runtime folder.\n' : ''}${sections.sort().join('\n')}`;
}
