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

export async function collectLicenses(root) {
  const source = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const queue = Object.keys(source.dependencies ?? {}).map(name => ({ name, from: root }));
  const visited = new Set(), sections = [];
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
  return `Third-party production dependency notices for Jakukyo\nConservatively includes production dependency packages, including portions not emitted by the browser bundler.\nElectron and Chromium notices are shipped separately in the runtime folder.\n${sections.sort().join('\n')}`;
}
