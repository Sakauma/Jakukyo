import { FELT_HALF_X, FELT_HALF_Z, FELT_TOP } from '../tableMaterials';
import { WALL_LAYOUT, wallTileTransform } from '../wallLayout';
import { riverLayout } from '../riverLayout';
import { tableSeat } from '../themes';
import type { PlayerView } from '../../game/types';

/** Thin rectangles of *occupied* table in world x/z, not a full imagined
 * ring. A partly depleted last stack is one tile lower than the other stacks. */
interface Block {
  x:number; z:number; cos:number; sin:number; along:number; across:number; top:number;
  piece?:string;
}
export function classicBlockers(count:number, players:readonly Pick<PlayerView,'id'|'discards'>[]=[]): readonly Block[] {
  const blocks:Block[]=[{x:0,z:0,cos:1,sin:0,along:1.14,across:1.14,top:.18}]; // score plate
  const size=WALL_LAYOUT.scale;
  function add(first:number, last:number, layers:number) {
    const a=wallTileTransform(first), b=wallTileTransform(last);
    const [ax,,az]=a.position, [bx,,bz]=b.position, yaw=-a.rotation[2];
    blocks.push({x:(ax+bx)/2,z:(az+bz)/2,cos:Math.cos(yaw),sin:Math.sin(yaw),
      along:Math.hypot(bx-ax,bz-az)/2+.275*size,across:.385*size,top:FELT_TOP+layers*.395*size});
  }
  for(let start=0;start<count;start+=34) {
    const tiles=Math.min(34,count-start), pairs=Math.floor(tiles/2);
    if(pairs) add(start,start+2*(pairs-1),2);
    if(tiles%2) add(start+2*pairs,start+2*pairs,1);
  }
  for(const player of players) {
    const seat=tableSeat(player.id,players.length)*Math.PI/2,c=Math.cos(seat),s=Math.sin(seat);
    for(const tile of riverLayout(player.discards).items) {
      const [x,,z]=tile.position,yaw=seat+tile.rotation[2],size=tile.scale;
      blocks.push({x:c*x+s*z,z:-s*x+c*z,cos:Math.cos(yaw),sin:Math.sin(yaw),along:.275*size,
        across:.385*size,top:FELT_TOP+.395*size,piece:`river:${player.id}:${tile.sourceIndex}`});
    }
  }
  return blocks;
}

const clamp=(v:number)=>Math.min(1,Math.max(0,v));
const smooth=(v:number)=>v*v*(3-2*v);

type Rotation={x:number;y:number;z:number;w:number};
/** Horizontal projections (world x/z) of the rigid tile's three half-axes. */
export type Footprint=readonly [number,number,number,number,number,number];
export function footprint(q:Rotation,scale:number):Footprint {
  const {x,y,z,w}=q,a=.275*scale,b=.385*scale,c=.21*scale;
  return [a*(1-2*(y*y+z*z)),a*2*(x*z-w*y),b*2*(x*y-w*z),b*2*(y*z+w*x),c*2*(x*z+w*y),c*(1-2*(x*x+y*y))];
}
const span=(p:Footprint,x:number,z:number)=>Math.abs(p[0]*x+p[1]*z)+Math.abs(p[2]*x+p[3]*z)+Math.abs(p[4]*x+p[5]*z);

/** Shorten the local, flat slide near a live wall's end. The tile no longer
 * turns during this stroke, so use its actual footprint (touchedBlocks adds the gap). */
export function meldEntryRun(blocks:readonly Block[],x:number,z:number,scale:number,yaw:number,seat:number,wanted:number) {
  const c=Math.cos(seat), s=Math.sin(seat), a=Math.abs(Math.cos(yaw)), b=Math.abs(Math.sin(yaw));
  const w=(.275*a+.385*b)*scale, h=(.275*b+.385*a)*scale;
  const foot:Footprint=[w*c,-w*s,h*s,h*c,0,0], endX=c*x+s*z, endZ=-s*x+c*z;
  const clear=(d:number)=>!touchedBlocks(blocks,[endX-s*d,endZ-c*d,endX,endZ],scale,[foot,foot]).length;
  if(clear(wanted)) return wanted;
  let lo=0, hi=wanted;
  for(let i=0;i<7;i++) { const mid=(lo+hi)/2; if(clear(mid)) lo=mid; else hi=mid; }
  return lo;
}

/** Usually the claim is pushed in from the table. Where the last wall stack
 * nearly erases that stroke, use the clear strip on the player's side of the
 * SAME column instead. Both ends and the whole face must stay on the cloth. */
export function meldEntryOffset(blocks:readonly Block[],x:number,z:number,scale:number,yaw:number,side:number,wanted:number) {
  const angle=side*Math.PI/2, inner=meldEntryRun(blocks,x,z,scale,yaw,angle,wanted);
  if (inner>=wanted*.7) return -inner;
  const halfDepth=(.385*Math.abs(Math.cos(yaw))+.275*Math.abs(Math.sin(yaw)))*scale;
  const apron=Math.max(0,(side%2 ? FELT_HALF_X : FELT_HALF_Z)-.025-z-halfDepth);
  const outer=-meldEntryRun(blocks,x,z,scale,yaw,angle,-Math.min(wanted,apron));
  return outer>inner+.025 ? outer : -inner;
}

/** Select swept rectangles once at pickup. Use the turning/shrinking piece's
 * footprint, so planting next to a river tile doesn't make it hop. */
export function touchedBlocks(blocks:readonly Block[], path:readonly number[], scale:number, poses?:readonly Footprint[], own?:string) {
  return blocks.filter(b=>{
    if(own && b.piece===own) return false;
    for(let i=2;i<path.length;i+=2) {
      const last=poses?.[i/2-1],p=poses?.[i/2];
      const hx=b.along+(p&&last ? .008+Math.max(span(p,b.cos,-b.sin),span(last,b.cos,-b.sin)) : .47*scale);
      const hz=b.across+(p&&last ? .008+Math.max(span(p,b.sin,b.cos),span(last,b.sin,b.cos)) : .47*scale);
      const dx=path[i-2]-b.x,dz=path[i-1]-b.z, vx=path[i]-path[i-2],vz=path[i+1]-path[i-1];
      const x=dx*b.cos-dz*b.sin,z=dx*b.sin+dz*b.cos,u=vx*b.cos-vz*b.sin,v=vx*b.sin+vz*b.cos;
      let enter=0,exit=1;
      if(Math.abs(u)<1e-8) { if(Math.abs(x)>hx) continue; }
      else { const a=(-hx-x)/u,c=(hx-x)/u; enter=Math.max(enter,Math.min(a,c)); exit=Math.min(exit,Math.max(a,c)); }
      if(Math.abs(v)<1e-8) { if(Math.abs(z)>hz) continue; }
      else { const a=(-hz-z)/v,c=(hz-z)/v; enter=Math.max(enter,Math.min(a,c)); exit=Math.min(exit,Math.max(a,c)); }
      if(enter<=exit) return true;
    }
    return false;
  });
}

/** When a neighbour is immediately in the way, take the tile off its edge
 * before translating (or finish translating before planting). Otherwise both
 * movements start together. The knots are from the actual rigid-tile path. */
export function tightEnd(blocks:readonly Block[],path:readonly number[],poses:readonly Footprint[],last:boolean,underside:number) {
  const n=poses.length;
  for(let j=0;j<Math.min(3,n);j++) {
    const i=last ? n-1-j : j, p=poses[i];
    for(const b of blocks) {
      if(b.top<=underside+.035) continue;
      const dx=path[i*2]-b.x,dz=path[i*2+1]-b.z;
      if(Math.abs(dx*b.cos-dz*b.sin)<=b.along+span(p,b.cos,-b.sin)+.065 &&
         Math.abs(dx*b.sin+dz*b.cos)<=b.across+span(p,b.sin,b.cos)+.065) return true;
    }
  }
  return false;
}

/** Lower extent of the tile as it turns, including the thicker back. Only
 * yaw is added by a seat or a placement, so local-up is also world-up. */
export function lowerExtent(q:Rotation,scale:number) {
  const upX=2*(q.x*q.y+q.z*q.w), upY=1-2*(q.x*q.x+q.z*q.z), upZ=2*(q.y*q.z-q.x*q.w);
  return scale*(.275*Math.abs(upX)+.385*Math.abs(upY)+(upZ<0?.185:.21)*Math.abs(upZ));
}

/** A low push across free felt. Clear the actual public tiles or centre plate.
 * No mesh raycasts or allocations in the loop. */
export function strokeHeight(blocks:readonly Block[], x:number, z:number, base:number, bottom:number, scale:number, t:number, rise=.15, plant=.15) {
  if(t<=0 || t>=1) return base;
  const edge=smooth(clamp(t/rise))*smooth(clamp((1-t)/plant));
  let y=Math.max(base,FELT_TOP+bottom);
  const radius=.47*scale, approach=.95;
  for(const b of blocks) {
    const dx=x-b.x,dz=z-b.z;
    const gap=Math.max(Math.abs(dx*b.cos-dz*b.sin)-b.along,Math.abs(dx*b.sin+dz*b.cos)-b.across)-radius;
    if(gap>=approach) continue;
    const influence=smooth(clamp(1-gap/approach));
    y=Math.max(y,base+influence*(b.top+.014+bottom-base));
  }
  return base+(y-base)*edge;
}
