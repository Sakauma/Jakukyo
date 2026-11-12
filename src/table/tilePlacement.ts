export type TileArea = 'hand' | 'river' | 'wall';
export interface TilePlacement { x: number; z: number; yaw: number }

const limits = {
  hand: { chance: .35, x: .004, z: .010, yaw: .45 * Math.PI / 180 },
  river: { chance: .60, x: .007, z: .010, yaw: .90 * Math.PI / 180 },
  wall: { chance: .45, x: .0025, z: .007, yaw: .25 * Math.PI / 180 },
};
const aligned: TilePlacement = { x: 0, z: 0, yaw: 0 };
const mix = (value: number) => {
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  return (value ^ value >>> 16) >>> 0;
};
const signed = (value: number) => mix(value) / 0xffffffff * 2 - 1;

/** Independent display randomness is renewed only when a hand or session changes. */
export const createPlacementSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

/** A stable visual identity retains its small pose through sorting and interaction. */
export function tilePlacement(seed: number, key: string, area: TileArea): TilePlacement {
  let hash = seed;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  hash = mix(hash);
  const limit = limits[area];
  if (hash / 0x100000000 >= limit.chance) return aligned;
  return { x: signed(hash ^ 0x68bc21eb) * limit.x, z: signed(hash ^ 0x02e5be93) * limit.z, yaw: signed(hash ^ 0x967a889b) * limit.yaw };
}
