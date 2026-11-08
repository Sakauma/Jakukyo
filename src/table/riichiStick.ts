import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// The inner gap is clear of both the scaled center markers and the first river row.
// Coordinates are local to a player's rotated seat, including restored/replay states.
const position: [number, number, number] = [0, .125, 1.40];
export const riichiStickLayout = {
  position,
  from: [position[0] + .2, position[1] + .305, position[2] + .45] as [number, number, number],
  size: [1.60, .075, .22] as [number, number, number],
  dotRadius: .072,
};

export const riichiStickBody = new RoundedBoxGeometry(...riichiStickLayout.size, 3, .018);
riichiStickBody.clearGroups();
