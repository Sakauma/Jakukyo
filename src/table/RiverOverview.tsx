import type { GameSnapshot } from '../game/types';
import { RIVER_COLUMNS, riverLayout, visibleDiscards } from './riverLayout';
import { TilePortrait } from './TilePortrait';
import type { TableTheme } from './themes';
import { tileName } from './tileTextures';
import { getRiverMatches } from '../presentation/riverMatches';

export function RiverOverview({ snapshot, theme, onClose, highlightedTile = null }: { snapshot: GameSnapshot; theme: TableTheme; onClose: () => void; highlightedTile?: string | null }) {
  const matches = getRiverMatches(snapshot.players, highlightedTile);
  return <div className="jakukyo-overlay" onClick={onClose}><section className="panel river-overview" role="dialog" aria-modal="true" aria-labelledby="river-title" onClick={event => event.stopPropagation()}>
    <button className="icon-button panel-close" aria-label="关闭牌河全览" onClick={onClose}>✕</button>
    <h2 id="river-title">牌河全览</h2>
    {matches.tile && <p className="river-match-summary"><strong>{tileName(matches.tile)} · 牌河 {matches.inRiverCount} · 副露 {matches.inMeldCount}</strong></p>}
    <div className="river-overview-grid">{snapshot.players.map(player => {
      const tiles = visibleDiscards(player.discards), layout = riverLayout(player.discards);
      const playerMatches = matches.byPlayer.find(item => item.playerId === player.id)!;
      return <article className="river-history" key={player.id}><header><strong>{player.wind} · {player.name}{matches.tile && <b className="river-match-count">牌河 {playerMatches.inRiverCount} · 副露 {playerMatches.inMeldCount}</b>}</strong><span>{tiles.length} 张{layout.pages > 1 ? ` · 桌面显示第 ${layout.page}/${layout.pages} 页` : ''}</span></header>
        {tiles.length ? Array.from({ length: Math.ceil(tiles.length / RIVER_COLUMNS) }, (_, row) => <div className="river-history-row" key={row}><small>{row * RIVER_COLUMNS + 1}</small>{tiles.slice(row * RIVER_COLUMNS, (row + 1) * RIVER_COLUMNS).map(tile => <TilePortrait key={tile.sourceIndex} tile={tile.tile} theme={theme} sideways={tile.sideways} matched={playerMatches.inRiverIndices.includes(tile.sourceIndex)} />)}</div>) : <p className="river-empty">尚未出牌</p>}
      </article>;
    })}</div>
    {matches.tile && matches.calledAwayCount > 0 && <p className="panel-note">累计打出 {matches.discardedCount} 张 · 已鸣走 {matches.calledAwayCount} 张</p>}
  </section></div>;
}
