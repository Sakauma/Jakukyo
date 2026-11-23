import type { MeldView } from '../game/types';
import { tileName } from './tileName';

/** Seat names are relative to the viewer, including when inspecting an
 * opponent. Only identify the published discard, never a concealed kan. */
export function meldSourceText(m:MeldView,caller:number,viewer:number,count:number):string | null {
  const from=m.from;
  if (m.concealed || from==null || !Number.isInteger(from) || from<0 || from>=count || from===caller) return null;
  const relative=(from-viewer+count)%count;
  const giver=relative===0?'你':count===2?'对家':relative===1?'下家':relative===count-1?'上家':'对家';
  const index=m.calledIndex, code=index!=null && Number.isInteger(index) ? m.tiles[index] : undefined;
  const action=m.type==='chi'?'吃':m.type==='pon'?'碰':code && index!=null && index<3?'加杠':'杠';
  if(!code) return action+' · '+giver+'供牌';
  const name=code==='z7'?'红中':code==='z6'?'发财':code==='z5'?'白板':tileName(code);
  return action+' · '+(action==='加杠'?'原碰来自'+giver+'的'+name:giver+'打出'+name);
}
