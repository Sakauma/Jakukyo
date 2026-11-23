import type { TableMotionKind } from '../../presentation/tableTimeline';

/** Exposure sheets rather than a reduced frame rate. The slide, silhouette
 * (turn), and lift use different drawings; only the moving piece is stepped.
 * Negative travel is a small wind-up; the last drawing is the exact rest pose. */
type Pose = readonly [at:number, travel:number, lift:number, turn:number];
const seated: Pose = [1,1,0,1];
const draw: readonly Pose[] = [[0,0,0,0],[.14,0,.55,0],[.29,.18,1.15,.05],[.49,.58,1,.24],[.68,.89,.55,.69],[.84,.98,.18,1],seated];
const discard: readonly Pose[] = [[0,0,0,0],[.14,-.025,.42,.04],[.30,.24,1.05,.25],[.49,.66,.86,.78],[.68,.91,.44,1],[.86,1,.15,1],seated];
// A flat slide from its first moving drawing. No anticipation, lift or flip.
const meld: readonly Pose[] = [[0,0,0,1],[.06,.14,0,1],[.24,.42,0,1],[.46,.70,0,1],[.69,.90,0,1],[.86,.97,0,1],seated];
const stick: readonly Pose[] = [[0,0,0,0],[.18,-.035,0,0],[.38,.27,.5,.24],[.59,.77,.7,.68],[.80,.97,.18,1],seated];
const flip: readonly Pose[] = [[0,0,0,0],[.21,.08,.25,.1],[.39,.31,.9,.36],[.54,.64,1,.68],[.77,.91,.43,.94],seated];
const collect: readonly Pose[] = [[0,0,0,0],[.14,.04,0,0],[.34,.23,0,0],[.53,.52,0,0],[.72,.83,0,0],[.88,.96,0,0],seated];
const sheets = {draw,discard,chi:meld,pon:meld,kan:meld,kita:draw,riichi:stick,deal:draw,reveal:flip,collect};
export function printPose(kind: TableMotionKind | 'deal' | 'reveal' | 'collect', phase:number): Pose {
  const sheet=sheets[kind];
  for(let i=sheet.length-1;i>0;i--) if(phase>=sheet[i][0]) return sheet[i];
  return sheet[0];
}
