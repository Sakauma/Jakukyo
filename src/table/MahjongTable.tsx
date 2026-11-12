import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameSnapshot, HandTile } from '../game/types';
import { feltSurface, woodSurface } from './tileTextures';
import { tileBody, tileBack, tileMaterials, tileRestHeight, contactPlane, tileMatchOutline, tileMatchMaterial, tileHoverMaterial, tileDropMaterial, handHitBox, alignHandHitBox, handHitGeometry, handHitMaterial, tableBody, tableInlay, tableFelt, longRail, shortRail, centerBase } from './tableMaterials';
import { getTheme, tableSeat } from './themes';
import type { TableTheme } from './themes';
import type { WinEffect } from '../effects/winEffects';
import { TableCelebration } from '../effects/TableCelebration';
import { riverLayout } from './riverLayout';
import { riichiStickBody, riichiStickLayout } from './riichiStick';
import { bonusPosition, HAND_ROW_Z, seatLayout } from './tableLayout';
import { visibleWallCount, wallTileTransform } from './wallLayout';
import { getRiverMatches, riverSelectionScope } from '../presentation/riverMatches';
import { createHandDragController } from '../presentation/handInteraction';
import type { DiscardAction, DiscardIntent, HandDragContext, HandDragPoint, HandDragPreview } from '../presentation/handInteraction';
export type { DiscardIntent } from '../presentation/handInteraction';
import { bonusMotionKey, createTableMotionController, meldMotionKey, opponentMotionKey, riverMotionKey, stickMotionKey } from './motion/tableMotion';
import type { TileMotion } from './motion/tableMotion';
import { tilePlacement } from './tilePlacement';
import type { TilePlacement } from './tilePlacement';

interface TileProps {
  theme: TableTheme; tile?: string; position: [number, number, number]; rotation?: [number, number, number];
  scale?: number; stackHeight?: number; selected?: boolean; interactive?: boolean; faded?: boolean; animatePosition?: boolean; onClick?: () => void;
  placement?: TilePlacement;
  motion?: TileMotion; reducedMotion?: boolean; matched?: boolean; candidate?: boolean;
  handInput?: { context: HandDragContext | null; onPreview: (preview: HandDragPreview | null) => void;
    onDrop: (preview: HandDragPreview, pose: [number, number, number], rotation: [number, number, number], scale: number) => boolean };
}

const noRaycast = () => {};
function Tile({ theme, tile, position, rotation = [0, 0, 0], scale = 1, stackHeight = 0, selected = false, interactive = false, faded = false, animatePosition = false, onClick, motion, reducedMotion = false, matched = false, candidate = false, handInput, placement }: TileProps) {
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false), [dropValid, setDropValid] = useState(false);
  const [gesture] = useState(() => createHandDragController(HAND_ROW_Z - .60));
  const drag = useRef<HandDragPreview | null>(null), released = useRef<[number, number, number] | null>(null);
  const captured = useRef<{ pointerId: number; target: { releasePointerCapture: (id: number) => void } } | null>(null);
  const capturedWatch = useRef<{ cleanup: () => void } | null>(null);
  const fallbackTap = useRef<{ cleanup: () => void } | null>(null);
  const suppressClick = useRef(false);
  const materials = useMemo(() => tileMaterials(theme, tile, faded), [tile, theme, faded]);
  const lying = Math.abs(rotation[0]) > 1;
  const restY = tileRestHeight(rotation, scale) + stackHeight;
  const ref = useRef<THREE.Group>(null);
  const positionRef = useRef<THREE.Group>(null);
  const hitRef = useRef<THREE.Mesh>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const initialPosition = useRef<[number, number, number]>([motion?.from[0] ?? position[0], 0, motion?.from[2] ?? position[2]]);
  const targetRotation = useMemo(() => new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), [rotation[0], rotation[1], rotation[2]]);
  const fromRotation = useMemo(() => new THREE.Quaternion().setFromEuler(new THREE.Euler(...(motion?.rotation ?? rotation))), [motion?.id]);
  const hit = handInput ? handHitBox(rotation, scale) : null;
  const dragKey = handInput?.context ? JSON.stringify(handInput.context) : '';
  const pointerPoint = (event: ThreeEvent<PointerEvent>): HandDragPoint | null => {
    const point = event.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(restY + .8)), new THREE.Vector3());
    return point ? { clientX: event.clientX, clientY: event.clientY, x: point.x, z: point.z } : null;
  };
  const releaseCapture = () => {
    const capture = captured.current; captured.current = null;
    try { capture?.target.releasePointerCapture(capture.pointerId); } catch { /* Capture may already be lost. */ }
  };
  const stopCapturedWatch = () => { capturedWatch.current?.cleanup(); capturedWatch.current = null; };
  const stopFallbackTap = (suppress: boolean) => {
    const fallback = fallbackTap.current; fallbackTap.current = null;
    if (fallback) { fallback.cleanup(); if (suppress) suppressClick.current = true; }
  };
  const beginFallbackTap = (pointerId: number, clientX: number, clientY: number) => {
    // Without pointer capture, retain taps but never turn an interrupted drag into a click.
    gesture.cancel();
    let moved = false;
    const move = (event: PointerEvent) => {
      if (event.pointerId === pointerId && Math.hypot(event.clientX - clientX, event.clientY - clientY) >= 8) moved = true;
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId === pointerId) stopFallbackTap(moved || Math.hypot(event.clientX - clientX, event.clientY - clientY) >= 8);
    };
    const cancel = (event: PointerEvent) => { if (event.pointerId === pointerId) stopFallbackTap(true); };
    const blur = () => stopFallbackTap(true);
    const cleanup = () => {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true); window.removeEventListener('blur', blur);
    };
    fallbackTap.current = { cleanup };
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true); window.addEventListener('blur', blur);
  };
  const cancelGesture = () => {
    if (gesture.isActive() || drag.current) suppressClick.current = true;
    stopFallbackTap(true); stopCapturedWatch(); gesture.cancel(); drag.current = null; setDragging(false); setDropValid(false); handInput?.onPreview(null); releaseCapture();
  };
  const watchCapture = (pointerId: number) => {
    let lostFrame: number | null = null;
    const cancel = (event: PointerEvent) => { if (event.pointerId === pointerId) cancelGesture(); };
    const lost = (event: PointerEvent) => {
      if (event.pointerId !== pointerId || lostFrame !== null) return;
      // Some browsers send this before pointerup; allow that event to finish first.
      lostFrame = requestAnimationFrame(() => { lostFrame = null; if (gesture.isActive()) cancelGesture(); });
    };
    const blur = () => cancelGesture();
    const cleanup = () => {
      window.removeEventListener('pointercancel', cancel, true); window.removeEventListener('lostpointercapture', lost, true);
      window.removeEventListener('blur', blur); if (lostFrame !== null) cancelAnimationFrame(lostFrame);
    };
    capturedWatch.current = { cleanup };
    window.addEventListener('pointercancel', cancel, true); window.addEventListener('lostpointercapture', lost, true);
    window.addEventListener('blur', blur);
  };
  useLayoutEffect(() => { cancelGesture(); if (!interactive) setHover(false); }, [dragKey, interactive]);
  useEffect(() => {
    if (!interactive || (!hover && !dragging)) return;
    document.body.style.cursor = dragging ? 'grabbing' : handInput?.context ? 'grab' : 'pointer';
    return () => { document.body.style.cursor = 'default'; };
  }, [hover, dragging, interactive, !!handInput?.context]);
  useEffect(() => {
    const hide = () => { if (document.hidden) cancelGesture(); };
    if (handInput) document.addEventListener('visibilitychange', hide);
    return () => { stopFallbackTap(true); stopCapturedWatch(); gesture.cancel(); handInput?.onPreview(null); releaseCapture(); document.removeEventListener('visibilitychange', hide); };
  }, []);
  useLayoutEffect(() => {
    if (!ref.current || !positionRef.current) return;
    if (motion && !motion.cancelled && !reducedMotion && performance.now() - motion.started < motion.duration) {
      positionRef.current.position.set(motion.from[0], 0, motion.from[2]);
      ref.current.position.y = motion.from[1]; ref.current.quaternion.copy(fromRotation); ref.current.scale.setScalar(motion.scale);
    } else {
      if (reducedMotion) positionRef.current.position.set(position[0], 0, position[2]);
      ref.current.quaternion.copy(targetRotation); ref.current.scale.setScalar(scale);
    }
  }, [motion?.id, reducedMotion]);
  useFrame((_, delta) => {
    if (!ref.current || !positionRef.current) return;
    const carried = drag.current?.dragging ? [drag.current.position[0], restY + .8, drag.current.position[1]] : released.current;
    const elapsed = motion ? performance.now() - motion.started : Infinity;
    const moving = !!motion && !motion.cancelled && !reducedMotion && !document.hidden && elapsed < motion.duration;
    if (carried) {
      positionRef.current.position.set(carried[0], 0, carried[2] - HAND_ROW_Z);
      ref.current.position.y = reducedMotion ? carried[1] : THREE.MathUtils.damp(ref.current.position.y, carried[1], 28, delta);
      ref.current.quaternion.copy(targetRotation); ref.current.scale.setScalar(scale);
    } else if (moving) {
      const progress = Math.max(0, Math.min(1, elapsed / motion.duration));
      const eased = progress * progress * (3 - 2 * progress);
      positionRef.current.position.set(THREE.MathUtils.lerp(motion.from[0], position[0], eased), 0, THREE.MathUtils.lerp(motion.from[2], position[2], eased));
      ref.current.position.y = THREE.MathUtils.lerp(motion.from[1], restY, eased) + Math.sin(Math.PI * progress) * motion.arc;
      ref.current.quaternion.slerpQuaternions(fromRotation, targetRotation, eased);
      ref.current.scale.setScalar(THREE.MathUtils.lerp(motion.scale, scale, eased));
    } else {
      const smooth = animatePosition && !motion && !reducedMotion && !document.hidden;
      positionRef.current.position.x = smooth ? THREE.MathUtils.damp(positionRef.current.position.x, position[0], 24, delta) : position[0];
      positionRef.current.position.z = smooth ? THREE.MathUtils.damp(positionRef.current.position.z, position[2], 24, delta) : position[2];
      const targetY = restY + (selected ? .22 : hover && interactive ? .1 : 0);
      ref.current.position.y = reducedMotion || motion ? targetY : THREE.MathUtils.damp(ref.current.position.y, targetY, 22, delta);
      ref.current.quaternion.slerp(targetRotation, reducedMotion ? 1 : 1 - Math.exp(-delta * 24));
      ref.current.scale.setScalar(scale);
    }
    if (hitRef.current && hit) alignHandHitBox(hitRef.current, position, hit, !moving && !carried ? positionRef.current.position.x : position[0]);
    if (shadow.current) shadow.current.scale.set(.82 * scale, (lying ? 1.02 : .5) * scale, 1);
  });
  return <group dispose={null}><group ref={positionRef} position={initialPosition.current}>
    <group position={[placement?.x ?? 0, 0, placement?.z ?? 0]} rotation={[0, placement?.yaw ?? 0, 0]}>
    {stackHeight === 0 && <mesh ref={shadow} position={[0, .09, .02]} rotation={[-Math.PI / 2, 0, rotation[2]]} scale={[.82 * scale, (lying ? 1.02 : .5) * scale, 1]} geometry={contactPlane} material={materials.contact} />}
    <group ref={ref} position={[0, restY, 0]} scale={scale}>
    <mesh geometry={tileBack} material={selected ? materials.selected : materials.back} castShadow receiveShadow />
    <mesh geometry={tileBody} material={materials.body} castShadow receiveShadow />
    {(matched || selected || hover && interactive || dragging) && <mesh position={[0, 0, .191]} geometry={tileMatchOutline} material={dragging && dropValid ? tileDropMaterial : selected || matched || dragging ? tileMatchMaterial : tileHoverMaterial} raycast={noRaycast} />}
    </group>
    {(selected || candidate) && <mesh position={[0, .092, .27]} rotation={[-Math.PI / 2, 0, 0]} scale={[.57 * scale, selected ? .11 : .05, 1]} geometry={contactPlane} material={materials.marker} raycast={noRaycast} />}
    </group>
    </group>
    {interactive && hit && <mesh ref={hitRef} position={[position[0] + hit.position[0], hit.position[1], position[2] + hit.position[2]]} scale={[hit.size[0] + .02, hit.size[1], hit.size[2] + .03]} geometry={handHitGeometry} material={handHitMaterial}
      onClick={event => { event.stopPropagation(); if (suppressClick.current) { suppressClick.current = false; return; } onClick?.(); }}
      onPointerOver={event => { event.stopPropagation(); setHover(true); }}
      onPointerOut={() => { if (!gesture.isActive()) setHover(false); }}
      onPointerDown={event => {
        if (event.button !== 0 || event.isPrimary === false) return; event.stopPropagation(); stopFallbackTap(true); suppressClick.current = false;
        if (gesture.begin(event.pointerId, pointerPoint(event), [position[0], position[2] + HAND_ROW_Z], handInput?.context ?? null)) {
          const target = event.target as (EventTarget & { setPointerCapture?: (id: number) => void; releasePointerCapture?: (id: number) => void }) | null;
          if (target && typeof target.setPointerCapture === 'function' && typeof target.releasePointerCapture === 'function') {
            try {
              target.setPointerCapture(event.pointerId); captured.current = { pointerId: event.pointerId, target: { releasePointerCapture: target.releasePointerCapture.bind(target) } };
              watchCapture(event.pointerId);
            } catch {
              // R3F can register its capture before the underlying DOM call throws.
              try { target.releasePointerCapture(event.pointerId); } catch { /* Already released or unavailable. */ }
              beginFallbackTap(event.pointerId, event.clientX, event.clientY);
            }
          } else beginFallbackTap(event.pointerId, event.clientX, event.clientY);
        }
      }}
      onPointerMove={event => {
        if (!gesture.isActive()) return; event.stopPropagation();
        const preview = gesture.move(event.pointerId, pointerPoint(event), handInput?.context ?? null);
        if (!preview) { cancelGesture(); return; }
        drag.current = preview.dragging ? preview : null; setDragging(preview.dragging); setDropValid(preview.valid); handInput?.onPreview(drag.current);
      }}
      onPointerUp={event => {
        if (!gesture.isActive()) return; event.stopPropagation();
        const result = gesture.finish(event.pointerId, pointerPoint(event), handInput?.context ?? null);
        suppressClick.current = result.kind !== 'tap'; stopCapturedWatch(); drag.current = null; setDragging(false); setDropValid(false); handInput?.onPreview(null); releaseCapture();
        if (result.kind !== 'tap') setHover(false);
        if (result.kind === 'commit') {
          const pose: [number, number, number] = [result.preview.position[0], restY + .8, result.preview.position[1]];
          if (handInput?.onDrop(result.preview, pose, rotation, scale)) released.current = pose;
        }
      }}
      onPointerCancel={() => { cancelGesture(); setHover(false); }}
      onLostPointerCapture={() => { if (gesture.isActive()) { cancelGesture(); setHover(false); } }} />}
  </group>;
}

function RiichiStick({ motion, reduced }: { motion?: TileMotion; reduced: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const { position, size, dotRadius } = riichiStickLayout;
  useFrame(() => {
    if (!ref.current) return;
    const p = motion && !motion.cancelled && !reduced && !document.hidden ? Math.min(1, Math.max(0, (performance.now() - motion.started) / motion.duration)) : 1;
    const eased = p * p * (3 - 2 * p);
    ref.current.position.set(THREE.MathUtils.lerp(motion?.from[0] ?? position[0], position[0], eased), THREE.MathUtils.lerp(motion?.from[1] ?? position[1], position[1], eased) + Math.sin(p * Math.PI) * (motion?.arc ?? 0), THREE.MathUtils.lerp(motion?.from[2] ?? position[2], position[2], eased));
    ref.current.rotation.y = (1 - eased) * (motion?.rotation[1] ?? 0);
  });
  return <group ref={ref} position={position}>
    <mesh castShadow receiveShadow><primitive object={riichiStickBody} attach="geometry" dispose={null} /><meshPhysicalMaterial color="#fff9eb" roughness={.33} clearcoat={.24} clearcoatRoughness={.3} /></mesh>
    <mesh position={[0, size[1] / 2 + .0015, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[dotRadius, 32]} /><meshStandardMaterial color="#c52225" roughness={.55} /></mesh>
  </group>;
}

function DropTarget({ preview, position, rotation }: { preview: { current: HandDragPreview | null }; position: [number, number, number]; rotation: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => { if (ref.current) ref.current.visible = !!preview.current?.dragging && preview.current.valid; });
  return <mesh ref={ref} visible={false} position={[position[0], .382, position[2]]} rotation={rotation} scale={.72} geometry={tileMatchOutline} material={tileDropMaterial} raycast={noRaycast} dispose={null} />;
}

function Center({ snapshot, theme, playerCount }: { snapshot: GameSnapshot | null; theme: TableTheme; playerCount: number }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = theme.ui.panel; ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = theme.trim; ctx.lineWidth = 3; ctx.strokeRect(17, 17, 478, 478);
    ctx.globalAlpha = .35; ctx.lineWidth = 1; ctx.strokeRect(27, 27, 458, 458); ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.ui.text; ctx.font = 'bold 76px "Microsoft YaHei",sans-serif';
    ctx.fillText(snapshot ? `${snapshot.round.wind} ${snapshot.round.hand} 局` : '雀 境', 256, 174);
    ctx.fillStyle = theme.ui.accent; ctx.font = '31px "Microsoft YaHei",sans-serif';
    ctx.fillText(snapshot ? `余 ${snapshot.round.tilesLeft} 枚` : 'M A H J O N G', 256, 269);
    ctx.font = '24px "Microsoft YaHei",sans-serif'; ctx.fillStyle = theme.ui.muted;
    const details = !snapshot?.mode || ['riichi', 'sanma'].includes(snapshot.mode)
      ? `${snapshot?.round.honba ?? 0} 本场 · 供托 ${snapshot?.round.riichiSticks ?? 0}` : snapshot.modeName ?? '自在一局';
    ctx.fillText(snapshot ? details : theme.name, 256, 339);
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  }, [snapshot?.round.wind, snapshot?.round.hand, snapshot?.round.tilesLeft, snapshot?.round.honba, snapshot?.round.riichiSticks, snapshot?.mode, snapshot?.modeName, theme]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <group scale={.88}>
    <mesh position={[0, .08, 0]} geometry={centerBase} dispose={null} receiveShadow><meshPhysicalMaterial color={theme.rail} roughness={.33} clearcoat={.25} /></mesh>
    <mesh position={[0, .192, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[2.45, 2.45]} /><meshStandardMaterial map={texture} roughness={.7} /></mesh>
    {Array.from({ length: playerCount }, (_, id) => {
      const theta = tableSeat(id, playerCount) * Math.PI / 2;
      return <mesh key={id} position={[Math.sin(theta) * 1.35, .11, Math.cos(theta) * 1.35]} rotation={[0, theta, 0]}>
        <boxGeometry args={[.55, .05, .065]} /><meshStandardMaterial color={snapshot?.turn === id ? theme.trim : theme.tileBack} emissive={snapshot?.turn === id ? theme.trim : '#000'} emissiveIntensity={.45} />
      </mesh>;
    })}
  </group>;
}

function Walls({ remaining, theme, reserve, indicators, placementSeed }: { remaining: number; theme: TableTheme; reserve: number; indicators: string[]; placementSeed: number }) {
  const tiles = useMemo(() => Array.from({ length: visibleWallCount(remaining, reserve) }, (_, index) => wallTileTransform(index, indicators)), [remaining, reserve, indicators]);
  return <group>{tiles.map((tile, i) => <Tile theme={theme} key={i} {...tile} placement={tilePlacement(placementSeed, `wall:${Math.floor(i / 2)}`, 'wall')} />)}</group>;
}

const previewHand = ['m2', 'm3', 'm4', 'm6', 'm7', 'm8', 'p2', 'p2', 'p3', 'p4', 'p5', 's3', 's4', 's5'];
interface SceneProps {
  snapshot: GameSnapshot | null; selectedId: string | null; selectedIds?: string[]; interactiveIds?: string[];
  sessionIdentity?: object | null;
  displayHand?: HandTile[];
  onSelect: (tile: HandTile) => void; view: 'perspective' | 'overhead'; theme: TableTheme; previewPlayerCount?: number;
  celebration?: WinEffect | null;
  reducedMotion?: boolean;
  highlightedTile?: string | null;
  discardAction?: DiscardAction | null;
  discardIntent?: DiscardIntent | null;
  onTileDiscard?: (tileId: string, selectionScope: string, action: DiscardAction) => boolean;
}

/** A generated indoor softbox environment, with no HDR file or network request. */
function StudioEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const room = new RoomEnvironment(), generator = new THREE.PMREMGenerator(gl);
    const environment = generator.fromScene(room, .025, .1, 100);
    const previous = scene.environment;
    scene.environment = environment.texture; scene.environmentIntensity = .32;
    room.dispose(); generator.dispose();
    return () => { scene.environment = previous; environment.dispose(); };
  }, [gl, scene]);
  return null;
}

function Scene({ snapshot, selectedId, selectedIds = [], interactiveIds, displayHand, onSelect, view, theme, previewPlayerCount = 4, celebration, reducedMotion = false, highlightedTile = null, discardAction = null, discardIntent = null, onTileDiscard, sessionIdentity }: SceneProps) {
  const { camera, gl } = useThree();
  const felt = useMemo(() => feltSurface(theme), [theme]);
  const wood = useMemo(() => woodSurface(theme), [theme]);
  useEffect(() => { gl.toneMappingExposure = theme.exposure; }, [gl, theme.exposure]);
  const desired = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, delta) => {
    desired.set(0, view === 'overhead' ? 19.8 : 9, view === 'overhead' ? 6.9 : 11.8);
    camera.position.lerp(desired, reducedMotion ? 1 : 1 - Math.exp(-delta * 3)); camera.lookAt(0, 0, view === 'overhead' ? .65 : 1.2);
  });
  const playerCount = snapshot?.players.length ?? previewPlayerCount;
  const human = snapshot?.players.find(player => player.isHuman);
  const sampleHand = playerCount === 3 ? ['m1', 'm9', 'p2', 'p3', 'p4', 'p6', 'p7', 'p8', 's3', 's4', 's5', 'z4', 'z5', 'z5'] : previewHand;
  const ownHand = displayHand ?? human?.hand ?? sampleHand.map((tile, i) => ({ id: String(i), tile, label: '', drawn: i === 13 }));
  const [motionController] = useState(createTableMotionController);
  const dragPreview = useRef<HandDragPreview | null>(null);
  useEffect(() => {
    const visibility = () => motionController.cancel();
    document.addEventListener('visibilitychange', visibility);
    return () => { document.removeEventListener('visibilitychange', visibility); motionController.cancel(); };
  }, [motionController]);
  const motionFrame = motionController.update(snapshot, ownHand, selectedId, reducedMotion, discardIntent, sessionIdentity);
  const legalIds = new Set(interactiveIds ?? snapshot?.actions.filter(action => ['discard', 'riichi', 'exchange'].includes(action.type)).map(action => action.tileId));
  const restricted = legalIds.size > 0 && ownHand.some(tile => !legalIds.has(tile.id));
  const selectionScope = snapshot ? riverSelectionScope(snapshot) : '';
  const legalKey = JSON.stringify(snapshot?.actions.filter(action => action.type === discardAction).map(action => [action.id, action.tileId]) ?? []);
  const dropTarget = human && riverLayout([...human.discards, { tile: 'm1', called: false, riichi: discardAction === 'riichi', tsumogiri: false }]).items.at(-1);
  const seats = snapshot?.players ?? Array.from({ length: playerCount }, (_, id) => ({ id, concealedCount: 13, revealedHand: undefined, melds: [] }));
  const reserve = !snapshot?.mode || ['riichi', 'sanma'].includes(snapshot.mode) ? 14 : 0;
  const riverMatches = getRiverMatches(snapshot?.players ?? [], highlightedTile, snapshot ?? undefined);
  return <>
    <StudioEnvironment />
    <color attach="background" args={[theme.background]} /><fog attach="fog" args={[theme.background, 28, 54]} />
    <ambientLight intensity={theme.id === 'contrast' ? .22 : .07} /><hemisphereLight args={[theme.light, '#17251f', .25]} />
    <directionalLight position={[-6.5, 11, 5]} intensity={1.9} color={theme.light} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-9.5} shadow-camera-right={9.5} shadow-camera-top={9.5} shadow-camera-bottom={-9.5} shadow-camera-near={1} shadow-camera-far={32} shadow-bias={-.0001} shadow-normalBias={.009} shadow-radius={3} />
    <directionalLight position={[5, 6, -5]} intensity={.34} color={theme.fillLight} />
    <mesh position={[0, -.92, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[100, 100]} /><meshStandardMaterial color={theme.background} roughness={.95} /></mesh>
    <mesh position={[0, -.39, 0]} geometry={tableBody} dispose={null} receiveShadow castShadow><meshPhysicalMaterial map={wood.map} bumpMap={wood.bump} bumpScale={.009} roughness={.36} clearcoat={.24} clearcoatRoughness={.36} /></mesh>
    <mesh position={[0, -.05, 0]} geometry={tableInlay} dispose={null} receiveShadow><meshStandardMaterial color={theme.trim} roughness={.32} metalness={.68} /></mesh>
    <mesh position={[0, .025, 0]} geometry={tableFelt} dispose={null} receiveShadow><meshStandardMaterial map={felt.map} bumpMap={felt.bump} bumpScale={.013} roughness={.97} envMapIntensity={.22} /></mesh>
    {[-6.82, 6.82].map(x => <mesh key={x} position={[x, .025, 0]} rotation={[0, Math.PI / 2, 0]} geometry={shortRail} dispose={null} castShadow receiveShadow><meshPhysicalMaterial map={wood.map} bumpMap={wood.bump} bumpScale={.008} roughness={.33} clearcoat={.32} clearcoatRoughness={.34} /></mesh>)}
    {[-6.59, 6.59].map(z => <mesh key={z} position={[0, .025, z]} geometry={longRail} dispose={null} castShadow receiveShadow><meshPhysicalMaterial map={wood.map} bumpMap={wood.bump} bumpScale={.008} roughness={.33} clearcoat={.32} clearcoatRoughness={.34} /></mesh>)}
    <Center snapshot={snapshot} theme={theme} playerCount={playerCount} /><Walls remaining={snapshot?.round.tilesLeft ?? 70} theme={theme} reserve={reserve} indicators={snapshot?.round.doraIndicators ?? ['p4']} placementSeed={motionFrame.placementSeed} />
    {celebration && <TableCelebration key={celebration.id} effect={celebration} theme={theme} />}
    <group key={`hand-${motionFrame.identity}`} position={[0, 0, HAND_ROW_Z]}>
      {motionFrame.hand.map(({ key, tile, position, scale }) => <Tile key={key} theme={theme} tile={tile.tile} position={position} rotation={[-.31, 0, 0]} scale={scale} animatePosition motion={motionFrame.motions.get(key)} reducedMotion={reducedMotion} selected={selectedId === tile.id || selectedIds.includes(tile.id)} interactive={!!snapshot && legalIds.has(tile.id)} faded={restricted && !legalIds.has(tile.id)} candidate={restricted && legalIds.has(tile.id)} onClick={() => onSelect(tile)} placement={tilePlacement(motionFrame.placementSeed, key, 'hand')}
        handInput={{ context: snapshot && discardAction && onTileDiscard && legalIds.has(tile.id) ? { tileId: tile.id, selectionScope, action: discardAction, legalKey } : null,
          onPreview: preview => { dragPreview.current = preview; },
          onDrop: (preview, pose, rotation) => {
            motionController.captureReleaseOrigin(preview.context.tileId, preview.context.selectionScope, pose, rotation);
            const accepted = onTileDiscard?.(preview.context.tileId, preview.context.selectionScope, preview.context.action) ?? false;
            if (!accepted) motionController.clearReleaseOrigin(); return accepted;
          } }} />)}
    </group>
    {dropTarget && <DropTarget preview={dragPreview} position={dropTarget.position} rotation={dropTarget.rotation} />}
    {seats.filter(player => player.id !== 0).map(player => {
      const layout = seatLayout(Array.from({ length: player.revealedHand?.length ?? player.concealedCount }, () => ({ drawn: false })), player.melds, false, (snapshot?.handSize ?? 13) > 14);
      return <group key={`${motionFrame.identity}-opponent-${player.id}`} rotation={[0, tableSeat(player.id, playerCount) * Math.PI / 2, 0]}>
        {layout.hand.map((slot, i) => <Tile theme={theme} key={i} tile={player.revealedHand?.[i]} position={[slot.position[0], 0, HAND_ROW_Z]} rotation={player.revealedHand ? [-Math.PI / 2, 0, 0] : [-.09, 0, Math.PI]} scale={slot.scale} animatePosition motion={motionFrame.motions.get(opponentMotionKey(player.id, i))} reducedMotion={reducedMotion} placement={tilePlacement(motionFrame.placementSeed, opponentMotionKey(player.id, i), 'hand')} />)}
      </group>;
    })}
    {(snapshot?.players ?? []).map(player => <group key={`${motionFrame.identity}-public-${player.id}`} rotation={[0, tableSeat(player.id, playerCount) * Math.PI / 2, 0]}>
      {riverLayout(player.discards).items.map(discard => <Tile key={discard.sourceIndex} theme={theme} tile={discard.tile} position={discard.position} rotation={discard.rotation} scale={discard.scale} faded={discard.tsumogiri} matched={riverMatches.byPlayer.find(matches => matches.playerId === player.id)?.pageIndices.includes(discard.sourceIndex)} animatePosition motion={motionFrame.motions.get(riverMotionKey(player.id, discard.sourceIndex))} reducedMotion={reducedMotion} placement={tilePlacement(motionFrame.placementSeed, riverMotionKey(player.id, discard.sourceIndex), 'river')} />)}
      {seatLayout(player.id === 0 ? ownHand : Array.from({ length: player.revealedHand?.length ?? player.concealedCount }, () => ({ drawn: false })), player.melds, player.id === 0, (snapshot?.handSize ?? 13) > 14, !!snapshot?.hideOpponentConcealedKongs && player.id !== snapshot.humanId).melds.map(tile => <Tile key={tile.key} theme={theme} tile={tile.tile} position={tile.position} rotation={tile.rotation} scale={tile.scale} matched={!!tile.tile && !!riverMatches.byPlayer.find(matches => matches.playerId === player.id)?.meldIndices.some(index => index.meldIndex === tile.meldIndex && index.tileIndex === tile.tileIndex)} animatePosition motion={motionFrame.motions.get(meldMotionKey(player.id, tile.meldIndex, tile.tileIndex))} reducedMotion={reducedMotion} />)}
      {Array.from({ length: player.kita ?? 0 }, (_, i) => <Tile key={`bonus-${i}`} theme={theme} tile="z4" position={bonusPosition(i)} rotation={[-Math.PI / 2, 0, 0]} scale={.58} motion={motionFrame.motions.get(bonusMotionKey(player.id, (player.flowers?.length ?? 0) + i))} reducedMotion={reducedMotion} />)}
      {player.riichi && <RiichiStick motion={motionFrame.motions.get(stickMotionKey(player.id))} reduced={reducedMotion} />}
    </group>)}
  </>;
}

function ContextMonitor({ onFailure, onRestore }: { onFailure: () => void; onRestore?: () => void }) {
  const { gl } = useThree();
  const callback = useRef(onFailure); callback.current = onFailure;
  const restored = useRef(onRestore); restored.current = onRestore;
  useEffect(() => {
    const lost = (event: Event) => { event.preventDefault(); callback.current(); };
    const recovered = () => restored.current?.();
    gl.domElement.addEventListener('webglcontextlost', lost); gl.domElement.addEventListener('webglcontextrestored', recovered);
    return () => { gl.domElement.removeEventListener('webglcontextlost', lost); gl.domElement.removeEventListener('webglcontextrestored', recovered); };
  }, [gl]);
  return null;
}

export default function MahjongTable(props: Omit<SceneProps, 'theme'> & { theme?: TableTheme; onFailure: () => void; onRestore?: () => void }) {
  const theme = props.theme ?? getTheme();
  return <Canvas style={{ touchAction: 'none' }} shadows="soft" camera={{ position: [0, 9, 11.8], fov: 43, near: .1, far: 100 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }} onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = theme.exposure; }} fallback={<div className="webgl-fallback">当前浏览器无法创建 WebGL 3D 场景，请使用启用硬件加速的 Edge 或 Chrome。</div>}>
    <ContextMonitor onFailure={props.onFailure} onRestore={props.onRestore} /><Suspense fallback={null}><Scene {...props} theme={theme} /></Suspense>
  </Canvas>;
}
