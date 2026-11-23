/** Screen-space composition for a one-character declaration. Coordinates are
 * CSS pixels in the board viewport, independent of device pixel ratio. */
export type InkRect = {left:number;top:number;right:number;bottom:number};
export const callSize = (pixel:boolean) => pixel ? {w:54,h:36} : {w:74,h:48};
const touches = (a:InkRect,b:InkRect) => a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;

export function placeMeldCall(face:InkRect,side:number,width:number,height:number,pixel:boolean,avoid:readonly InkRect[]=[]) {
  const {w,h}=callSize(pixel), gap=pixel?4:6, x=(face.left+face.right-w)/2, y=(face.top+face.bottom-h)/2;
  const above=face.top-gap-h, below=face.bottom+gap;
  // Try both shoulders of the group before changing edges. A live wall often
  // sits directly behind the middle tile, with perfectly free cloth beside it.
  const across=[x,face.left-w*.65,face.right-w*.35,face.left-w-2,face.right+2], down=[y,face.top-h*.65,face.bottom-h*.35];
  const over=(v:number,dir:number)=>[0,10,20].flatMap(d=>across.map(u=>[u,v+dir*d]));
  const candidates=[
    over(above,-1),down.map(v=>[face.right+gap,v]),
    down.map(v=>[face.left-gap-w,v]),over(below,1),
  ];
  // Prefer a free edge perpendicular to the rack, not the next meld in the row.
  const order=side===1 ? [1,2,0,3] : side===3 ? [2,1,0,3] : [0,3,1,2];
  const snap=(n:number)=>pixel?2*Math.round(n/2):Math.round(n);
  for(const k of order) for(const [u,v] of candidates[k]) {
    const left=snap(Math.max(2,Math.min(width-w-2,u)));
    const top=snap(Math.max(2,Math.min(height-h-2,v)));
    const box={left,top,right:left+w,bottom:top+h};
    if(box.right<=width && box.bottom<=height && !touches(box,face) && !avoid.some(b=>touches(box,b))) return box;
  }
  return null; // A dense/narrow table wins over drawing through playable information.
}
