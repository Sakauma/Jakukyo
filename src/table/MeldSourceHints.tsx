import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import type { GameSnapshot } from '../game/types';
import { meldSourceText } from '../presentation/meldSource';
import { meldMotionKey } from './motion/tableMotion';

type Point={x:number; y:number};
type Bounds=Point & {bottom:number};
type Source={key:string; pieces:string[]; label:string; owner:string};
export const meldGroupKey=(seat:number,index:number)=>seat+':'+index;

function hintController(element:()=>HTMLDivElement|null) {
  let active:string|null=null, timer:number|undefined, leaveTimer:number|undefined;
  const hide=()=>{ window.clearTimeout(timer); window.clearTimeout(leaveTimer); active=null;
    const el=element(); if(el) el.hidden=true; };
  return {
    project:null as ((source:Source)=>Bounds|null)|null, hide,
    show(source:Source,p?:Point,keyboard=false) {
      window.clearTimeout(leaveTimer);
      if(active===source.key && !keyboard) return;
      hide(); active=source.key;
      const paint=()=>{
        const el=element(); if(!el || active!==source.key) return;
        const bounds=this.project?.(source) ?? (p && {...p,bottom:p.y});
        if(!bounds) { hide(); return; }
        el.textContent=source.label; el.hidden=false;
        el.style.left=Math.max(6,Math.min(innerWidth-el.offsetWidth-6,Math.round(bounds.x-el.offsetWidth/2)))+'px';
        el.style.top=Math.max(6,Math.min(innerHeight-el.offsetHeight-6,Math.round(bounds.y>el.offsetHeight+14?bounds.y-el.offsetHeight-8:bounds.bottom+8)))+'px';
      };
      if(keyboard) paint(); else timer=window.setTimeout(paint,260);
    },
    leave(key:string) {
      // Adjacent faces in the same meld are one inspection target.
      if(active!==key) return;
      window.clearTimeout(leaveTimer); leaveTimer=window.setTimeout(()=>{if(active===key) hide();},0);
    },
  };
}
export type MeldHintBoard={sources:ReadonlyMap<string,Source>; control:ReturnType<typeof hintController>};

export function useMeldSourceHints(snapshot:GameSnapshot|null,view:string,identity?:object|null) {
  const box=useRef<HTMLDivElement>(null);
  const control=useMemo(()=>hintController(()=>box.current),[]);
  const sources=useMemo(()=>{
    const map=new Map<string,Source>();
    if(snapshot) for(const p of snapshot.players) p.melds.forEach((m,i)=>{
      const label=meldSourceText(m,p.id,snapshot.humanId,snapshot.players.length);
      if(!label) return;
      const key=meldGroupKey(p.id,i);
      map.set(key,{key,label,pieces:m.tiles.map((_,t)=>meldMotionKey(p.id,i,t)),owner:p.name+'的第'+(i+1)+'副牌'});
    });
    return map;
  },[snapshot?.players,snapshot?.humanId]);
  const signature=[...sources.values()].map(s=>s.key+s.label).join('|');
  useLayoutEffect(()=>{control.hide();return control.hide;},[control,signature,identity,view,snapshot?.seed,snapshot?.round.hand,snapshot?.round.wind]);
  useEffect(()=>{
    const events=new AbortController(), opts={signal:events.signal,capture:true};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape' && box.current && !box.current.hidden) {
      e.preventDefault(); e.stopPropagation(); control.hide();
    }};
    window.addEventListener('keydown',key,opts);
    for(const name of ['pointerdown','resize','blur','scroll']) window.addEventListener(name,control.hide,opts);
    document.addEventListener('visibilitychange',control.hide,opts);
    return ()=>events.abort();
  },[control]);
  const board=useMemo(()=>({sources,control}),[sources,control]);
  const overlay=<>
    {[...sources.values()].map(s=><span key={s.key} className="meld-inspection-key" tabIndex={0} role="group"
      aria-label={s.owner+'：'+s.label} data-meld-key={s.key}
      onFocus={()=>control.show(s,undefined,true)}
      onKeyDown={e=>{if(['Enter',' ','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();}}}
      onBlur={()=>control.hide()} />)}
    <div ref={box} role="tooltip" className="meld-source-hint" hidden />
  </>;
  return {board,overlay};
}

/** Hover and keyboard inspection share the same mesh bounds. No per-frame
 * projection and no transparent DOM hit area over the player's rack. */
export function MeldHintProjector({control}:{control:MeldHintBoard['control']}) {
  const {scene,camera,gl}=useThree();
  useLayoutEffect(()=>{
    const v=new Vector3();
    control.project=source=>{
      const r=gl.domElement.getBoundingClientRect(); let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
      for(const key of source.pieces) {
        const body=scene.getObjectByName(key)?.getObjectByName('tile-body-pose'); if(!body) continue;
        body.updateWorldMatrix(true,false);
        // Project the rigid tile's eight corners once when the bubble opens.
        // Keep the explanation clear of the entire meld, including stacked kan.
        for(const x of [-.275,.275]) for(const y of [-.385,.385]) for(const z of [-.21,.185]) {
          v.set(x,y,z).applyMatrix4(body.matrixWorld).project(camera);
          const sx=r.left+(1+v.x)*r.width/2, sy=r.top+(1-v.y)*r.height/2;
          left=Math.min(left,sx); right=Math.max(right,sx); top=Math.min(top,sy); bottom=Math.max(bottom,sy);
        }
      }
      return Number.isFinite(top) ? {x:(left+right)/2,y:top,bottom} : null;
    };
    return ()=>{control.project=null;};
  },[scene,camera,gl,control]);
  return null;
}
