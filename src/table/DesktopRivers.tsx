import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { GameSnapshot, PlayerView } from '../game/types';
import { useHintProps } from '../presentation/PixelHints';
import { normalizeRiverTile } from '../presentation/riverMatches';
import { discardFeedbackScope } from '../presentation/discardFeedback';
import { RIVER_COLUMNS, visibleDiscards } from './riverLayout';
import { tableSeat, type TableTheme } from './themes';
import { SeatFlowers } from './SeatFlowers';
import { tileName } from './tileTextures';
import { IndexedRiverTile } from './IndexedRiverTile';
import { CallSeal, usePrintNotes } from '../presentation/PrintTurn';

// Subscribe to breakpoint crossings, not individual resize events or render frames.
function viewportStore(query: string) {
  let media: MediaQueryList | undefined;
  const get = () => media ??= window.matchMedia(query);
  const listen = (change: () => void) => {
    const m = get(); m.addEventListener('change', change);
    return () => m.removeEventListener('change', change);
  };
  return () => useSyncExternalStore(listen, () => get().matches, () => false);
}
export const useDesktopPlaySpace = viewportStore('(min-width: 960px) and (min-height: 600px)');
export const useDesktopRiverSpace = viewportStore('(min-width: 1200px) and (min-height: 640px)');

const positions = ['自家', '下家', '对家', '上家'];
const suit: Record<string,string> = { m:'万', p:'筒', s:'条' };
interface WingProps {
  snapshot: GameSnapshot; theme: TableTheme; selected: string | null;
  onOpen: (id: number) => void;
}

function RiverSeat({ player, snapshot, theme, selected, onOpen }: WingProps & { player: PlayerView }) {
  const hint = useHintProps();
  const {call,discard} = usePrintNotes(player.id);
  const scroll = useRef<HTMLDivElement>(null), follow = useRef(true);
  const tiles = visibleDiscards(player.discards), name = player.isHuman ? '你' : player.name;
  const side = positions[tableSeat(player.id, snapshot.players.length)];
  const latest = snapshot.lastDiscard?.playerId === player.id
    ? tiles.find(t => t.sourceIndex === snapshot.lastDiscard?.riverIndex) : undefined;
  const active = snapshot.phase === 'response' ? player.isHuman && snapshot.actions.length > 0
    : snapshot.phase !== 'exchange' && snapshot.phase !== 'void' && snapshot.turn === player.id;
  const same = (tile: string) => !!selected && normalizeRiverTile(tile) === selected;
  const matches = selected ? tiles.filter(t => same(t.tile)).length : 0;
  const points = player.points.toLocaleString('en-US');
  const rows = Array.from({ length: Math.ceil(tiles.length / RIVER_COLUMNS) }, (_, i) => tiles.slice(i * RIVER_COLUMNS, (i + 1) * RIVER_COLUMNS));
  // Keep a new discard in view, unless the player deliberately scrolled into history.
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const sync = () => {
      if (follow.current) el.scrollTop = el.scrollHeight;
      el.tabIndex = el.scrollHeight > el.clientHeight + 1 ? 0 : -1;
    };
    sync();
    const resize = new ResizeObserver(sync); resize.observe(el);
    return () => resize.disconnect();
  }, [tiles.length]);
  return <section className="desk-river-seat" data-seat={player.id} data-side={tableSeat(player.id,snapshot.players.length)} data-turn={active || undefined}
    aria-label={`${side} · ${name}的牌河`}>
    <header className="desk-seat-header">
      <span className="desk-wind">{player.wind}</span>
      <div className="desk-identity"><strong className="seat-name">{name}</strong><span>{side}{player.dealer ? '·庄' : ''}</span></div>
      <div className="desk-score"><strong className="seat-points" data-long={points.length > 6 || undefined}>{points}<small>{snapshot.scoreUnit ?? '点'}</small></strong>
        <span>{player.hasWon ? `已和${(player.winCount ?? 0) > 1 ? ' ×' + player.winCount : ''}` : player.riichi ? '立直' : active ? snapshot.phase === 'response' ? '待应答' : '行牌中' : ''}</span></div>
    </header>
    {(player.voidSuit || !!player.kita || !!player.flowers?.length) && <div className="desk-seat-bonus">
      {player.voidSuit && <span>缺{suit[player.voidSuit]}</span>}{!!player.kita && <span>拔北 ×{player.kita}</span>}
      <SeatFlowers flowers={player.flowers} name={name} theme={theme} />
    </div>}
    <div className="desk-river-meta">
      <button type="button" aria-label={`查看${name}的完整牌河`} aria-haspopup="dialog" onClick={() => onOpen(player.id)}
        {...hint(`放大${name}的完整牌河`)}>牌河 <b>{tiles.length}</b><i aria-hidden="true">↗</i></button>
      {matches > 0 && <span className="desk-match-count">同种 {matches}</span>}
      <CallSeal note={call}/>
      {latest && <span className="desk-last-label">最新 · {tileName(latest.tile)}</span>}
    </div>
    <div className="desk-river-scroll" ref={scroll} role="group" aria-label={`${name}的弃牌，按出牌顺序`}
      onScroll={e => { const el = e.currentTarget; follow.current = el.scrollHeight - el.clientHeight - el.scrollTop < 3; }}>
      {rows.length === 0 ? <span className="desk-river-empty">尚未出牌</span> : rows.map(row =>
        <div className="desk-river-row" key={row[0].sourceIndex}>{row.map(t => <IndexedRiverTile
          key={t.sourceIndex} className="desk-discard" tile={t} theme={theme} latest={latest?.sourceIndex===t.sourceIndex}
          landing={discard?.riverIndex===t.sourceIndex ? discard : undefined} match={same(t.tile)} />)}</div>)}
    </div>
  </section>;
}

/** Flank the real table, leaving the hand, camera and action bar on their common centerline. */
export function DesktopRiverWing({ edge, ...props }: WingProps & { edge: 'left' | 'right' }) {
  const { snapshot } = props;
  const seats = edge === 'left' ? [2,3] : [1,0];
  return <aside className="desk-river-wing" aria-label={edge === 'left' ? '桌面左侧牌河' : '桌面右侧牌河'}>
    {seats.map(s => {
      const p = snapshot.players.find(p => tableSeat(p.id, snapshot.players.length) === s);
      return p ? <RiverSeat key={discardFeedbackScope(snapshot) + ':' + p.id} player={p} {...props} /> : null;
    })}
  </aside>;
}
