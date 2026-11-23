import pixelAtlasUrl from './assets/pixel-tiles.png';

const urls = import.meta.glob('./assets/tiles/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const boards = import.meta.glob('./assets/woodcut/board-*.png', { eager:true, query:'?url', import:'default' }) as Record<string,string>;
const symbols = new Map<string, HTMLImageElement>();
let preparing: Promise<void> | undefined;

/** All artwork is bundled locally; preload once before the first texture is painted. */
export function prepareTileArt(): Promise<void> {
  preparing ??= Promise.all(Object.entries({ ...urls, ...boards, 'pixel-atlas.png': pixelAtlasUrl }).map(async ([path, url]) => {
    const image = new Image(); image.src = url; await image.decode();
    symbols.set(path.split('/').at(-1)!.replace('.png', ''), image);
  })).then(() => undefined);
  return preparing;
}

export function tileSymbol(code: string) { return symbols.get(code); }

export const PIXEL_TILE_WIDTH = 32, PIXEL_TILE_HEIGHT = 44;
export function drawPixelSymbol(ctx: CanvasRenderingContext2D, code: string, small: boolean, turns: number) {
  const atlas = symbols.get('pixel-atlas');
  const row = 'mpszf'.indexOf(code[0]), col = Number(code[1]);
  if (!atlas || row < 0 || !Number.isInteger(col)) return;
  const atlasRow = small && row < 3 ? row + 5 : row;
  const x = col * PIXEL_TILE_WIDTH, y = atlasRow * PIXEL_TILE_HEIGHT;
  ctx.save(); ctx.translate(PIXEL_TILE_WIDTH / 2, PIXEL_TILE_HEIGHT / 2); ctx.rotate(turns * Math.PI / 2);
  if (small && turns % 2 && row < 3) {
    // Side seats present a wide tile. Recompose the two stamps side by side,
    // rather than squeezing or turning the numeral. The tile itself stays put.
    ctx.drawImage(atlas, x+5,y+2,22,24, -21,-12,22,24);
    ctx.drawImage(atlas, x+8,y+26,16,16, 3,-8,16,16);
    if (col === 0) { ctx.fillStyle = '#ae3342'; ctx.fillRect(-20,-14,3,3); }
  } else if (small && turns % 2 && row === 3 && col !== 5) {
    ctx.drawImage(atlas, x,y+6,32,32, -16,-16,32,32);
  } else if (small && turns % 2) {
    ctx.drawImage(atlas, x,y,32,44, -22,-16,44,32);
  } else {
    ctx.drawImage(atlas, x,y,32,44, -16,-22,32,44);
  }
  ctx.restore();
}
