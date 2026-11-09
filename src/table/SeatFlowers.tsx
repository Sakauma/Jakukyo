import type { TableTheme } from './themes';
import { TilePortrait } from './TilePortrait';
import { tileName } from './tileTextures';

/** Public flower tiles stay attached to the owning player's seat. */
export function SeatFlowers({ flowers, name, theme, own = false }: { flowers?: readonly string[]; name: string; theme: TableTheme; own?: boolean }) {
  if (!flowers?.length) return null;
  return <div className="seat-flowers" role="group" aria-label={`${name}的花牌：${flowers.map(tileName).join('、')}`}>
    {own && <span className="seat-flowers-owner" aria-hidden="true">你</span>}
    {flowers.map((tile, index) => <TilePortrait key={`${tile}-${index}`} tile={tile} theme={theme} />)}
  </div>;
}
