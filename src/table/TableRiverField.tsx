import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { GameSnapshot, PlayerView } from '../game/types';
import { discardFeedbackScope } from '../presentation/discardFeedback';
import { normalizeRiverTile } from '../presentation/riverMatches';
import { IndexedRiverTile } from './IndexedRiverTile';
import { RIVER_COLUMNS, visibleDiscards } from './riverLayout';
import { tableSeat, type TableTheme } from './themes';
import { fieldLayout } from './riverFieldLayout';
import { tileName } from './tileTextures';
import { useHintProps } from '../presentation/PixelHints';
import { CallSeal, usePrintNotes } from '../presentation/PrintTurn';

const suitNames: Record<string,string> = { m:'万', p:'筒', s:'条' };
interface FieldProps {
  snapshot: GameSnapshot; theme: TableTheme; selected: string | null; onOpen: (id: number) => void;
}
export function TableRiverField(props: FieldProps) {
  const { snapshot } = props;
  const root = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<ReturnType<typeof fieldLayout>>();
  useLayoutEffect(() => {
    const el = root.current!;
    let w = -1, h = -1;
    const measure = () => {
      if (w === el.clientWidth && h === el.clientHeight) return;
      w = el.clientWidth; h = el.clientHeight;
      if (w && h) setLayout(fieldLayout(w,h));
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <div className="table-river-field" ref={root} data-tier={layout?.tier} role="group" aria-label="桌上牌河"
    style={layout ? { '--river-w':layout.w+'px', '--river-h':layout.h+'px', '--river-sw':layout.sideW+'px',
      '--river-sh':layout.sideH+'px', '--river-gap':layout.gap+'px' } as CSSProperties : undefined}>
    {layout && snapshot.players.map(player => <FieldSeat key={discardFeedbackScope(snapshot)+':'+player.id}
      {...props} player={player} layout={layout} />)}
  </div>;
}

function FieldSeat({ snapshot, player:p, layout, theme, selected, onOpen }: FieldProps & {
  player: PlayerView; layout: ReturnType<typeof fieldLayout>;
}) {
  const hint = useHintProps(), button = useRef<HTMLButtonElement>(null);
  const {call,discard} = usePrintNotes(p.id);
  const [manualRow, setManual] = useState<number | null>(null);
  const side = tableSeat(p.id,snapshot.players.length), pos = layout.slots[side];
  const all = visibleDiscards(p.discards), lines = Math.ceil(all.length/RIVER_COLUMNS);
  const lastRow = Math.max(0,lines-pos.rows), first = Math.min(manualRow ?? lastRow,lastRow);
  const start = first*RIVER_COLUMNS;
  const visible = all.slice(start,start+pos.rows*RIVER_COLUMNS), name = p.isHuman ? '你' : p.name;
  const go = (row: number) => setManual(row>=lastRow ? null : Math.max(0,row));
  useLayoutEffect(() => {
    const el=button.current!;
    if (!lastRow) return;
    let sum=0, lastTime=0;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || !event.deltaY || Math.abs(event.deltaX)>Math.abs(event.deltaY)) return;
      event.preventDefault();
      if (performance.now()-lastTime>200) sum=0;
      lastTime=performance.now();
      sum += event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?el.clientHeight:1);
      if (Math.abs(sum)<32) return;
      const dir=Math.sign(sum); sum=0;
      setManual(old => { const n=Math.min(old ?? lastRow,lastRow)+dir; return n>=lastRow ? null : Math.max(0,n); });
    };
    el.addEventListener('wheel',wheel,{passive:false});
    return () => el.removeEventListener('wheel',wheel);
  },[lastRow]);
  const latest = snapshot.lastDiscard?.playerId === p.id ? snapshot.lastDiscard.riverIndex : -1;
  const extras = [p.riichi && '立直', p.voidSuit && '缺'+suitNames[p.voidSuit],
    p.kita && '拔北×'+p.kita, p.flowers?.length && '花×'+p.flowers.length,
    p.hasWon && ('已和'+((p.winCount ?? 0)>1?'×'+p.winCount:''))].filter(Boolean).join(' ');
  const flowers = p.flowers?.length ? '花牌：'+p.flowers.map(tileName).join('、') : '';
  const active = snapshot.phase==='response' ? p.isHuman && snapshot.actions.length>0
    : !['exchange','void'].includes(snapshot.phase) && snapshot.turn===p.id;
  return <button ref={button} className="field-river" data-seat={p.id} data-side={side} data-start={start} data-turn={active || undefined}
    type="button" aria-haspopup="dialog" aria-label={`放大${name}的桌上牌河，共${all.length}张`}
    aria-description={[extras,flowers,visible.map(t=>tileName(t.tile)+(t.sideways?'（立直）':'')).join('、')].filter(Boolean).join('。')}
    onBlur={() => setManual(null)} onPointerLeave={() => { if (document.activeElement!==button.current) setManual(null); }}
    onKeyDown={e => {
      const row = ({ ArrowUp:first-1, ArrowDown:first+1, Home:0, End:lastRow } as Record<string,number>)[e.key];
      if (lastRow && row!==undefined) { e.stopPropagation(); e.preventDefault(); go(row); }
    }} onClick={() => onOpen(p.id)} style={{left:pos.x, top:pos.y, width:layout.group}}>
    <span className="field-heading" {...hint([flowers,lastRow && '滚轮或上下键翻行',`查看${name}的完整牌河`].filter(Boolean).join(' · '))}>
      <b className="field-wind">{p.wind}</b><strong className="seat-name">{name}</strong>
      {!p.isHuman && <span className="seat-points">{p.points.toLocaleString('en-US')}{snapshot.scoreUnit ?? '点'}</span>}
      {extras && <span className="field-extra">{extras}</span>}
      {lastRow>0 && <small className="field-history">{start+1}–{start+visible.length}/{all.length} ↗</small>}
      <CallSeal note={call}/>
    </span>
    {Array.from({length:Math.ceil(visible.length/RIVER_COLUMNS)}, (_,i) =>
      <span key={i+start/RIVER_COLUMNS} className="field-river-row">{visible.slice(i*RIVER_COLUMNS,(i+1)*RIVER_COLUMNS).map(t =>
        <IndexedRiverTile key={t.sourceIndex} tile={t} theme={theme} latest={latest===t.sourceIndex}
          landing={discard?.riverIndex===t.sourceIndex ? discard : undefined}
          match={!!selected && normalizeRiverTile(t.tile)===selected} />)}</span>)}
  </button>;
}
