import * as THREE from 'three';
import { tileRestHeight } from './tableMaterials';

export const WALL_LAYOUT = { radius: 4.52, tilt: 4 * Math.PI / 180, offset: -.60, scale: .96 };
export interface WallTileTransform {
  tile?: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  stackHeight: number;
}

export const visibleWallCount = (remaining: number, reserve: number) => Math.max(reserve, Math.min(112, remaining + reserve));

/** One mildly skewed, offset wall transform shared by the table and draw origins. */
export function wallTileTransform(index: number, indicators: readonly string[] = []): WallTileTransform {
  const side = Math.floor(index / 34), stack = Math.floor((index % 34) / 2), layer = index % 2;
  const base = (2 - side) * Math.PI / 2, yaw = base + WALL_LAYOUT.tilt;
  const along = -(stack - 8) * .575 * WALL_LAYOUT.scale + WALL_LAYOUT.offset;
  const x = along * Math.cos(WALL_LAYOUT.tilt), z = WALL_LAYOUT.radius - along * Math.sin(WALL_LAYOUT.tilt);
  const tile = side === 0 && layer === 1 ? indicators[stack] : undefined;
  const rotation: [number, number, number] = [tile ? -Math.PI / 2 : Math.PI / 2, 0, tile ? yaw : -yaw];
  const stackHeight = layer * .395 * WALL_LAYOUT.scale;
  return { tile, rotation, scale: WALL_LAYOUT.scale, stackHeight,
    position: [Math.cos(base) * x + Math.sin(base) * z, tileRestHeight(rotation, WALL_LAYOUT.scale) + stackHeight, -Math.sin(base) * x + Math.cos(base) * z] };
}

/** Convert a world-space wall tile into the destination player's local seat. */
export function wallTileInSeat(tile: WallTileTransform, angle: number) {
  const transform = new THREE.Matrix4().makeRotationY(-angle);
  const position = new THREE.Vector3(...tile.position).applyMatrix4(transform);
  const rotation = new THREE.Euler().setFromRotationMatrix(transform.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...tile.rotation))));
  return { position: position.toArray() as [number, number, number], rotation: [rotation.x, rotation.y, rotation.z] as [number, number, number], scale: tile.scale };
}
