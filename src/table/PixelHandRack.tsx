import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import type { HandTile } from '../game/types';
import type { DiscardAction } from '../presentation/handInteraction';
import type { TableTheme } from './themes';
import { tilePortraitUrl } from './TilePortrait';
import { tileName } from './tileTextures';
import { printStyle, usePrintNotes } from '../presentation/PrintTurn';

interface RackProps {
  hand: readonly HandTile[];
  selectable: readonly HandTile[];
  selectedId: string | null;
  exchangeIds?: readonly string[];
  theme: TableTheme;
  blocked: boolean;
  scope: string;
  action: DiscardAction | null;
  onSelect: (tile: HandTile) => void;
  onHighlight: (id: string) => void;
  onDrop: (tileId: string, scope: string, action: DiscardAction) => boolean;
}

interface Press {
  pointer: number; button: HTMLButtonElement; startX: number; startY: number;
  tile: HandTile; key: string; moved: boolean;
}

// The dock, dialogs and HUD controls are never a discard target.
function overTable(x: number, y: number) {
  return !!document.elementFromPoint(x, y)?.closest('.table-area :is(.mahjong-viewport,.table-river-field)');
}

/** Live hand identities and legal actions come from the same snapshot as the 3D table.
 * Only the presentation changes; a hand that is waiting is still ours to read. */
export function PixelHandRack({ hand, selectable, selectedId, exchangeIds, theme, blocked, scope, action, onSelect, onHighlight, onDrop }: RackProps) {
  const row = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null), suppressClick = useRef(false);
  const [ghost, setGhost] = useState<{ id: string; tile: string; x: number; y: number; valid: boolean } | null>(null);
  const legal = new Set(selectable.map(t => t.id));
  const inputKey = JSON.stringify([scope, action, blocked, [...legal]]);
  const entryId = selectedId && legal.has(selectedId) ? selectedId : selectable[0]?.id;
  const drawn = hand.find(t => t.drawn);
  const {draw} = usePrintNotes(0);

  function cancelPress() {
    const p = press.current;
    if (!p) return;
    press.current = null; suppressClick.current = true; setGhost(null);
    if (p.button.hasPointerCapture(p.pointer)) p.button.releasePointerCapture(p.pointer);
  }
  useLayoutEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') cancelPress(); };
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', cancelPress);
    document.addEventListener('visibilitychange', cancelPress);
    return () => {
      window.removeEventListener('keydown', escape);
      window.removeEventListener('blur', cancelPress);
      document.removeEventListener('visibilitychange', cancelPress);
      cancelPress();
    };
  }, [inputKey]);
  // Particularly narrow screens can pan instead of shrinking strokes or hit targets.
  useLayoutEffect(() => {
    const scroller = row.current?.parentElement;
    if (!scroller || !drawn) return;
    const revealDraw = () => {
      if (scroller.scrollWidth > scroller.clientWidth) scroller.scrollLeft = scroller.scrollWidth;
    };
    revealDraw();
    const resize = new ResizeObserver(revealDraw);
    resize.observe(scroller); return () => resize.disconnect();
  }, [drawn?.id, scope]);

  function begin(e: PointerEvent<HTMLButtonElement>, tile: HandTile) {
    if (blocked || !e.isPrimary || e.button !== 0) return;
    cancelPress(); suppressClick.current = false;
    press.current = { pointer: e.pointerId, button: e.currentTarget, startX: e.clientX, startY: e.clientY, tile, key: inputKey, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function point(e: PointerEvent<HTMLButtonElement>, finish: boolean) {
    const p = press.current;
    if (!p || e.pointerId !== p.pointer) return;
    if (p.key !== inputKey || blocked) { cancelPress(); return; }
    const dx = e.clientX - p.startX, dy = e.clientY - p.startY;
    p.moved ||= Math.hypot(dx, dy) >= 8;
    const lifted = !!action && p.moved && dy < -8;
    const valid = lifted && overTable(e.clientX, e.clientY);
    if (!finish) {
      if (p.moved) setGhost(lifted ? { id: p.tile.id, tile: p.tile.tile, x: e.clientX, y: e.clientY, valid } : null);
      return;
    }
    press.current = null; suppressClick.current = p.moved; setGhost(null);
    if (valid && action) onDrop(p.tile.id, scope, action);
  }
  function keydown(e: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); e.stopPropagation();
    const i = selectable.findIndex(t => t.id === id), step = e.key === 'ArrowRight' ? 1 : -1;
    const next = selectable[(i + step + selectable.length) % selectable.length];
    if (!next) return;
    const target = Array.from(row.current!.querySelectorAll('button')).find(b => b.dataset.tileId === next.id);
    target?.focus(); onHighlight(next.id);
  }
  return <section className="pixel-hand-rack" aria-label="我的像素手牌" inert={blocked}
    style={{ '--hand-paper': theme.tileFace, '--hand-trim': theme.trim } as CSSProperties}>
    <div className="pixel-hand-scroll"><div className="pixel-hand-row" ref={row} role="group" aria-label="手牌，左右方向键选牌">
      {hand.map(tile => {
        const allowed = legal.has(tile.id);
        const pressed = exchangeIds ? exchangeIds.includes(tile.id) : tile.id === selectedId;
        return <button type="button" key={tile.id} id={`pixel-hand-${tile.id}`} className="pixel-hand-tile"
          data-tile-id={tile.id} data-drawn={tile.drawn || undefined} data-muted={(!allowed && legal.size > 0) || undefined}
          data-lifted={ghost?.id === tile.id || undefined} aria-pressed={pressed}
          aria-label={`选择${tile.label || tileName(tile.tile)}${tile.drawn ? '，摸入牌' : ''}`}
          disabled={blocked || !allowed} tabIndex={tile.id === entryId ? 0 : -1}
          onPointerDown={e => begin(e, tile)} onPointerMove={e => point(e, false)} onPointerUp={e => point(e, true)}
          onPointerCancel={cancelPress} onLostPointerCapture={e => { if (press.current?.pointer === e.pointerId) cancelPress(); }}
          onKeyDown={e => keydown(e, tile.id)}
          onClick={e => { if (!e.detail || !suppressClick.current) onSelect(tile); }}>
          <span className="pixel-hand-pose" data-print-draw={tile.drawn && draw ? draw.key : undefined} style={tile.drawn ? printStyle(draw) : undefined}>
            <span className="pixel-hand-face"><img src={tilePortraitUrl(tile.tile, theme)} alt="" width={32} height={44} draggable={false} /></span>
          </span>
        </button>;
      })}
    </div></div>
    {ghost && <div className="pixel-hand-ghost" aria-hidden="true" data-valid={ghost.valid}
      style={{ left: Math.round(ghost.x), top: Math.round(ghost.y) }}>
      {ghost.valid && <span>松手打出</span>}
      <div className="pixel-hand-face"><img src={tilePortraitUrl(ghost.tile, theme)} alt="" /></div>
    </div>}
  </section>;
}
