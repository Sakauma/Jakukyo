import type { TableMotionKind } from '../../presentation/tableTimeline';

export type PhysicalMove = TableMotionKind | 'insert' | 'indicator';
export type Origin = 'held' | 'released' | 'meld-edge' | 'river-claim';
export interface Gesture {
  travel:number; heightMix:number; turn:number;
  lift:number; across:number; forward:number;
}
export const emptyGesture = (): Gesture => ({travel:0,heightMix:0,turn:0,lift:0,across:0,forward:0});
const clamp = (n:number) => Math.max(0,Math.min(1,n));
const smooth = (n:number) => n*n*(3-2*n);
const ease = (n:number,a:number,b:number) => smooth(clamp((n-a)/(b-a)));
// Immediate engagement and finite speed into the stop. Two end-eased
// segments in succession read as two landings, even on a very short move.
const push = (t:number) => t+t*(1-t)*(.50+.20*t);
const arc = (t:number) => 4*t*(1-t);

/** Curve into the empty column before reaching the front edges of the two
 * resting companions. One continuous stroke, tangent to the slot at entry. */
export function claimLane(travel:number, depth:number) {
  const align=Math.max(.48,Math.min(.9,1-1.05/Math.max(.01,Math.abs(depth))));
  const u=Math.min(1,travel/align);
  return u+u*u*(1-u);
}

/** Seat-local blocking for pieces that travel. Open-call companions stay planted. */
export function classicGesture(out:Gesture, kind:PhysicalMove, progress:number, distance:number,
  origin:Origin='held'): Gesture {
  const t=clamp(progress), reach=clamp(distance/1.5);
  out.travel=out.heightMix=out.turn=push(t);
  out.lift=out.across=out.forward=0;
  if (t===0 || t===1) return out;
  if (origin==='river-claim') {
    // Give the eye a departure and an arrival. No ghost, flourish, or height
    // accent: the rigid tile only lifts when it actually crosses a blocker.
    out.travel=out.heightMix=.16*t+.84*smooth(t);
    out.turn=ease(t,.12,.72);
  } else if (origin==='meld-edge') {
    // A single straight tabletop push, never turning the face.
    out.travel=t*(1.8-.8*t); out.heightMix=out.travel;
  } else if (kind==='insert') {
    // Stay upright. Make a lane for the lateral move, then close it once.
    const clear=ease(t,0,.21)*(1-ease(t,.77,1));
    out.travel=push(clamp((t-.17)/.63));
    out.forward=(.40+.31*reach)*clear; out.lift=.045*clear;
  } else if (kind==='indicator') {
    // Pivot over the long edge instead of lifting, hovering, then turning.
    out.turn=ease(t,0,1); out.lift=.31*Math.sin(Math.PI*out.turn);
  } else if (kind==='discard') {
    out.turn=ease(t,0,.61);
    out.heightMix=.66*ease(t,0,.72)+.34*t*t;
    out.lift=origin==='released' ? 0 : .065*arc(t);
  } else if (kind==='draw' || kind==='kita') {
    out.turn=ease(t,kind==='draw'?.09:0,kind==='draw'?.87:.74);
    out.lift=.10*arc(t);
  } else if (kind==='riichi') {
    out.turn=ease(t,0,.7); out.heightMix=push(t);
  }
  return out;
}

/** Fan each dealt packet from two stacks before standing the tiles up. */
export function classicDeal(out:Gesture, progress:number, index:number, scale:number): Gesture {
  const t=clamp(progress), split=index%4;
  out.travel=push(t); out.heightMix=ease(t,0,1); out.turn=ease(t,.15,1);
  // Adjacent standing slots are ~.58 tile-scales apart; each pair shares
  // the same x while stacked, then separates into its own standing slots.
  out.across=(split%2===0?.29:-.29)*scale*(1-ease(t,.10,.82));
  out.forward=-.76*(1-push(t));
  out.lift=.12*arc(t)+(split%2)*.395*scale*(1-ease(t,0,.55));
  return out;
}

/** A single push passes down the hand. Both end poses (also for a continuing
 * reveal played in reverse) coincide with the original tile transforms. */
export function classicReveal(progress:number, index:number, count:number) {
  const wave=.15*clamp(index/Math.max(1,count-1));
  return ease(progress,wave,1);
}
