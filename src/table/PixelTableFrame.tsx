import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { tileSymbol } from './tileArt';
import type { TableTheme } from './themes';

/** Four authored 448×256 print blocks. Lighting must not wash the ink colors
 * together; a separate, faint shadow pass grounds the physical walls. */
export function PixelTableFrame({ theme }: { theme: TableTheme }) {
  const map = useMemo(() => {
    const ink = new THREE.Texture(tileSymbol('board-'+theme.id));
    ink.colorSpace = THREE.SRGBColorSpace;
    ink.magFilter = THREE.NearestFilter; ink.minFilter = THREE.NearestMipmapNearestFilter;
    ink.needsUpdate = true; return ink;
  }, [theme.id]);
  useEffect(() => () => map.dispose(), [map]);
  return <group>
    <mesh position={[0,-.44,0]}><boxGeometry args={[14.15,.66,13.55]} /><meshBasicMaterial color={theme.background} /></mesh>
    <mesh position={[0,-.12,0]}><boxGeometry args={[14.17,.065,13.57]} /><meshBasicMaterial color={theme.trim} /></mesh>
    <mesh position={[0,-.012,0]}><boxGeometry args={[14.15,.19,13.55]} /><meshBasicMaterial color={theme.rail} /></mesh>
    <mesh position={[0,.085,0]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[14.15,13.55]} /><meshBasicMaterial map={map} toneMapped={false} /></mesh>
    <mesh position={[0,.086,0]} rotation={[-Math.PI/2,0,0]} receiveShadow><planeGeometry args={[14.15,13.55]} /><shadowMaterial opacity={.19} depthWrite={false} /></mesh>
  </group>;
}
