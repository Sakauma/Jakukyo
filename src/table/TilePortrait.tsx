import { useHintProps } from '../presentation/PixelHints';
import type { CSSProperties } from 'react';
import { tileName, tileSurface } from './tileTextures';
import type { TableTheme } from './themes';
import { themeArtKey } from './themes';
import { drawPixelSymbol, PIXEL_TILE_HEIGHT, PIXEL_TILE_WIDTH } from './tileArt';

const images = new Map<string, string>();
type PortraitKind = 'face' | 'print';
function encodePortrait(tile: string, theme: TableTheme, kind: PortraitKind) {
  // Only the ink is needed on indexed tiles; don't paint a second bevel or
  // paper rectangle inside the face. Double before WebP chroma subsampling.
  if (kind === 'print' && theme.pixel) {
    const paper = document.createElement('canvas');
    paper.width = 2*PIXEL_TILE_WIDTH; paper.height = 2*PIXEL_TILE_HEIGHT;
    const ctx = paper.getContext('2d')!;
    ctx.imageSmoothingEnabled = false; ctx.scale(2,2); drawPixelSymbol(ctx,tile,false,0);
    return paper.toDataURL('image/webp', .9);
  }
  const source = tileSurface(tile, theme).map.image as HTMLCanvasElement;
  if (!theme.pixel) return source.toDataURL('image/webp', 0.9);
  // One sprite pixel per 2×2 chroma block: red and green strokes keep their
  // edges through WebP's chroma subsampling. Never interpolate the artwork.
  const preview = document.createElement('canvas');
  preview.width = source.width * 2;
  preview.height = source.height * 2;
  const ctx = preview.getContext('2d')!; ctx.imageSmoothingEnabled = false;
  ctx.scale(2, 2);
  ctx.drawImage(source, 0, 0);
  return preview.toDataURL('image/webp', 0.9);
}
export function tilePortraitUrl(tile: string, theme: TableTheme, kind: PortraitKind = 'face'): string {
  const key = `${themeArtKey(theme)}:${tile}:${kind}`;
  let image = images.get(key);
  if (!image) { image = encodePortrait(tile, theme, kind); images.set(key, image); }
  return image;
}
export function TilePortrait({ tile, theme, sideways = false, winning = false, concealed = false, matched = false }: { tile: string; theme: TableTheme; sideways?: boolean; winning?: boolean; concealed?: boolean; matched?: boolean }) {
  const hintProps = useHintProps();
  return <span className={`tile-portrait ${sideways ? 'sideways' : ''} ${winning ? 'winning' : ''} ${concealed ? 'concealed' : ''} ${matched ? 'river-match' : ''}`} style={{ '--portrait-back': theme.tileBack } as CSSProperties} {...hintProps(concealed ? '暗杠牌' : `${tileName(tile)}${matched ? ' · 与选中手牌同种' : ''}`)}>
    {!concealed && <img src={tilePortraitUrl(tile, theme)} alt={tileName(tile)} draggable={false} />}
  </span>;
}
