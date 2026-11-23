import * as THREE from 'three';
import { flowerName } from '../game/flowerName';
import { getTheme, themeArtKey } from './themes';
import type { TableTheme } from './themes';
import { drawPixelSymbol, PIXEL_TILE_WIDTH, PIXEL_TILE_HEIGHT, tileSymbol } from './tileArt';
export { tileName } from '../presentation/tileName';

const textures = new Map<string, THREE.CanvasTexture>();
const WIDTH = 256, HEIGHT = 352;

function surface(width = WIDTH, height = HEIGHT) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d')! };
}

function texture(canvas: HTMLCanvasElement, color = true) {
  const result = new THREE.CanvasTexture(canvas);
  if (color) result.colorSpace = THREE.SRGBColorSpace;
  result.anisotropy = 4;
  return result;
}

/** Mature CC0 symbols are shared by the 3D material, river history, and settlement UI. */
function drawGlyph(ctx: CanvasRenderingContext2D, code: string, theme: TableTheme) {
  const symbol = tileSymbol(code);
  if (symbol) { ctx.drawImage(symbol, 8, 10, 240, 332); return; }
  if (code[0] !== 'f') return;
  const rank = Number(code[1]);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = rank <= 4 ? theme.red : theme.green;
  ctx.font = 'bold 145px "KaiTi", "STKaiti", serif';
  ctx.fillText(flowerName(code), 128, 155);
  ctx.strokeStyle = rank <= 4 ? theme.green : theme.red; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(74, 267); ctx.quadraticCurveTo(122, 245, 180, 269); ctx.stroke();
  ctx.fillStyle = theme.ink; ctx.font = '30px Georgia, serif'; ctx.fillText(String(rank), 128, 299);
}
export function tileSurface(code: string, theme: TableTheme = getTheme(), small = false, turns = 0) {
  const riverInk=small && (code[0]==='m' || code[0]==='s');
  const key = `${themeArtKey(theme)}:${code}${theme.pixel && small ? ':small:' + turns : riverInk ? ':river-ink' : ''}`;
  if (theme.pixel) {
    if (!textures.has(key)) {
      const { canvas, ctx } = surface(PIXEL_TILE_WIDTH, PIXEL_TILE_HEIGHT);
      ctx.fillStyle = theme.tileFace; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#dbc9a8'; ctx.fillRect(canvas.width - 1, 1, 1, canvas.height - 1); ctx.fillRect(1, canvas.height - 1, canvas.width - 1, 1);
      ctx.imageSmoothingEnabled = false;
      if(riverInk) ctx.filter='brightness(.82)';
      drawPixelSymbol(ctx, code, small, turns);
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      map.magFilter = map.minFilter = THREE.NearestFilter; map.generateMipmaps = false;
      textures.set(key, map);
    }
    return { map: textures.get(key)!, bump: null, roughness: null };
  }
  if (!textures.has(key)) {
    const glyph = surface(); drawGlyph(glyph.ctx, code, theme);
    const face = surface(); face.ctx.fillStyle = theme.tileFace; face.ctx.fillRect(0, 0, WIDTH, HEIGHT);
    if (riverInk) {
      // Thicken the original transparent strokes before mipmapping. At far
      // seats the gain is a fraction of a screen pixel, not an outline or a blur.
      face.ctx.filter='brightness(.80)';
      for(const [x,y] of [[-2,0],[2,0],[0,-2],[0,2]]) face.ctx.drawImage(glyph.canvas,x,y);
    } else {
      face.ctx.shadowColor = 'rgba(45,35,26,.28)'; face.ctx.shadowBlur = 1.1; face.ctx.shadowOffsetY = .8;
    }
    face.ctx.drawImage(glyph.canvas, 0, 0); textures.set(key, texture(face.canvas));
    if (!textures.has(`engraving:${code}`)) {
      const image = glyph.ctx.getImageData(0, 0, WIDTH, HEIGHT), bump = surface(128, 176), rough = surface(128, 176);
      const bumpPixels = bump.ctx.createImageData(128, 176), roughPixels = rough.ctx.createImageData(128, 176);
      for (let y = 0; y < 176; y++) for (let x = 0; x < 128; x++) {
        const target = (y * 128 + x) * 4, source = ((y * 2) * WIDTH + x * 2) * 4;
        const luminance = (image.data[source] * .2126 + image.data[source + 1] * .7152 + image.data[source + 2] * .0722) / 255;
        const alpha = (image.data[source + 3] / 255) * (1 - luminance), height = 245 - Math.round(alpha * 155), roughness = 140 + Math.round(alpha * 72);
        for (let channel = 0; channel < 3; channel++) { bumpPixels.data[target + channel] = height; roughPixels.data[target + channel] = roughness; }
        bumpPixels.data[target + 3] = roughPixels.data[target + 3] = 255;
      }
      bump.ctx.putImageData(bumpPixels, 0, 0); rough.ctx.putImageData(roughPixels, 0, 0);
      textures.set(`engraving:${code}`, texture(bump.canvas, false)); textures.set(`rough:${code}`, texture(rough.canvas, false));
    }
  }
  return { map: textures.get(key)!, bump: textures.get(`engraving:${code}`)!, roughness: textures.get(`rough:${code}`)! };
}

export function tileTexture(code: string, theme: TableTheme = getTheme()) { return tileSurface(code, theme).map; }

/** A two-ink woven knot, painted on the reverse only (not stretched over the sides). */
export function pixelBackTexture(theme: TableTheme) {
  const key = `pixel-back:${theme.id}`;
  if (!textures.has(key)) {
    const { canvas, ctx } = surface(32, 44);
    // A stamped split feather, with a single light cut and two clipped corners.
    // All closed backs share the die, regardless of the concealed tile code.
    ctx.fillStyle = theme.background; ctx.fillRect(0,0,32,44);
    ctx.fillStyle = theme.tileBack; ctx.fillRect(2,2,28,40);
    ctx.fillStyle = theme.ui.border;
    for(const [x,y,w,h] of [[3,3,16,1],[3,4,1,11],[12,40,17,1],[28,29,1,11]]) ctx.fillRect(x,y,w,h);
    const feather=['........##','......####','.....###.#','...####.#.','..####.##.','.###..##..','###.###...','##.###....','..###.....','.##.......'];
    if(theme.motif!=='plain') feather.forEach((line,y)=>[...line].forEach((p,x)=>{
      if(p==='#')ctx.fillRect(6+x*2,11+y*2,2,2);
    }));
    else ctx.fillRect(10,20,12,3);
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.NearestFilter; textures.set(key, map);
  }
  return textures.get(key)!;
}

function noise(seed: number) {
  let value = seed;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}

export function feltSurface(theme: TableTheme) {
  const key = `felt:${theme.id}`;
  if (!textures.has(key)) {
    const cloth = surface(256, 256), relief = surface(256, 256), random = noise(173);
    const base = new THREE.Color(theme.felt); base.convertLinearToSRGB();
    const pixels = cloth.ctx.createImageData(256, 256), heights = relief.ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const at = (y * 256 + x) * 4, fiber = random(), weave = ((x + Math.floor(y / 2)) % 4 < 2 ? 1 : -1);
      const shade = .95 + fiber * .09 + weave * .012;
      pixels.data[at] = Math.min(255, base.r * 255 * shade); pixels.data[at + 1] = Math.min(255, base.g * 255 * shade); pixels.data[at + 2] = Math.min(255, base.b * 255 * shade); pixels.data[at + 3] = 255;
      heights.data[at] = heights.data[at + 1] = heights.data[at + 2] = 110 + fiber * 45 + weave * 13; heights.data[at + 3] = 255;
    }
    cloth.ctx.putImageData(pixels, 0, 0); relief.ctx.putImageData(heights, 0, 0);
    if (theme.motif === 'petal') {
      cloth.ctx.fillStyle = 'rgba(255,224,235,.035)';
      for (let i = 0; i < 5; i++) { cloth.ctx.save(); cloth.ctx.translate(128, 128); cloth.ctx.rotate(i * Math.PI * 2 / 5); cloth.ctx.beginPath(); cloth.ctx.ellipse(0, -20, 9, 18, 0, 0, Math.PI * 2); cloth.ctx.fill(); cloth.ctx.restore(); }
    } else if (theme.motif === 'stars') {
      cloth.ctx.strokeStyle = 'rgba(216,232,255,.045)'; cloth.ctx.lineWidth = 1;
      cloth.ctx.beginPath(); cloth.ctx.moveTo(128, 110); cloth.ctx.lineTo(128, 146); cloth.ctx.moveTo(110, 128); cloth.ctx.lineTo(146, 128); cloth.ctx.stroke();
    }
    const map = texture(cloth.canvas), bump = texture(relief.canvas, false);
    for (const tex of [map, bump]) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(16, 16); }
    textures.set(key, map); textures.set(`${key}:bump`, bump);
  }
  return { map: textures.get(key)!, bump: textures.get(`${key}:bump`)! };
}

export function woodSurface(theme: TableTheme) {
  const key = `wood:${theme.id}`;
  if (!textures.has(key)) {
    const wood = surface(512, 128), relief = surface(512, 128), random = noise(917);
    const base = new THREE.Color(theme.rail); base.convertLinearToSRGB();
    const pixels = wood.ctx.createImageData(512, 128), heights = relief.ctx.createImageData(512, 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 512; x++) {
      const at = (y * 512 + x) * 4;
      const warp = Math.sin(x * .019) * 2.4 + Math.sin(x * .006 + y * .06) * 3;
      const grain = Math.sin((y + warp) * 2.9) * .035 + Math.sin((y + warp) * .52) * .055 + (random() - .5) * .035;
      const shade = 1 + grain;
      pixels.data[at] = Math.min(255, base.r * 255 * shade); pixels.data[at + 1] = Math.min(255, base.g * 255 * shade); pixels.data[at + 2] = Math.min(255, base.b * 255 * shade); pixels.data[at + 3] = 255;
      heights.data[at] = heights.data[at + 1] = heights.data[at + 2] = 128 + grain * 230; heights.data[at + 3] = 255;
    }
    wood.ctx.putImageData(pixels, 0, 0); relief.ctx.putImageData(heights, 0, 0);
    const map = texture(wood.canvas), bump = texture(relief.canvas, false);
    for (const tex of [map, bump]) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(3, 1); }
    textures.set(key, map); textures.set(`${key}:bump`, bump);
  }
  return { map: textures.get(key)!, bump: textures.get(`${key}:bump`)! };
}

export function contactTexture() {
  const existing = textures.get('contact'); if (existing) return existing;
  const shadow = surface(64, 64);
  const gradient = shadow.ctx.createRadialGradient(32, 32, 6, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(0,0,0,.42)'); gradient.addColorStop(.5, 'rgba(0,0,0,.2)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
  shadow.ctx.fillStyle = gradient; shadow.ctx.fillRect(0, 0, 64, 64);
  const result = texture(shadow.canvas); textures.set('contact', result); return result;
}
