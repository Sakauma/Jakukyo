import type { CSSProperties } from 'react';
import { tileName, tileTexture } from './tileTextures';
import type { TableTheme } from './themes';

const images = new Map<string, string>();
export function TilePortrait({ tile, theme, sideways = false, winning = false, concealed = false, matched = false }: { tile: string; theme: TableTheme; sideways?: boolean; winning?: boolean; concealed?: boolean; matched?: boolean }) {
  const key = `${theme.id}:${tile}`;
  if (!concealed && !images.has(key)) images.set(key, (tileTexture(tile, theme).image as HTMLCanvasElement).toDataURL('image/png'));
  return <span className={`tile-portrait ${sideways ? 'sideways' : ''} ${winning ? 'winning' : ''} ${concealed ? 'concealed' : ''} ${matched ? 'river-match' : ''}`} style={{ '--portrait-back': theme.tileBack } as CSSProperties} title={concealed ? '暗杠牌' : `${tileName(tile)}${matched ? ' · 与选中手牌同种' : ''}`}>
    {!concealed && <img src={images.get(key)} alt={tileName(tile)} draggable={false} />}
  </span>;
}
