export type DiscardAction = 'discard' | 'riichi';
export interface DiscardIntent { sequence: number; tileId: string; selectionScope: string }
export interface HandDragContext {
  tileId: string;
  selectionScope: string;
  action: DiscardAction;
  legalKey: string;
}
export interface HandDragPoint { clientX: number; clientY: number; x: number; z: number }
export interface HandDragPreview {
  context: HandDragContext;
  dragging: boolean;
  valid: boolean;
  position: [number, number];
}
export type HandDragEnd = { kind: 'tap' | 'cancel' } | { kind: 'commit'; preview: HandDragPreview };
const signature = (context: HandDragContext) => JSON.stringify([context.tileId, context.selectionScope, context.action, context.legalKey]);

/** Pure pointer lifecycle: a gesture never commits after its hand or legal choices change. */
export function createHandDragController(releaseZ: number) {
  let active: { pointerId: number; start: HandDragPoint; origin: [number, number]; context: HandDragContext; dragging: boolean } | null = null;
  const cancel = () => { active = null; };
  const move = (pointerId: number, point: HandDragPoint | null, context: HandDragContext | null): HandDragPreview | null => {
    if (!active || active.pointerId !== pointerId) return null;
    if (!context || signature(context) !== signature(active.context)) { cancel(); return null; }
    if (!point || ![point.x, point.z, point.clientX, point.clientY].every(Number.isFinite)) return { context: active.context, dragging: active.dragging, valid: false, position: [...active.origin] };
    active.dragging ||= Math.hypot(point.clientX - active.start.clientX, point.clientY - active.start.clientY) >= 8;
    const position: [number, number] = [active.origin[0] + point.x - active.start.x, active.origin[1] + point.z - active.start.z];
    const valid = active.dragging && point.clientY < active.start.clientY - 8 && position[1] < releaseZ
      && position[1] > -4.9 && Math.abs(position[0]) < 5.8;
    return { context: active.context, dragging: active.dragging, valid, position };
  };
  return {
    begin(pointerId: number, point: HandDragPoint | null, origin: [number, number], context: HandDragContext | null) {
      if (!point || !context) return false;
      active = { pointerId, start: point, origin, context: { ...context }, dragging: false }; return true;
    },
    move,
    finish(pointerId: number, point: HandDragPoint | null, context: HandDragContext | null): HandDragEnd {
      const preview = move(pointerId, point, context); cancel();
      return !preview ? { kind: 'cancel' } : !preview.dragging ? { kind: 'tap' } : preview.valid ? { kind: 'commit', preview } : { kind: 'cancel' };
    },
    cancel,
    isActive: () => active !== null,
  };
}
