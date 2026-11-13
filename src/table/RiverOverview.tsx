import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { GameSnapshot } from '../game/types';
import { RIVER_COLUMNS, visibleDiscards } from './riverLayout';
import { TilePortrait } from './TilePortrait';
import type { TableTheme } from './themes';
import { tileName } from './tileTextures';
import { getRiverMatches } from '../presentation/riverMatches';

export function RiverOverview({ snapshot, theme, onClose, highlightedTile = null }: { snapshot: GameSnapshot; theme: TableTheme; onClose: () => void; highlightedTile?: string | null }) {
  const matches = getRiverMatches(snapshot.players, highlightedTile, snapshot);
  const dialog = useRef<HTMLElement>(null);
  const [seat, setSeat] = useState<number | 'all'>(() => window.matchMedia('(orientation:landscape) and (max-height:500px) and (max-width:1100px)').matches ? snapshot.humanId : 'all');
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  const selectSeat = (next: number | 'all') => {
    setSeat(next);
    dialog.current?.querySelector<HTMLButtonElement>(`[data-river-seat="${next}"]`)?.focus();
  };
  const containKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  const players = seat === 'all' ? snapshot.players : snapshot.players.filter(player => player.id === seat);
  return <div className="jakukyo-overlay river-overlay" onClick={onClose}><section ref={dialog} className="panel river-overview" role="dialog" aria-modal="true" aria-labelledby="river-title" onClick={event => event.stopPropagation()} onKeyDown={containKeys}>
    <button type="button" className="icon-button panel-close" aria-label="关闭牌河全览" onClick={onClose}>✕</button>
    <h2 id="river-title">牌河</h2>
    <div className="river-view-tabs" role="group" aria-label="查看哪家牌河">
      <button type="button" data-river-seat="all" aria-pressed={seat === 'all'} onClick={() => selectSeat('all')}>全桌</button>
      {snapshot.players.map(player => <button type="button" key={player.id} data-river-seat={player.id} aria-pressed={seat === player.id} onClick={() => selectSeat(player.id)}>{player.wind} · {player.name}</button>)}
    </div>
    {matches.tile && <p className="river-match-summary"><strong>{tileName(matches.tile)}</strong><span>牌河 {matches.inRiverCount} · 副露 {matches.inMeldCount}</span></p>}
    <div className="river-overview-content"><div className={`river-overview-grid ${seat !== 'all' ? 'is-single' : ''}`}>{players.map(player => {
      const tiles = visibleDiscards(player.discards);
      const playerMatches = matches.byPlayer.find(item => item.playerId === player.id)!;
      return <article className="river-history" key={player.id}><header><div>{seat === 'all' ? <button type="button" className="river-player-focus" aria-label={`放大${player.name}的牌河`} onClick={() => selectSeat(player.id)}>{player.wind} · {player.name}<span aria-hidden="true">↗</span></button> : <strong>{player.wind} · {player.name}</strong>}{matches.tile && <b className="river-match-count">牌河 {playerMatches.inRiverCount} · 副露 {playerMatches.inMeldCount}</b>}</div><span>{tiles.length} 张</span></header>
        {tiles.length ? Array.from({ length: Math.ceil(tiles.length / RIVER_COLUMNS) }, (_, row) => <div className="river-history-row" key={row}><small>{row * RIVER_COLUMNS + 1}</small>{tiles.slice(row * RIVER_COLUMNS, (row + 1) * RIVER_COLUMNS).map(tile => <span key={tile.sourceIndex} className={`river-history-tile ${tile.sideways ? 'is-riichi' : ''}`} title={tile.sideways ? `${tileName(tile.tile)} · 立直宣言牌` : undefined}><TilePortrait tile={tile.tile} theme={theme} matched={playerMatches.inRiverIndices.includes(tile.sourceIndex)} /></span>)}</div>) : <p className="river-empty">尚未出牌</p>}
      </article>;
    })}</div></div>
  </section></div>;
}
