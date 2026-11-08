import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { TableTheme } from './themes';
import { contactTexture, tileSurface } from './tileTextures';

/** Two draw groups: the continuous engraved front and all five ivory sides. */
function createTileBody() {
  const original = new RoundedBoxGeometry(.55, .77, .30, 3, .045);
  const geometry = new THREE.BufferGeometry();
  const front = original.groups[4], others = original.groups.filter((_, index) => index !== 4);
  const groups = [front, ...others];
  for (const name of ['position', 'normal', 'uv']) {
    const attribute = original.getAttribute(name), data = new Float32Array(attribute.array.length);
    let offset = 0;
    for (const group of groups) {
      const slice = attribute.array.slice(group.start * attribute.itemSize, (group.start + group.count) * attribute.itemSize);
      data.set(slice, offset); offset += slice.length;
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(data, attribute.itemSize));
  }
  geometry.addGroup(0, front.count, 1);
  geometry.addGroup(front.count, original.getAttribute('position').count - front.count, 0);
  geometry.translate(0, 0, .035); geometry.computeBoundingSphere(); original.dispose();
  return geometry;
}

export const tileBody = createTileBody();
export const tileBack = new RoundedBoxGeometry(.548, .768, .14, 3, .036);
tileBack.clearGroups(); tileBack.translate(0, 0, -.14);
export const contactPlane = new THREE.PlaneGeometry(1, 1);
/** Flat, bright rim follows the tile face; it never changes a river tile's pose. */
function createTileMatchOutline() {
  const rounded = (path: THREE.Path, width: number, height: number, radius: number) => {
    const x = -width / 2, y = -height / 2;
    path.moveTo(x + radius, y); path.lineTo(x + width - radius, y); path.quadraticCurveTo(x + width, y, x + width, y + radius);
    path.lineTo(x + width, y + height - radius); path.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    path.lineTo(x + radius, y + height); path.quadraticCurveTo(x, y + height, x, y + height - radius);
    path.lineTo(x, y + radius); path.quadraticCurveTo(x, y, x + radius, y);
  };
  const shape = new THREE.Shape(), hole = new THREE.Path();
  rounded(shape, .60, .82, .055); rounded(hole, .52, .74, .025); shape.holes.push(hole);
  return new THREE.ShapeGeometry(shape, 5);
}
export const tileMatchOutline = createTileMatchOutline();
export const tileMatchMaterial = new THREE.MeshBasicMaterial({ color: '#ffe08a', toneMapped: false });
export const tileHoverMaterial = new THREE.MeshBasicMaterial({ color: '#c6e7d8', toneMapped: false });
export const tileDropMaterial = new THREE.MeshBasicMaterial({ color: '#79dfb2', toneMapped: false });
export const handHitGeometry = new THREE.BoxGeometry(1, 1, 1);
export const handHitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false });
export const tableBody = new RoundedBoxGeometry(14.15, .72, 13.55, 3, .19);
export const tableInlay = new RoundedBoxGeometry(13.56, .14, 12.96, 3, .075);
export const tableFelt = new RoundedBoxGeometry(13.36, .12, 12.76, 3, .055);
export const longRail = new RoundedBoxGeometry(13.7, .3, .37, 3, .11);
export const shortRail = new RoundedBoxGeometry(12.93, .3, .37, 3, .11);
export const centerBase = new RoundedBoxGeometry(2.58, .2, 2.58, 3, .07);
for (const geometry of [tableBody, tableInlay, tableFelt, longRail, shortRail, centerBase]) geometry.clearGroups();

const palettes = new Map<string, { ivory: THREE.MeshPhysicalMaterial; back: THREE.MeshPhysicalMaterial; selected: THREE.MeshPhysicalMaterial; marker: THREE.MeshBasicMaterial }>();
const faces = new Map<string, THREE.MeshPhysicalMaterial>();
let contact: THREE.MeshBasicMaterial | undefined;
const restHeights = new Map<string, number>();
const hitBounds = new Map<string, { position: [number, number, number]; size: [number, number, number] }>();

/** Covers both the resting card and its selected lift, while staying in the same slot. */
export function handHitBox(rotation: [number, number, number], scale: number) {
  const key = `${rotation.join(':')}:${scale}`;
  if (!hitBounds.has(key)) {
    const matrix = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)).scale(new THREE.Vector3(scale, scale, scale));
    const bounds = new THREE.Box3(), point = new THREE.Vector3();
    for (const geometry of [tileBody, tileBack]) { const vertices = geometry.getAttribute('position'); for (let i = 0; i < vertices.count; i++) bounds.expandByPoint(point.fromBufferAttribute(vertices, i).applyMatrix4(matrix)); }
    bounds.max.y += .22;
    const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
    center.y += tileRestHeight(rotation, scale);
    hitBounds.set(key, { position: center.toArray() as [number, number, number], size: size.toArray() as [number, number, number] });
  }
  return hitBounds.get(key)!;
}

/** Follow horizontal reordering while keeping the click slot's height and depth fixed. */
export function alignHandHitBox(target: THREE.Object3D, slot: [number, number, number], bounds: ReturnType<typeof handHitBox>, visualX: number) {
  target.position.set(visualX + bounds.position[0], bounds.position[1], slot[2] + bounds.position[2]);
}

/** Rest on the cloth using actual rotated vertices, including the rounded back cap. */
export function tileRestHeight(rotation: [number, number, number], scale: number) {
  const key = `${rotation.join(':')}:${scale}`;
  if (!restHeights.has(key)) {
    const transform = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)), point = new THREE.Vector3();
    let minimum = Infinity;
    for (const geometry of [tileBody, tileBack]) {
      const positions = geometry.getAttribute('position');
      for (let index = 0; index < positions.count; index++) {
        point.fromBufferAttribute(positions, index).applyMatrix4(transform); minimum = Math.min(minimum, point.y);
      }
    }
    restHeights.set(key, .086 - minimum * scale);
  }
  return restHeights.get(key)!;
}

export function tileMaterials(theme: TableTheme, code?: string, faded = false) {
  const key = `${theme.id}:${faded}`;
  if (!palettes.has(key)) {
    const ivory = new THREE.MeshPhysicalMaterial({
      color: faded ? '#c8c4b7' : theme.tileFace, roughness: .27, metalness: 0,
      clearcoat: .48, clearcoatRoughness: .2, ior: 1.48, envMapIntensity: .72,
    });
    const back = new THREE.MeshPhysicalMaterial({ color: theme.tileBack, roughness: .3, metalness: 0, clearcoat: .5, clearcoatRoughness: .23, ior: 1.46, envMapIntensity: .65 });
    const selected = back.clone(); selected.color.set(theme.trim);
    const marker = new THREE.MeshBasicMaterial({ color: theme.ui.accent, transparent: true, opacity: .78, depthWrite: false });
    palettes.set(key, { ivory, back, selected, marker });
  }
  const palette = palettes.get(key)!;
  let face = palette.ivory;
  if (code) {
    const faceKey = `${key}:${code}`;
    if (!faces.has(faceKey)) {
      const surface = tileSurface(code, theme);
      faces.set(faceKey, new THREE.MeshPhysicalMaterial({
        map: surface.map, bumpMap: surface.bump, bumpScale: .009,
        roughnessMap: surface.roughness, roughness: .64,
        color: faded ? '#c3c0b5' : '#ffffff', metalness: 0,
        clearcoat: .26, clearcoatRoughness: .25, ior: 1.48, envMapIntensity: .7,
      }));
    }
    face = faces.get(faceKey)!;
  }
  contact ??= new THREE.MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false, opacity: .65, toneMapped: false });
  return { ...palette, body: [palette.ivory, face], contact };
}
