// Authoring helper only. Runtime loads the committed local PNGs, never this source archive.
import { createRequire } from 'node:module';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url), sharp = require(process.argv[3] || 'sharp');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = resolve(process.argv[2]);
const output = join(root, 'src/table/assets/tiles'); await mkdir(output, { recursive: true });
const tiles = [];
for (const [suit, name] of [['m', 'Man'], ['p', 'Pin'], ['s', 'Sou']]) {
  for (let rank = 1; rank <= 9; rank++) tiles.push([`${suit}${rank}`, `${name}${rank}`]);
  tiles.push([`${suit}0`, `${name}5-Dora`]);
}
['Ton', 'Nan', 'Shaa', 'Pei', 'Haku', 'Hatsu', 'Chun'].forEach((name, index) => tiles.push([`z${index + 1}`, name]));
for (const [code, name] of tiles) {
  // Regular/*.svg contains the transparent symbol only. Front/Back/Blank are deliberately excluded.
  const svg = await readFile(join(source, 'Regular', `${name}.svg`));
  await sharp(svg).resize(256, 352, { fit: 'fill' }).png().toFile(join(output, `${code}.png`));
}
await copyFile(join(source, 'LICENSE.md'), join(output, 'LICENSE.md'));
const columns = 10, cellWidth = 115, cellHeight = 172, sheetWidth = columns * cellWidth + 32, sheetHeight = 4 * cellHeight + 45;
const composites = [];
let background = `<svg width="${sheetWidth}" height="${sheetHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#172e25"/>`;
tiles.forEach(([code], index) => {
  const x = 16 + (index % columns) * cellWidth, y = 17 + Math.floor(index / columns) * cellHeight;
  background += `<rect x="${x}" y="${y}" width="98" height="140" rx="7" fill="#f7f4e9"/><text x="${x + 49}" y="${y + 159}" fill="#ddd4b5" font-family="sans-serif" font-size="13" text-anchor="middle">${code}</text>`;
});
background += '</svg>';
for (let index = 0; index < tiles.length; index++) {
  const input = await sharp(join(output, `${tiles[index][0]}.png`)).resize(91, 126).toBuffer();
  composites.push({ input, left: 19 + (index % columns) * cellWidth, top: 24 + Math.floor(index / columns) * cellHeight });
}
await sharp(Buffer.from(background)).composite(composites).png().toFile(join(root, 'docs/tile-art-contact-sheet.png'));
await sharp({ create: { width: 300, height: 414, channels: 4, background: '#f7f4e9' } }).composite([{ input: await sharp(join(output, 's8.png')).resize(280, 386).toBuffer(), left: 10, top: 14 }]).png().toFile(join(root, 'docs/eight-sou-face.png'));
await writeFile(join(output, 'SOURCE.md'), 'Standard mahjong symbols by FluffyStuff.\nSource: https://github.com/FluffyStuff/riichi-mahjong-tiles (Regular/)\nLicense: CC0/public domain, see LICENSE.md.\nImported 2026-11-07. Only transparent symbol layers; no commercial game artwork.\n');
console.log(`Imported ${tiles.length} local CC0 symbols and rendered the contact sheet.`);
