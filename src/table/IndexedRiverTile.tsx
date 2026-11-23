import { useHintProps } from '../presentation/PixelHints';
import type { VisibleDiscard } from './riverLayout';
import type { TableTheme } from './themes';
import { tileName } from './tileTextures';
import { tilePortraitUrl } from './TilePortrait';
import { printStyle, type PrintNote } from '../presentation/PrintTurn';

const suits: Record<string,string> = { m:'万', p:'筒', s:'条' };

/** A discard is identified twice: a native-size index and the same drawing as
 * the player's hand. Rotate the tile body for riichi, never the printed face. */
export function IndexedRiverTile({ tile, theme, latest = false, match = false, className = '', landing }: {
  tile: VisibleDiscard; theme: TableTheme; latest?: boolean; match?: boolean; className?: string; landing?: PrintNote;
}) {
  const hint = useHintProps();
  const code = tile.tile, suit = suits[code[0]], red = !!suit && code[1] === '0';
  const name = [tileName(code), tile.sideways && '立直横牌', tile.tsumogiri && '摸切',
    latest && '最新弃牌', match && '与所选手牌同种'].filter(Boolean).join(' · ');
  return <span className={`indexed-discard ${className}`} role="img" aria-label={name} {...hint(name)}
    data-code={code} data-suit={suit ? code[0] : 'honor'} data-source-index={tile.sourceIndex}
    data-print-discard={landing?.key} style={printStyle(landing)}
    data-red={red || undefined} data-sideways={tile.sideways || undefined}
    data-drawn-cut={tile.tsumogiri || undefined} data-match={match || undefined} data-latest={latest || undefined}>
    {suit && <span className="river-index" aria-hidden="true"><b>{Number(code[1]) || 5}</b><i>{suit}</i></span>}
    {red && <span className="river-red-pip" aria-hidden="true"/>}
    {code[0] !== 'm' && <img className="river-symbol" src={tilePortraitUrl(code, theme,'print')} alt="" draggable={false} width={32} height={44} />}
    {landing && <i aria-hidden="true" className="print-contact" />}
  </span>;
}
