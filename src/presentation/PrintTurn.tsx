import { createContext, useContext, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { GameSnapshot } from '../game/types';
import { cueTravel, isMeldCall, needsTableBaseline, tableMotionCues, type TableMotionCue } from './tableTimeline';

type Note = TableMotionCue & { travel: number; until: number; life: number };
const SILENT: readonly Note[] = [];
const Notes = createContext(SILENT);
const calls = {chi:'吃', pon:'碰', kan:'杠', riichi:'立直', kita:'拔北'} as const;

/** A short, non-blocking exposure of a real board change, not an animation on
 * mount. Looking through old rows, changing views or restoring a save is silent.
 * One timeout for the active exposures; no frame loop or engine pause. */
export function TableActionNotes({ snapshot, session, stage, callsOnTable, children }: {
  snapshot: GameSnapshot | null; session: object | null; stage: string | null; callsOnTable:boolean; children: ReactNode;
}) {
  const [notes,set] = useState(SILENT);
  const prev = useRef<GameSnapshot | null>(null);
  const current = useRef(snapshot);
  useLayoutEffect(() => { current.current=snapshot; },[snapshot]);
  useLayoutEffect(() => {
    prev.current=null; set(SILENT);
    const visibility = () => {
      prev.current=!document.hidden && stage ? current.current : null;
      set(SILENT);
    };
    document.addEventListener('visibilitychange',visibility);
    return () => document.removeEventListener('visibilitychange',visibility);
  },[session,stage,callsOnTable]);
  useLayoutEffect(() => {
    const before=prev.current;
    prev.current=stage && !document.hidden && snapshot?.status==='playing' && snapshot.speed>0 ? snapshot : null;
    if (!before || !prev.current || !snapshot || before.round.honba!==snapshot.round.honba || needsTableBaseline(before,snapshot)) {
      set(SILENT); return;
    }
    if (snapshot.revision===before.revision) return;
    const now=performance.now();
    const classic=stage==='classic';
    const cues=tableMotionCues(before,snapshot);
    const callers=new Set(cues.filter(c=>isMeldCall(c.kind)).map(c=>c.seat));
    const fresh=cues.filter(c=>!c.flowerSupplement && !(callsOnTable && isMeldCall(c.kind)) &&
      (classic ? c.kind in calls : c.kind!=='draw' || c.seat===snapshot.humanId)).map(c=>{
      // The travel study changes a physical tile's timing, not the seat badge.
      const travel=cueTravel(c,snapshot.speed,false,classic?'classic':'pixel',false);
      const life=classic ? Math.max(280,travel+150) : c.kind==='discard' ? travel+150 : c.kind==='draw' ? travel : Math.min(650,Math.max(240,snapshot.speed*.9));
      return {...c,travel,life,until:now+life};
    });
    if (fresh.length || callers.size) {
      const newest=fresh.reverse();
      set(old=>{
        // An immediate declaration ends an in-flight pixel hand exposure.
        // A genuine replacement draw in this publication still gets its own note.
        const retained=old.filter(n=>n.until>now && !(n.kind==='draw' && callers.has(n.seat)) && !newest.some(f=>f.seat===n.seat && f.kind===n.kind));
        return !newest.length && retained.length===old.length ? old : [...newest,...retained];
      });
    }
  },[session,stage,snapshot,callsOnTable]);
  useLayoutEffect(() => {
    if (!notes.length) return;
    const timer=window.setTimeout(()=>set(old=>{
      const next=old.filter(n=>n.until>performance.now());
      return next.length ? next : SILENT;
    }),Math.max(0, Math.min(...notes.map(n=>n.until))-performance.now())+1);
    return ()=>window.clearTimeout(timer);
  },[notes]);
  return <Notes.Provider value={stage ? notes : SILENT}>{children}</Notes.Provider>;
}

export function usePrintNotes(seat: number) {
  const notes=useContext(Notes);
  return {draw:notes.find(n=>n.seat===seat && n.kind==='draw'),
    discard:notes.find(n=>n.seat===seat && n.kind==='discard'),
    call:notes.find(n=>n.seat===seat && n.kind in calls)};
}
export function printStyle(n: Note | undefined) {
  return n ? {'--print-travel':n.travel+'ms','--print-life':n.life+'ms'} as CSSProperties : undefined;
}
export function CallSeal({note}: {note: Note | undefined}) {
  if (!note || !(note.kind in calls)) return null;
  return <span key={note.key} className="print-call" style={printStyle(note)} data-call={note.kind}
    aria-hidden="true">{calls[note.kind as keyof typeof calls]}</span>;
}
/** Replace the wind medallion only while a public call is being made. */
export function ClassicDeclaration({seat}: {seat:number}) {
  const note=usePrintNotes(seat).call;
  if (!note || !(note.kind in calls)) return null;
  return <span key={note.key} className="classic-declaration" data-call={note.kind}
    style={{'--call-time':note.life+'ms'} as CSSProperties} aria-hidden="true">{calls[note.kind as keyof typeof calls]}</span>;
}
export type PrintNote = Note;
