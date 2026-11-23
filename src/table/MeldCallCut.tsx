import {useEffect,useLayoutEffect,useMemo,useRef,useState,type RefObject} from 'react';
import {useFrame} from '@react-three/fiber';
import {Group,Vector3,type Camera,type Object3D} from 'three';
import type {MeldImpact} from './motion/tableMotion';
import {placeMeldCall,type InkRect} from './motion/meldCallLayout';
import type {seatLayout} from './tableLayout';
import {FELT_TOP} from './tableMaterials';
import './meldCallCut.css';

export type CallLayerRef=RefObject<HTMLDivElement|null>;
const words={chi:'吃',pon:'碰',kan:'杠'};

/** Native screen text, not lettering projected onto the felt. Inactive seats
 * have no visible mark, no animation, no focus and no pointer hit area. */
export function MeldCallLayer({layer,pixel}:{layer:CallLayerRef;pixel:boolean}) {
  useEffect(()=>{if(!pixel) void document.fonts.load('40px "Jakukyo Call Brush"','吃碰杠').catch(()=>{});},[pixel]);
  return <div className="meld-call-layer" ref={layer} aria-hidden="true">
    {[0,1,2,3].map(seat=><span className="meld-call-cut" data-seat={seat} key={seat} hidden>
      <svg className="call-sumi" viewBox="0 0 74 48" aria-hidden="true">
        <path fill="#173331" d="M2 32 Q16 27 26 20 L19 21 Q34 13 58 8 L53 12 68 10 60 15 72 13 Q58 21 49 29 L54 28 38 34 43 33 Q27 40 9 41 L20 36 4 39 12 34Z"/>
        <path fill="#386057" d="M6 36 23 29 15 34 29 29 21 34Z M47 15 66 10 55 15Z"/>
        <path fill="currentColor" d="M3 40 Q18 36 27 35 L14 39Z M52 9 65 6 58 9Z"/>
      </svg>
      <span className="call-woodcut" /><b className="call-word"/><i className="call-signature"/>
    </span>)}
  </div>;
}

type Slots=ReturnType<typeof seatLayout>['melds'];
type Box={x0:number;x1:number;z0:number;z1:number;bottom:number;top:number};
function footprints(slots:Slots) {
  const boxes=new Map<number,Box>();
  for(const s of slots) {
    const side=!!s.rotation[2], w=s.scale*(side ? .385 : .275), h=s.scale*(side ? .275 : .385);
    const b=boxes.get(s.meldIndex)??{x0:Infinity,x1:-Infinity,z0:Infinity,z1:-Infinity,bottom:FELT_TOP,top:0};
    b.x0=Math.min(b.x0,s.position[0]-w); b.x1=Math.max(b.x1,s.position[0]+w);
    b.z0=Math.min(b.z0,s.position[2]-h); b.z1=Math.max(b.z1,s.position[2]+h);
    b.top=Math.max(b.top,FELT_TOP+.4*s.scale+(s.stackHeight??0));
    boxes.set(s.meldIndex,b);
  }
  return boxes;
}
function project(box:Box,group:Object3D,camera:Camera,w:number,h:number,v:Vector3):InkRect {
  const bounds={left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity};
  for(const x of [box.x0,box.x1]) for(const z of [box.z0,box.z1]) for(const y of [box.bottom,box.top]) {
    v.set(x,y,z).applyMatrix4(group.matrixWorld).project(camera);
    const px=(1+v.x)*w/2, py=(1-v.y)*h/2;
    bounds.left=Math.min(bounds.left,px); bounds.right=Math.max(bounds.right,px);
    bounds.top=Math.min(bounds.top,py); bounds.bottom=Math.max(bounds.bottom,py);
  }
  return bounds;
}
function hudRects(layer:HTMLDivElement):InkRect[] {
  const root=layer.closest('.table-area'), base=layer.getBoundingClientRect();
  return Array.from(root?.querySelectorAll('.field-heading,.field-river-row,.table-tools,.seat,.pixel-readout,.meld-source-hint:not([hidden])')??[])
    .map(n=>n.getBoundingClientRect()).filter(r=>r.width&&r.height)
    .map(r=>({left:r.left-base.left-2,right:r.right-base.left+2,top:r.top-base.top-2,bottom:r.bottom-base.top+2}));
}

const shell:Box={x0:-.275,x1:.275,bottom:-.385,top:.385,z0:-.21,z1:.185};
function tileRects(scene:Object3D,camera:Camera,w:number,h:number,ownPrefix:string,v:Vector3):InkRect[] {
  const rects:InkRect[]=[];
  // Sample visible geometry, never hidden tile data. The declaration should
  // not look painted on a wall.
  scene.traverseVisible(node=>{
    if(!/^(wall|hand|opponent|meld|river):/.test(node.name) || node.name.startsWith(ownPrefix)) return;
    const body=node.getObjectByName('tile-body-pose'); if(!body) return;
    body.updateWorldMatrix(true,false); rects.push(project(shell,body,camera,w,h,v));
  });
  return rects;
}

function CutAnchor({event,slots,layer,pixel,side}:{event:MeldImpact;slots:Slots;layer:CallLayerRef;pixel:boolean;side:number}) {
  const anchor=useRef<Group>(null), mark=useRef<HTMLElement|null>(null);
  const boxes=useMemo(()=>footprints(slots),[slots]), v=useMemo(()=>new Vector3(),[]);
  const obstacles=useRef<{width:number;height:number;rects:InkRect[]}|null>(null);
  useLayoutEffect(()=>{
    const el=layer.current?.children[event.seat] as HTMLElement|undefined;
    if(!el) return;
    mark.current=el; el.hidden=true; el.style.removeProperty('transform'); el.dataset.call=event.kind; el.dataset.event=event.id;
    el.querySelector('.call-word')!.textContent=words[event.kind];
    return ()=>{mark.current=null; if(el.dataset.event===event.id) {el.hidden=true; delete el.dataset.call; delete el.dataset.event;}};
  },[event,layer]);
  useFrame(({camera,size,scene,clock})=>{
    const node=anchor.current, el=mark.current, host=layer.current, b=boxes.get(event.meldIndex);
    if(!el || !node?.parent || !host || !b) return;
    const t=(clock.oldTime-event.contactAt)/event.life;
    if(t>=1 || event.cancelled || document.hidden) {el.hidden=true; return;}
    node.updateWorldMatrix(true,false);
    if(!obstacles.current || size.width!==obstacles.current.width || size.height!==obstacles.current.height)
      obstacles.current={...size,rects:[...hudRects(host),...tileRects(scene,camera,size.width,size.height,`meld:${event.seat}:${event.meldIndex}:`,v)]};
    const seat=node.parent;
    const rect=(box:Box)=>project(box,seat,camera,size.width,size.height,v);
    const avoid=[...obstacles.current.rects];
    for(const [i,other] of boxes) if(i!==event.meldIndex) avoid.push(rect(other));
    const pos=placeMeldCall(rect(b),side,size.width,size.height,pixel,avoid);
    if(!pos) {el.hidden=true; el.style.removeProperty('transform'); return;}
    // Pre-position while the pieces slide, then show on the very same
    // contact as the sound (immediately for a change without a known slide).
    el.style.transform=`translate(${pos.left}px,${pos.top}px)`;
    if(t<0) {el.hidden=true; return;}
    // One reveal, one still reading beat, one exit. Pixel exposures use whole
    // dots at authored poses, not a filtered or scaled version of the brush.
    const enter=Math.min(1,t/.19), last=Math.max(0,(t-.69)/.31);
    const strike=pixel ? (t<.09?4:t<.19?2:0) : (1-enter)**2*(event.kind==='chi'?7:event.kind==='pon'?4:3);
    el.style.opacity=String(pixel ? (t<.84 ? 1 : t<.94 ? .72 : .35) : 1-last*last);
    el.style.setProperty('--strike-x',(event.kind==='chi'?-strike:0)+'px');
    el.style.setProperty('--strike-y',(event.kind==='chi'?0:-strike)+'px');
    el.style.setProperty('--brush-crop',(pixel ? (t<.1?38:t<.2?14:0) : 36*(1-enter))+'%');
    el.style.setProperty('--seal',t>(event.kind==='kan' ? .18 : .10)?'1':'0');
    el.hidden=false;
  });
  const b=boxes.get(event.meldIndex);
  return b ? <group name={`meld-cut:${event.seat}:${event.meldIndex}:${event.kind}`} ref={anchor}
    position={[(b.x0+b.x1)/2,FELT_TOP,(b.z0+b.z1)/2]}/> : null;
}
export function MeldCallCut(props:Parameters<typeof CutAnchor>[0]) {
  const [spent,setSpent]=useState(false);
  useEffect(()=>{
    const timer=setTimeout(()=>setSpent(true),Math.max(0,props.event.contactAt+props.event.life-performance.now()));
    return ()=>clearTimeout(timer);
  },[props.event]);
  return spent?null:<CutAnchor {...props}/>;
}
