import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WinEffect } from './winEffects';
import type { TableTheme } from '../table/themes';

/** Original geometric sparks and a ring live in the real 3D table scene. */
export function TableCelebration({ effect, theme }: { effect: WinEffect; theme: TableTheme }) {
  const sparks = useRef<THREE.InstancedMesh>(null), ring = useRef<THREE.Mesh>(null), elapsed = useRef(0);
  const transform = useMemo(() => new THREE.Object3D(), []);
  const count = effect.tier === 3 ? 90 : effect.tier === 2 ? 62 : 40;
  const particles = useMemo(() => Array.from({ length: count }, (_, index) => ({
    angle: index * 2.399963, radius: .6 + ((index * 37) % 100) / 22,
    speed: .8 + ((index * 17) % 100) / 70, offset: ((index * 13) % 30) / 30,
  })), [count]);
  useFrame((_, delta) => {
    elapsed.current += delta;
    const time = elapsed.current, fade = Math.max(0, 1 - time / 2.8);
    if (sparks.current) {
      particles.forEach((particle, index) => {
        const progress = Math.max(0, time - particle.offset * .4), angle = particle.angle + progress * .32;
        const radius = particle.radius * (.4 + progress * .32);
        transform.position.set(Math.cos(angle) * radius, .4 + progress * particle.speed - .25 * progress * progress, Math.sin(angle) * radius);
        transform.rotation.set(progress * 1.2, angle, progress * .8);
        transform.scale.setScalar((.055 + (index % 3) * .025) * Math.min(1, time * 5) * fade);
        transform.updateMatrix(); sparks.current!.setMatrixAt(index, transform.matrix);
      });
      sparks.current.instanceMatrix.needsUpdate = true;
    }
    if (ring.current) {
      ring.current.scale.setScalar(.5 + Math.min(2.6, time * 1.1));
      (ring.current.material as THREE.MeshBasicMaterial).opacity = .3 * fade;
    }
  });
  return <group>
    <instancedMesh ref={sparks} args={[undefined, undefined, count]} frustumCulled={false}><octahedronGeometry args={[1, 0]} /><meshStandardMaterial color={theme.ui.accent} emissive={theme.ui.accent} emissiveIntensity={1.2} roughness={.3} /></instancedMesh>
    <mesh ref={ring} position={[0, .22, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[1.5, 1.56, 96]} /><meshBasicMaterial color={theme.ui.accent} transparent opacity={.3} depthWrite={false} side={THREE.DoubleSide} /></mesh>
  </group>;
}
