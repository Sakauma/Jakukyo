import { RIVER_COLUMNS } from './riverLayout';

type Tier = 'compact' | 'standard' | 'large';
// Dimensions are CSS pixels; the artwork and its index are never perspective-scaled.
export const RIVER_METRICS = {
  compact:  { w:36, h:46, sideW:50, sideH:34 },
  standard: { w:48, h:60, sideW:66, sideH:46 },
  large:    { w:62, h:72, sideW:82, sideH:54 },
} as const;
export function fieldLayout(width: number, height: number) {
  const tier: Tier = width >= 1640 && height >= 590 ? 'large'
    : width >= 1260 && height >= 430 ? 'standard' : 'compact';
  const m = RIVER_METRICS[tier], gap = 3, step = m.h + gap;
  // Allow exactly one horizontal declaration per river, including when it
  // transfers to the next discard after a call.
  const group = RIVER_COLUMNS * (m.w + gap) - gap + m.sideW - m.w;
  const middle = Math.round(width / 2), cy = Math.round(height * .49);
  const gutter = Math.max(6, Math.min(18, Math.floor((width - 3*group) / 36)));
  const strip = 22, hubGuard = Math.max(29, Math.ceil(height * .066));
  const northEnd = cy - hubGuard, southStart = cy + hubGuard + 3;
  const cap = (room: number) => Math.max(1, Math.min(4, Math.floor((room-strip+gap) / step)));
  const n = cap(northEnd - height*.12), s = cap(height*.96 - southStart);
  const sideTop = Math.round(height * .32), side = cap(height*.94-sideTop);
  const place = (center: number, top: number, rows: number) => ({
    x:Math.round(center-group/2), y:Math.round(top), rows,
  });
  return { tier, ...m, group, gap, slots: [
    place(middle,southStart,s), place(middle+group+gutter,sideTop,side),
    place(middle,northEnd - strip - n*step + gap,n), place(middle-group-gutter,sideTop,side),
  ] };
}

/** Widen the wooden frame and relocate the side walls, not the tile geometry. */
export function fieldExtraWidth(width: number, height: number) {
  if (height <= 0) return 0;
  // A similar inset around the felt on a laptop and on a wide desktop monitor.
  return Math.max(1.5, Math.min(14, width / height * 5.9 - 7.1));
}
export function fieldRearExtension(overhead: boolean) { return overhead ? .85 : 1.95; }
