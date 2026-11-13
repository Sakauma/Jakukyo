import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { DirectionalLight } from 'three';
import { createFrameQualityController, initialTableQuality, TABLE_QUALITY } from './adaptiveQuality';
import type { TableQuality } from './adaptiveQuality';
import type { TableTheme } from './themes';

export function deviceTableQuality(): TableQuality {
  const device = navigator as Navigator & { deviceMemory?: number };
  const compact = window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 1100 && window.innerHeight <= 500;
  return initialTableQuality({ compact, cores: device.hardwareConcurrency, memory: device.deviceMemory });
}

export function AdaptiveTableQuality({ theme }: { theme: TableTheme }) {
  const { gl, setDpr, size } = useThree();
  const [quality, setQuality] = useState(deviceTableQuality);
  const [controller] = useState(() => createFrameQualityController(quality));
  const light = useRef<DirectionalLight>(null);
  const profile = TABLE_QUALITY[quality];
  useEffect(() => {
    controller.reset(performance.now());
    const visibility = () => controller.reset(performance.now());
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, [controller]);
  useEffect(() => { controller.reset(performance.now(), 1800); }, [controller, size.width, size.height]);
  useEffect(() => {
    setDpr(Math.min(window.devicePixelRatio || 1, profile.pixelRatio));
    gl.domElement.dataset.tableQuality = profile.name;
    gl.domElement.dataset.shadowSize = String(profile.shadowSize);
    if (light.current) {
      light.current.shadow.map?.dispose(); light.current.shadow.map = null;
      light.current.shadow.mapPass?.dispose(); light.current.shadow.mapPass = null;
      light.current.shadow.mapSize.set(profile.shadowSize, profile.shadowSize);
      light.current.shadow.needsUpdate = true;
    }
    gl.shadowMap.needsUpdate = true;
  }, [gl, profile, setDpr]);
  useFrame((_, delta) => {
    const next = controller.sample(performance.now(), delta, !document.hidden);
    if (next !== quality) setQuality(next);
  });
  return <directionalLight ref={light} position={[-6.5, 11, 5]} intensity={1.9} color={theme.light} castShadow
    shadow-mapSize={[profile.shadowSize, profile.shadowSize]} shadow-camera-left={-9.5} shadow-camera-right={9.5}
    shadow-camera-top={9.5} shadow-camera-bottom={-9.5} shadow-camera-near={1} shadow-camera-far={32}
    shadow-bias={-.0001} shadow-normalBias={.009} shadow-radius={3} />;
}
