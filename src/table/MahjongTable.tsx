import { createContext, Suspense, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameSnapshot, HandTile, MeldView } from '../game/types';
import { feltSurface, woodSurface } from './tileTextures';
import { tileBody, tileBack, tileMaterials, tileRestHeight, contactPlane, tileMatchOutline, tileMatchMaterial, tileHoverMaterial, tileDropMaterial, latestDiscardMarker, latestDiscardMarkerBorder, latestDiscardMarkerFill, handHitBox, alignHandHitBox, handHitGeometry, handHitMaterial, tableBody, tableInlay, tableFelt, longRail, shortRail, centerBase } from './tableMaterials';
import { getTheme, tableSeat } from './themes';
import type { TableTheme } from './themes';
import type { WinEffect } from '../effects/winEffects';
import { TableCelebration } from '../effects/TableCelebration';
import { riverLayout } from './riverLayout';
import { fieldExtraWidth, fieldRearExtension } from './riverFieldLayout';
import { riichiStickBody, riichiStickLayout } from './riichiStick';
import { bonusPosition, HAND_ROW_Z, seatLayout } from './tableLayout';
import { fieldSeatOffset, visibleWallCount, wallTileTransform } from './wallLayout';
import { getRiverMatches, riverSelectionScope } from '../presentation/riverMatches';
import { createHandDragController } from '../presentation/handInteraction';
import { isMeldCall } from '../presentation/tableTimeline';
import type { DiscardAction, DiscardIntent, HandDragContext, HandDragPoint, HandDragPreview } from '../presentation/handInteraction';
export type { DiscardIntent } from '../presentation/handInteraction';
import { bonusMotionKey, createTableMotionController, meldMotionKey, opponentMotionKey, riverMotionKey, stickMotionKey, wallMotionKey } from './motion/tableMotion';
import type { ClaimPose, TileMotion } from './motion/tableMotion';
import { printPose } from './motion/printPoses';
import { claimLane, classicDeal, classicGesture, classicReveal, emptyGesture, type Gesture } from './motion/classicGestures';
import { classicBlockers, footprint, lowerExtent, strokeHeight, tightEnd, touchedBlocks, type Footprint } from './motion/classicClearance';
import { tilePlacement } from './tilePlacement';
import type { TilePlacement } from './tilePlacement';
import { AdaptiveTableQuality, deviceTableQuality } from './AdaptiveTableQuality';
import { PixelTableFrame } from './PixelTableFrame';
import { PixelReadoutAnchor, PixelTableReadout } from './PixelTableReadout';
import { meldGroupKey, MeldHintProjector, useMeldSourceHints, type MeldHintBoard } from './MeldSourceHints';
import { MeldCallCut, MeldCallLayer, type CallLayerRef } from './MeldCallCut';
import { pixelTileBack, pixelTileBody } from './tableMaterials';
import { TABLE_QUALITY } from './adaptiveQuality';
import { publicRoundHands, revealedOwnHand, roundDealDelay, roundRevealProgress, ROUND_DEAL_TRAVEL } from '../presentation/roundPresentation';
import type { RoundPresentation } from '../presentation/roundPresentation';

interface TileProps {
  theme: TableTheme; tile?: string; position: [number, number, number]; rotation?: [number, number, number];
  scale?: number; stackHeight?: number; selected?: boolean; interactive?: boolean; faded?: boolean; animatePosition?: boolean; onClick?: () => void;
  placement?: TilePlacement; pieceKey?: string; rackCallKey?: string; quietRim?: boolean;
  inspect?: {board:MeldHintBoard; key:string};
  round?: { phase: RoundPresentation | null; hand?: boolean; seat?: number; index?: number; count?: number; originZ?: number; revealFrom?: [number, number, number] };
  motion?: TileMotion; reducedMotion?: boolean; matched?: boolean; candidate?: boolean; river?: boolean; readTurns?: number; latestDiscard?: boolean;
  handInput?: { context: HandDragContext | null; onPreview: (preview: HandDragPreview | null) => void;
    onDrop: (preview: HandDragPreview, pose: [number, number, number], rotation: [number, number, number], scale: number) => boolean };
}

const noRaycast = () => {};
// An added kan may upgrade an earlier group. Ordinary draws/sorts do not
// change this signature and keep their own hand animations.
const flatCallKey=(melds?:readonly MeldView[])=>melds?.map(m=>m.id+':'+m.tiles.length).join('|');
const noBlocks: ReturnType<typeof classicBlockers> = [];
const ClassicObstacles = createContext(noBlocks);
const strokePoint = new THREE.Vector3(); // synchronous render-thread scratch, not one vector per idle wall tile
const seatRotation = new THREE.Quaternion(), strokeRotation = new THREE.Quaternion();
function localStroke(g:Gesture, motion:TileMotion, to:THREE.Vector3Tuple, progress:number) {
  const dx=to[0]-motion.from[0], dz=to[2]-motion.from[2];
  classicGesture(g,motion.kind,progress,Math.hypot(dx,dz),motion.origin);
  const across=motion.origin==='river-claim' ? claimLane(g.travel,dz) : g.travel;
  strokePoint.set(motion.from[0]+dx*across,0,motion.from[2]+dz*g.travel+g.forward);
}
// Sample once per public claim, while the old river is still mounted. Taking
// the complete body transform also works if the last discard hasn't landed.
function readClaimPose(scene:THREE.Scene,piece:string,seat:number):ClaimPose | undefined {
  const body=scene.getObjectByName(piece)?.getObjectByName('tile-body-pose');
  const receiver=scene.getObjectByName('public-seat:'+seat);
  if (!body || !receiver) return;
  body.updateWorldMatrix(true,false); receiver.updateWorldMatrix(true,false);
  const matrix=receiver.matrixWorld.clone().invert().multiply(body.matrixWorld);
  const p=new THREE.Vector3(), q=new THREE.Quaternion(), s=new THREE.Vector3();
  matrix.decompose(p,q,s);
  const e=new THREE.Euler().setFromQuaternion(q);
  return {position:[p.x,p.y,p.z],rotation:[e.x,e.y,e.z],scale:s.x};
}
const approachSlot=(v:number,to:number,dt:number)=>Math.abs(to-v)<.004 ? to : THREE.MathUtils.damp(v,to,34,dt);
function Tile({ theme, tile, position, rotation = [0, 0, 0], scale = 1, stackHeight = 0, selected = false, interactive = false, faded = false, animatePosition = false, onClick, motion, reducedMotion = false, matched = false, candidate = false, river = false, readTurns = 0, latestDiscard = false, handInput, placement, round, pieceKey, rackCallKey, quietRim=false, inspect }: TileProps) {
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false), [dropValid, setDropValid] = useState(false);
  const [gesture] = useState(() => createHandDragController(HAND_ROW_Z - .60));
  const drag = useRef<HandDragPreview | null>(null), released = useRef<[number, number, number] | null>(null);
  const captured = useRef<{ pointerId: number; target: { releasePointerCapture: (id: number) => void } } | null>(null);
  const capturedWatch = useRef<{ cleanup: () => void } | null>(null);
  const fallbackTap = useRef<{ cleanup: () => void } | null>(null);
  const suppressClick = useRef(false);
  const materials = useMemo(() => tileMaterials(theme, tile, faded, river, readTurns, quietRim), [tile, theme, faded, river, readTurns, quietRim]);
  const lying = Math.abs(rotation[0]) > 1;
  const restY = tileRestHeight(rotation, scale) + stackHeight;
  const ref = useRef<THREE.Group>(null);
  const positionRef = useRef<THREE.Group>(null);
  const hitRef = useRef<THREE.Mesh>(null);
  const lastMark = useRef<THREE.Group>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const liftedShadow = useRef<THREE.MeshBasicMaterial | null>(null);
  const physical = useMemo(emptyGesture, []);
  const obstacles = useContext(ClassicObstacles), route = useRef(noBlocks);
  const liftWindow=useRef({rise:0,plant:0});
  useEffect(() => () => { liftedShadow.current?.dispose(); liftedShadow.current = null; }, []);
  const initialPosition = useRef<[number, number, number]>([motion?.from[0] ?? position[0], 0, motion?.from[2] ?? position[2]]);
  const targetRotation = useMemo(() => new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), [rotation[0], rotation[1], rotation[2]]);
  const fromRotation = useMemo(() => new THREE.Quaternion().setFromEuler(new THREE.Euler(...(motion?.rotation ?? rotation))), [motion?.id]);
  const revealRotation = useMemo(() => new THREE.Quaternion().setFromEuler(new THREE.Euler(...(round?.revealFrom ?? rotation))), [round?.revealFrom?.[0], round?.revealFrom?.[1], round?.revealFrom?.[2]]);
  const dealingRotation = useMemo(() => new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), []);
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
    // Close the gaps in the standing rack on the same frame as the flat
    // companions appear; a sliding end tile would briefly cover the meld.
    if (!rackCallKey || motion || !positionRef.current || !ref.current) return;
    released.current=null; setHover(false);
    positionRef.current.position.set(position[0],0,position[2]);
    ref.current.position.y=restY; ref.current.quaternion.copy(targetRotation); ref.current.scale.setScalar(scale);
  }, [rackCallKey]);
  useLayoutEffect(() => {
    if (!ref.current || !positionRef.current) return;
    route.current=noBlocks;
    liftWindow.current.rise=liftWindow.current.plant=0;
    if (motion && !motion.cancelled && !reducedMotion && performance.now() - motion.started < motion.duration) {
      if (!theme.pixel && motion.origin!=='meld-edge' && motion.kind!=='insert' && motion.kind!=='indicator' && positionRef.current.parent) {
        const parent=positionRef.current.parent, path:number[]=[], poses:Footprint[]=[];
        parent.updateWorldMatrix(true,false);
        ref.current.parent!.getWorldQuaternion(seatRotation);
        const segments=12;
        for(let i=0;i<=segments;i++) {
          localStroke(physical,motion,position,i/segments);
          strokePoint.applyMatrix4(parent.matrixWorld); path.push(strokePoint.x,strokePoint.z);
          strokeRotation.slerpQuaternions(fromRotation,targetRotation,physical.turn).premultiply(seatRotation);
          poses.push(footprint(strokeRotation,THREE.MathUtils.lerp(motion.scale,scale,physical.travel)));
        }
        route.current=touchedBlocks(obstacles,path,Math.max(scale,motion.scale),poses,pieceKey);
        if (motion.origin==='river-claim' || motion.kind==='discard' || motion.kind==='draw' || motion.kind==='kita') {
          if(tightEnd(route.current,path,poses,false,motion.from[1]-lowerExtent(fromRotation,motion.scale))) liftWindow.current.rise=.12;
          if(tightEnd(route.current,path,poses,true,restY-lowerExtent(targetRotation,scale))) liftWindow.current.plant=.10;
        }
      }
      positionRef.current.position.set(motion.from[0], 0, motion.from[2]);
      ref.current.position.y = motion.from[1]; ref.current.quaternion.copy(fromRotation); ref.current.scale.setScalar(motion.scale);
    } else {
      if (reducedMotion || !animatePosition) {
        positionRef.current.position.set(position[0], 0, position[2]); ref.current.position.y=restY;
      }
      ref.current.quaternion.copy(targetRotation); ref.current.scale.setScalar(scale);
    }
  }, [motion?.id, reducedMotion]);
  useFrame(({clock}, delta) => {
    if (!ref.current || !positionRef.current) return;
    const carried = drag.current?.dragging ? [drag.current.position[0], restY + .8, drag.current.position[1]] : released.current;
    // R3F samples its clock once before visiting the tiles. In particular all
    // four pixel tiles switch to the same drawing on exactly the same frame.
    const elapsed = motion ? (motion.origin==='meld-edge' ? clock.oldTime : performance.now()) - motion.started : Infinity;
    const moving = !!motion && !motion.cancelled && !reducedMotion && !document.hidden && elapsed < motion.duration;
    const phase = !reducedMotion && !document.hidden ? round?.phase : null;
    const phaseTime = phase ? performance.now() - phase.started : Infinity;
    const collecting = phase?.kind === 'collect';
    const dealing = phase?.kind === 'deal' && round?.hand;
    const revealing = phase?.kind === 'reveal' && !!round?.revealFrom;
    positionRef.current.visible = true;
    if (collecting) {
      const p = Math.max(0, Math.min(1, phaseTime / phase.duration));
      const eased = theme.pixel ? printPose('collect',p)[1] : p * p * (3 - 2 * p), originZ = round?.originZ ?? 0;
      positionRef.current.position.set(position[0] * (1 - eased * .82), 0,
        THREE.MathUtils.lerp(position[2], (position[2] + originZ) * .18 - originZ, eased));
      ref.current.position.y = restY - eased * eased * 1.15;
      ref.current.scale.setScalar(scale * (1 - eased * .08));
      ref.current.quaternion.copy(targetRotation);
      positionRef.current.visible = p < .98;
    } else if (dealing) {
      const delay = roundDealDelay(round?.index ?? 0, round?.seat ?? 0);
      const p = Math.max(0, Math.min(1, (phaseTime - delay) / ROUND_DEAL_TRAVEL));
      const pose = theme.pixel ? printPose('deal',p) : null;
      positionRef.current.visible = phaseTime >= delay;
      if (pose) {
        positionRef.current.position.set(THREE.MathUtils.lerp(position[0] * .7, position[0], pose[1]), 0, position[2] - 1.15 * (1-pose[1]));
        ref.current.position.y = THREE.MathUtils.lerp(.31 * scale, restY, pose[1]) + pose[2] * .15;
        ref.current.quaternion.slerpQuaternions(dealingRotation, targetRotation, pose[3]);
      } else {
        const g = classicDeal(physical,p,round?.index ?? 0,scale);
        positionRef.current.position.set(position[0]+g.across, 0, position[2]+g.forward);
        ref.current.position.y = THREE.MathUtils.lerp(.31*scale,restY,g.heightMix)+g.lift;
        ref.current.quaternion.slerpQuaternions(dealingRotation,targetRotation,g.turn);
      }
      ref.current.scale.setScalar(scale);
    } else if (revealing) {
      const progress = roundRevealProgress(phase, phaseTime);
      const pose = theme.pixel ? printPose('reveal',progress) : null;
      const eased = pose?.[1] ?? classicReveal(progress,round?.index ?? 0,round?.count ?? 14);
      const pivot = Math.sin(Math.PI*eased)*scale;
      positionRef.current.position.set(position[0], 0, position[2] - (pose ? 0 : .16*pivot));
      ref.current.position.y = THREE.MathUtils.lerp(tileRestHeight(round!.revealFrom!, scale), restY, eased) + (pose ? pose[2]*.04 : .14*pivot);
      ref.current.quaternion.slerpQuaternions(revealRotation, targetRotation, pose?.[3] ?? eased);
      ref.current.scale.setScalar(scale);
    } else if (carried) {
      positionRef.current.position.set(carried[0], 0, carried[2] - HAND_ROW_Z);
      ref.current.position.y = reducedMotion ? carried[1] : THREE.MathUtils.damp(ref.current.position.y, carried[1], 28, delta);
      ref.current.quaternion.copy(targetRotation); ref.current.scale.setScalar(scale);
    } else if (moving) {
      const progress = Math.max(0, Math.min(1, elapsed / motion.duration));
      const dx=position[0]-motion.from[0], dz=position[2]-motion.from[2];
      if (motion.origin==='meld-edge' && isMeldCall(motion.kind)) {
        // The ONLY interpolated property of a live meld is tabletop position.
        // Facing, height (including the added kan's support) and size are the
        // final values even at frame zero. Bypass generic flight and clearance.
        const u=theme.pixel ? printPose(motion.kind,progress)[1]
          : classicGesture(physical,motion.kind,progress,Math.hypot(dx,dz),motion.origin).travel;
        positionRef.current.position.set(motion.from[0]+dx*u,0,motion.from[2]+dz*u);
        ref.current.position.y=restY; ref.current.quaternion.copy(targetRotation); ref.current.scale.setScalar(scale);
      } else if (theme.pixel && motion.kind!=='insert' && motion.kind!=='indicator') {
        const pose=printPose(motion.kind,progress);
        positionRef.current.position.set(motion.from[0]+dx*pose[1],0,motion.from[2]+dz*pose[1]);
        ref.current.position.y=THREE.MathUtils.lerp(motion.from[1],restY,pose[1])+pose[2]*motion.arc;
        ref.current.quaternion.slerpQuaternions(fromRotation,targetRotation,pose[3]);
        ref.current.scale.setScalar(THREE.MathUtils.lerp(motion.scale,scale,pose[1]));
      } else {
        const {rise,plant}=liftWindow.current;
        const travelTime=Math.max(0,Math.min(1,(progress-rise)/(1-rise-plant)));
        localStroke(physical,motion,position,travelTime);
        positionRef.current.position.copy(strokePoint);
        ref.current.quaternion.slerpQuaternions(fromRotation,targetRotation,physical.turn);
        const currentScale=THREE.MathUtils.lerp(motion.scale,scale,physical.travel);
        ref.current.scale.setScalar(currentScale);
        const base=THREE.MathUtils.lerp(motion.from[1],restY,physical.heightMix)+physical.lift;
        const parent=positionRef.current.parent;
        if (parent && motion.kind!=='indicator' && motion.kind!=='insert') {
          strokePoint.applyMatrix4(parent.matrixWorld);
          ref.current.position.y=strokeHeight(route.current,strokePoint.x,strokePoint.z,base,lowerExtent(ref.current.quaternion,currentScale),currentScale,progress,rise||.15,plant||.15);
        } else ref.current.position.y=base;
      }
    } else {
      const smooth = animatePosition && !motion && !theme.pixel && !reducedMotion && !document.hidden;
      positionRef.current.position.x = smooth ? approachSlot(positionRef.current.position.x,position[0],delta) : position[0];
      positionRef.current.position.z = smooth ? approachSlot(positionRef.current.position.z,position[2],delta) : position[2];
      const targetY = restY + (selected ? .22 : hover && interactive ? .1 : 0);
      ref.current.position.y = reducedMotion || motion || theme.pixel ? targetY : THREE.MathUtils.damp(ref.current.position.y, targetY, 22, delta);
      ref.current.quaternion.slerp(targetRotation, reducedMotion || motion || theme.pixel ? 1 : 1 - Math.exp(-delta * 24));
      ref.current.scale.setScalar(scale);
    }
    if (hitRef.current && hit) alignHandHitBox(hitRef.current, position, hit, !moving && !carried ? positionRef.current.position.x : position[0]);
    if (lastMark.current) lastMark.current.visible = theme.pixel || !moving;
    if (shadow.current) {
      const air = Math.max(0,ref.current.position.y-restY);
      // Only the airborne piece gets a personal shadow; resting pieces still
      // share one material. Detach and soften, then tighten on first contact.
      if (air>.015 && !reducedMotion) {
        liftedShadow.current ??= materials.contact.clone();
        liftedShadow.current.opacity=materials.contact.opacity/(1+2.8*air);
        shadow.current.material=liftedShadow.current;
      } else shadow.current.material=materials.contact;
      const size=scale*(1+Math.min(air,1.6)*.28);
      shadow.current.scale.set(.82*size,(lying ? 1.02 : .5)*size,1);
      shadow.current.position.set(.08*air,.09,.02-.055*air);
    }
  });
  return <group dispose={null}><group ref={positionRef} name={pieceKey} position={initialPosition.current}>
    <group position={theme.pixel ? [0,0,0] : [placement?.x ?? 0, 0, placement?.z ?? 0]} rotation={[0, theme.pixel ? 0 : placement?.yaw ?? 0, 0]}>
    {!theme.pixel && stackHeight === 0 && <mesh ref={shadow} position={[0, .09, .02]} rotation={[-Math.PI / 2, 0, rotation[2]]} scale={[.82 * scale, (lying ? 1.02 : .5) * scale, 1]} geometry={contactPlane} material={materials.contact} raycast={noRaycast} />}
    <group ref={ref} name="tile-body-pose" position={[0, restY, 0]} scale={scale}
      onPointerMove={inspect ? e=>{ const source=inspect.board.sources.get(inspect.key);
        if(source && e.pointerType!=='touch' && !e.buttons && !round?.phase) inspect.board.control.show(source,{x:e.clientX,y:e.clientY});
      } : undefined} onPointerOut={inspect ? ()=>inspect.board.control.leave(inspect.key) : undefined}>
    <mesh geometry={theme.pixel ? pixelTileBack : tileBack} material={selected ? materials.selected : materials.back} castShadow receiveShadow />
    <mesh geometry={theme.pixel ? pixelTileBody : tileBody} material={materials.body} castShadow receiveShadow />
    {(matched || selected || hover && interactive || dragging) && <mesh position={[0, 0, .191]} scale={river ? [.96, .97, 1] : undefined} geometry={tileMatchOutline} material={dragging && dropValid ? tileDropMaterial : selected || matched || dragging ? tileMatchMaterial : tileHoverMaterial} raycast={noRaycast} />}
    {latestDiscard && <group ref={lastMark} position={[-.185, .3, .194]}>
      <mesh geometry={latestDiscardMarker} material={latestDiscardMarkerBorder} raycast={noRaycast} />
      <mesh position={[0, 0, .001]} scale={.74} geometry={latestDiscardMarker} material={latestDiscardMarkerFill} raycast={noRaycast} />
    </group>}
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

function RiichiStick({ motion, reduced, pixel, phase }: { motion?: TileMotion; reduced: boolean; pixel?: boolean; phase?: RoundPresentation | null }) {
  const ref = useRef<THREE.Group>(null);
  const physical = useMemo(emptyGesture,[]);
  const { position, size, dotRadius } = riichiStickLayout;
  useFrame(() => {
    if (!ref.current) return;
    ref.current.visible = true;
    if (phase?.kind === 'collect' && !reduced && !document.hidden) {
      const p = Math.max(0, Math.min(1, (performance.now() - phase.started) / phase.duration)), eased = pixel ? printPose('collect',p)[1] : p * p * (3 - 2 * p);
      ref.current.position.set(position[0] * (1 - eased * .82), position[1] - eased * eased * 1.15, position[2] * (1 - eased * .82));
      ref.current.visible = p < .98; return;
    }
    const p = motion && !motion.cancelled && !reduced && !document.hidden ? Math.min(1, Math.max(0, (performance.now() - motion.started) / motion.duration)) : 1;
    if (!pixel && motion && p<1) {
      const g=classicGesture(physical,'riichi',p,0);
      ref.current.position.set(THREE.MathUtils.lerp(motion.from[0],position[0],g.travel),
        THREE.MathUtils.lerp(motion.from[1],position[1],g.heightMix)+g.lift,
        THREE.MathUtils.lerp(motion.from[2],position[2],g.travel));
      ref.current.rotation.set(0,(1-g.turn)*motion.rotation[1],(1-g.heightMix)*.045);
      return;
    }
    const pose = pixel ? printPose('riichi',p) : null;
    const eased = pose?.[1] ?? p * p * (3 - 2 * p);
    ref.current.position.set(THREE.MathUtils.lerp(motion?.from[0] ?? position[0], position[0], eased), THREE.MathUtils.lerp(motion?.from[1] ?? position[1], position[1], eased) + (pose?.[2] ?? Math.sin(p * Math.PI)) * (motion?.arc ?? 0), THREE.MathUtils.lerp(motion?.from[2] ?? position[2], position[2], eased));
    ref.current.rotation.set(0,(1 - eased) * (motion?.rotation[1] ?? 0),0);
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

function ClassicCenterScreen({ snapshot, theme }: { snapshot: GameSnapshot | null; theme: TableTheme }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const details = !snapshot?.mode || ['riichi', 'sanma'].includes(snapshot.mode)
      ? `${snapshot?.round.honba ?? 0} 本场 · 供托 ${snapshot?.round.riichiSticks ?? 0}` : snapshot.modeName ?? '自在一局';
    ctx.fillStyle = theme.ui.panel; ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = theme.trim; ctx.lineWidth = 3; ctx.strokeRect(17, 17, 478, 478);
    ctx.globalAlpha = .35; ctx.lineWidth = 1; ctx.strokeRect(27, 27, 458, 458); ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.ui.text; ctx.font = 'bold 76px "Microsoft YaHei",sans-serif';
    ctx.fillText(snapshot ? `${snapshot.round.wind} ${snapshot.round.hand} 局` : '雀 境', 256, 174);
    ctx.fillStyle = theme.ui.accent; ctx.font = '31px "Microsoft YaHei",sans-serif';
    ctx.fillText(snapshot ? `余 ${snapshot.round.tilesLeft} 枚` : 'M A H J O N G', 256, 269);
    ctx.font = '24px "Microsoft YaHei",sans-serif'; ctx.fillStyle = theme.ui.muted;
    ctx.fillText(snapshot ? details : theme.name, 256, 339);
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  }, [snapshot?.round.wind, snapshot?.round.hand, snapshot?.round.tilesLeft, snapshot?.round.honba, snapshot?.round.riichiSticks, snapshot?.mode, snapshot?.modeName, theme]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <mesh position={[0, .192, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[2.45, 2.45]} /><meshStandardMaterial map={texture} roughness={.7} /></mesh>;
}

function Center({ snapshot, theme, playerCount }: { snapshot: GameSnapshot | null; theme: TableTheme; playerCount: number }) {
  return <group scale={.88}>
    <mesh position={[0, .08, 0]} geometry={centerBase} receiveShadow><meshPhysicalMaterial color={theme.rail} roughness={.33} clearcoat={.25} /></mesh>
    {theme.pixel ? <mesh position={[0,.192,0]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[2.45,2.45]} /><meshBasicMaterial color={theme.background} /></mesh> : <ClassicCenterScreen snapshot={snapshot} theme={theme} />}
    {Array.from({ length: playerCount }, (_, id) => {
      const theta = tableSeat(id, playerCount) * Math.PI / 2;
      return <mesh key={id} position={[Math.sin(theta) * 1.35, .11, Math.cos(theta) * 1.35]} rotation={[0, theta, 0]}>
        <boxGeometry args={[.55, .05, .065]} /><meshStandardMaterial color={snapshot?.turn === id ? theme.trim : theme.tileBack} emissive={snapshot?.turn === id ? theme.trim : '#000'} emissiveIntensity={.45} />
      </mesh>;
    })}
  </group>;
}

function Walls({ remaining, theme, reserve, indicators, placementSeed, phase, extraX, rear, motions, reduced }: { remaining: number; theme: TableTheme; reserve: number; indicators: string[]; placementSeed: number; phase: RoundPresentation | null; extraX: number; rear: number; motions:Map<string,TileMotion>; reduced:boolean }) {
  const tiles = useMemo(() => Array.from({ length: visibleWallCount(remaining, reserve) }, (_, index) =>
    wallTileTransform(index,indicators,extraX,rear)), [remaining, reserve, indicators, extraX, rear]);
  return <group>{tiles.map((tile, i) => <Tile quietRim theme={theme} key={i} pieceKey={wallMotionKey(i)} {...tile} motion={motions.get(wallMotionKey(i))} reducedMotion={reduced} placement={tilePlacement(placementSeed, `wall:${Math.floor(i / 2)}`, 'wall')} round={{ phase }} />)}</group>;
}

const previewHand = ['m2', 'm3', 'm4', 'm6', 'm7', 'm8', 'p2', 'p2', 'p3', 'p4', 'p5', 's3', 's4', 's5'];
interface SceneProps {
  snapshot: GameSnapshot | null; selectedId: string | null; selectedIds?: string[]; interactiveIds?: string[];
  sessionIdentity?: object | null;
  roundPresentation?: RoundPresentation | null;
  revealedHands?: Record<number, string[]>;
  displayHand?: HandTile[];
  /** Live pixel play has its own screen-space hand. All other seats and melds stay on the table. */
  externalHand?: boolean;
  /** Desktop pixel field draws the public rivers in screen space, at native pixel sizes. */
  screenRivers?: boolean;
  onSelect: (tile: HandTile) => void; view: 'perspective' | 'overhead'; theme: TableTheme; previewPlayerCount?: number;
  celebration?: WinEffect | null;
  reducedMotion?: boolean;
  showMeldCalls?: boolean;
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

function ClassicTableFrame({ theme }: { theme: TableTheme }) {
  const felt = useMemo(() => feltSurface(theme), [theme]);
  const wood = useMemo(() => woodSurface(theme), [theme]);
  return <>
    <mesh position={[0, -.39, 0]} geometry={tableBody} receiveShadow castShadow><meshPhysicalMaterial map={wood.map} bumpMap={wood.bump} bumpScale={.009} roughness={.36} clearcoat={.24} clearcoatRoughness={.36} /></mesh>
    <mesh position={[0, -.05, 0]} geometry={tableInlay} receiveShadow><meshStandardMaterial color={theme.trim} roughness={.32} metalness={.68} /></mesh>
    <mesh position={[0, .025, 0]} geometry={tableFelt} receiveShadow><meshStandardMaterial map={felt.map} bumpMap={felt.bump} bumpScale={.013} roughness={.97} envMapIntensity={.22} /></mesh>
    {[-6.82, 6.82].map(x => <mesh key={x} position={[x, .025, 0]} rotation={[0, Math.PI / 2, 0]} geometry={shortRail} castShadow receiveShadow><meshPhysicalMaterial map={wood.map} bumpMap={wood.bump} bumpScale={.008} roughness={.33} clearcoat={.32} clearcoatRoughness={.34} /></mesh>)}
    {[-6.59, 6.59].map(z => <mesh key={z} position={[0, .025, z]} geometry={longRail} castShadow receiveShadow><meshPhysicalMaterial map={wood.map} bumpMap={wood.bump} bumpScale={.008} roughness={.33} clearcoat={.32} clearcoatRoughness={.34} /></mesh>)}
  </>;
}

function Scene({ snapshot, selectedId, selectedIds = [], interactiveIds, displayHand, externalHand = false, screenRivers = false, onSelect, view, theme, previewPlayerCount = 4, celebration, reducedMotion = false, showMeldCalls=true, highlightedTile = null, discardAction = null, discardIntent = null, onTileDiscard, sessionIdentity, roundPresentation = null, revealedHands, meldHints, callLayer }: SceneProps & {meldHints:MeldHintBoard;callLayer:CallLayerRef}) {
  const { camera, gl, size, scene } = useThree();
  const extraX = screenRivers ? fieldExtraWidth(size.width,size.height) : 0;
  const rear = screenRivers ? fieldRearExtension(view === 'overhead') : 0;
  useLayoutEffect(() => { gl.domElement.dataset.riverRenderer = screenRivers ? 'screen' : 'mesh'; }, [gl,screenRivers]);
  const desired = useMemo(() => new THREE.Vector3(), []);
  const compact = size.width <= 1100 && size.height <= 420 && size.width > size.height * 1.6;
  // Frame the preview in the free space beside the menu without moving/cropping
  // the canvas. The same camera is used for rendering and pointer raycasts.
  const sidePreview = !!theme.pixel && !snapshot && !compact;
  useLayoutEffect(() => {
    const lens = camera as THREE.PerspectiveCamera;
    if (sidePreview && size.width && size.height) {
      const shift = Math.round(Math.min(250, size.width * .19));
      lens.setViewOffset(size.width, size.height, -shift, 0, size.width, size.height);
      return () => lens.clearViewOffset();
    }
  }, [camera, sidePreview, size.width, size.height]);
  useFrame((_, delta) => {
    desired.set(0, view === 'overhead' ? 19.8 : compact ? 8 : 9, view === 'overhead' ? 6.9 : compact ? 12 : 11.8);
    if (theme.pixel && view !== 'overhead') {
      if (externalHand) desired.set(0, 14, 16.2);
      else desired.set(0, 17, 12.4);
    }
    if (screenRivers) desired.set(0, view === 'overhead' ? 20.8 : 18, view === 'overhead' ? 5 : 10);
    if (sidePreview) desired.multiplyScalar(1.25);
    camera.position.lerp(desired, reducedMotion || theme.pixel ? 1 : 1 - Math.exp(-delta * 3));
    camera.lookAt(0, 0, screenRivers ? .10 : sidePreview ? .15 : view === 'overhead' ? .65 : externalHand ? 1.25 : theme.pixel ? 1.45 : compact ? 1.4 : 1.2);
    const perspective = camera as THREE.PerspectiveCamera;
    const fov = screenRivers ? 36.8 : externalHand ? view === 'overhead' ? 36 : 29 : theme.pixel && view !== 'overhead' ? 33 : compact && view !== 'overhead' ? 41 : 43;
    if (Math.abs(perspective.fov - fov) > .01) { perspective.fov = fov; perspective.updateProjectionMatrix(); }
    gl.domElement.dataset.tableLayout = compact ? 'landscape' : 'desktop';
    gl.domElement.dataset.roundPhase = roundPresentation?.kind ?? 'idle';
  });
  const playerCount = snapshot?.players.length ?? previewPlayerCount;
  const seatOffset = (id: number) => fieldSeatOffset(tableSeat(id,playerCount),extraX,rear);
  const human = snapshot?.players.find(player => player.isHuman);
  const sampleHand = playerCount === 3 ? ['m1', 'm9', 'p2', 'p3', 'p4', 'p6', 'p7', 'p8', 's3', 's4', 's5', 'z4', 'z5', 'z5'] : previewHand;
  const publicHands = revealedHands ?? (snapshot ? publicRoundHands(snapshot) : {});
  const ended = !!snapshot && snapshot.status !== 'playing';
  const ownHand = revealedOwnHand(displayHand ?? human?.hand ?? sampleHand.map((tile, i) => ({ id: String(i), tile, label: '', drawn: i === 13 })), publicHands[0]);
  const ownFaceUp = ended || !!publicHands[0];
  const ownRackCall=flatCallKey(human?.melds);
  const classicSeat=(seat:number)=>theme.pixel ? undefined : {seat,playerCount};
  const handTilt = theme.pixel ? view === 'overhead' ? -1.05 : -.62 : -.31;
  const [motionController] = useState(createTableMotionController);
  const dragPreview = useRef<HandDragPreview | null>(null);
  useEffect(() => {
    const visibility = () => motionController.cancel();
    document.addEventListener('visibilitychange', visibility);
    return () => { document.removeEventListener('visibilitychange', visibility); motionController.cancel(); };
  }, [motionController]);
  const motionFrame = motionController.update(snapshot, ownHand, selectedId, reducedMotion, discardIntent, sessionIdentity,extraX,rear,theme.pixel ? 'pixel' : 'classic',(piece,seat)=>readClaimPose(scene,piece,seat),showMeldCalls && !roundPresentation);
  const legalIds = new Set(interactiveIds ?? snapshot?.actions.filter(action => ['discard', 'riichi', 'exchange'].includes(action.type)).map(action => action.tileId));
  const restricted = legalIds.size > 0 && ownHand.some(tile => !legalIds.has(tile.id));
  const selectionScope = snapshot ? riverSelectionScope(snapshot) : '';
  const legalKey = JSON.stringify(snapshot?.actions.filter(action => action.type === discardAction).map(action => [action.id, action.tileId]) ?? []);
  const dropTarget = human && riverLayout([...human.discards, { tile: 'm1', called: false, riichi: discardAction === 'riichi', tsumogiri: false }]).items.at(-1);
  const seats = snapshot?.players ?? Array.from({ length: playerCount }, (_, id) => ({ id, concealedCount: 13, revealedHand: undefined, melds: [] }));
  const reserve = !snapshot?.mode || ['riichi', 'sanma'].includes(snapshot.mode) ? 14 : 0;
  const count=visibleWallCount(snapshot?.round.tilesLeft ?? 70,reserve);
  const obstacles=useMemo(()=>theme.pixel ? noBlocks : classicBlockers(count,snapshot?.players),[theme.pixel,count,snapshot?.players]);
  const riverMatches = getRiverMatches(snapshot?.players ?? [], highlightedTile, snapshot ?? undefined);
  return <ClassicObstacles.Provider value={obstacles}>
    {!theme.pixel && <StudioEnvironment />}
    <color attach="background" args={[theme.background]} /><fog attach="fog" args={[theme.background, 28, 54]} />
    <ambientLight intensity={theme.pixel ? .8 : theme.id === 'contrast' ? .22 : .07} /><hemisphereLight args={[theme.light, '#17251f', .25]} />
    <directionalLight position={[5, 6, -5]} intensity={.34} color={theme.fillLight} />
    <mesh position={[0, -.92, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[100, 100]} />{theme.pixel ? <meshBasicMaterial color={theme.background} /> : <meshStandardMaterial color={theme.background} roughness={.95} />}</mesh>
    {theme.pixel ? <group position={[0,0,-rear/2]} scale={[1+2*extraX/14.15,1,1+rear/13.55]}><PixelTableFrame theme={theme} /></group> : <ClassicTableFrame theme={theme} />}
    <Center snapshot={snapshot} theme={theme} playerCount={playerCount} /><Walls remaining={snapshot?.round.tilesLeft ?? 70} theme={theme} reserve={reserve} indicators={snapshot?.round.doraIndicators ?? ['p4']} placementSeed={motionFrame.placementSeed} phase={roundPresentation} extraX={extraX} rear={rear} motions={motionFrame.motions} reduced={reducedMotion} />
    {celebration && !theme.pixel && <TableCelebration key={celebration.id} effect={celebration} theme={theme} />}
    {!externalHand && <group key={`hand-${motionFrame.identity}`} position={[0, 0, HAND_ROW_Z]}>
      {motionFrame.hand.map(({ key, tile, position, scale }, index) => <Tile key={key} pieceKey={key} theme={theme} tile={tile.tile} position={position} rotation={ownFaceUp ? [-Math.PI / 2, 0, 0] : [handTilt, 0, 0]} scale={scale} animatePosition rackCallKey={ownRackCall} motion={motionFrame.motions.get(key)} reducedMotion={reducedMotion} selected={selectedId === tile.id || selectedIds.includes(tile.id)} interactive={!!snapshot && legalIds.has(tile.id)} faded={restricted && !legalIds.has(tile.id)} candidate={restricted && legalIds.has(tile.id)} onClick={() => onSelect(tile)} placement={tilePlacement(motionFrame.placementSeed, key, 'hand')} round={{ phase: roundPresentation, hand: true, seat: 0, index, count: ownHand.length, originZ: HAND_ROW_Z, revealFrom: roundPresentation?.hands[0] ? [handTilt, 0, 0] : undefined }}
        handInput={{ context: snapshot && discardAction && onTileDiscard && legalIds.has(tile.id) ? { tileId: tile.id, selectionScope, action: discardAction, legalKey } : null,
          onPreview: preview => { dragPreview.current = preview; },
          onDrop: (preview, pose, rotation) => {
            motionController.captureReleaseOrigin(preview.context.tileId, preview.context.selectionScope, pose, rotation);
            const accepted = onTileDiscard?.(preview.context.tileId, preview.context.selectionScope, preview.context.action) ?? false;
            if (!accepted) motionController.clearReleaseOrigin(); return accepted;
          } }} />)}
    </group>}
    {!externalHand && dropTarget && <DropTarget preview={dragPreview} position={dropTarget.position} rotation={dropTarget.rotation} />}
    {seats.filter(player => player.id !== 0).map(player => {
      const publicHand = publicHands[player.id];
      const rackCall=flatCallKey(player.melds);
      const layout = seatLayout(Array.from({ length: publicHand?.length ?? player.concealedCount }, () => ({ drawn: false })), player.melds, false, (snapshot?.handSize ?? 13) > 14,false,classicSeat(player.id));
      return <group key={`${motionFrame.identity}-opponent-${player.id}`} position={seatOffset(player.id)} rotation={[0, tableSeat(player.id, playerCount) * Math.PI / 2, 0]}>
        {layout.hand.map((slot, i) => <Tile quietRim={!publicHand} theme={theme} key={i} pieceKey={opponentMotionKey(player.id,i)} tile={publicHand?.[i]} position={[slot.position[0], 0, HAND_ROW_Z]} rotation={publicHand ? [-Math.PI / 2, 0, 0] : [-.09, 0, Math.PI]} scale={slot.scale} animatePosition rackCallKey={rackCall} motion={motionFrame.motions.get(opponentMotionKey(player.id, i))} reducedMotion={reducedMotion} placement={tilePlacement(motionFrame.placementSeed, opponentMotionKey(player.id, i), 'hand')} round={{ phase: roundPresentation, hand: true, seat: tableSeat(player.id, playerCount), index: i, count: layout.hand.length, revealFrom: roundPresentation?.hands[player.id] ? [-.09, 0, Math.PI] : undefined }} />)}
      </group>;
    })}
    {(snapshot?.players ?? []).map(player => {
      const slots=seatLayout(player.id === 0 ? ownHand : Array.from({ length: player.revealedHand?.length ?? player.concealedCount }, () => ({ drawn: false })), player.melds, player.id === 0, (snapshot?.handSize ?? 13) > 14, !!snapshot?.hideOpponentConcealedKongs && player.id !== snapshot.humanId,classicSeat(player.id)).melds;
      const impact=motionFrame.impacts.get(player.id);
      return <group key={`${motionFrame.identity}-public-${player.id}`} name={'public-seat:'+player.id} position={seatOffset(player.id)} rotation={[0, tableSeat(player.id, playerCount) * Math.PI / 2, 0]}>
      {!screenRivers && riverLayout(player.discards).items.map(discard => <Tile key={discard.sourceIndex} pieceKey={riverMotionKey(player.id,discard.sourceIndex)} theme={theme} tile={discard.tile} position={discard.position} rotation={discard.rotation} scale={discard.scale} river readTurns={(tableSeat(player.id, playerCount) + Number(discard.sideways)) % 4} latestDiscard={motionFrame.latestDiscard?.seat === player.id && motionFrame.latestDiscard.sourceIndex === discard.sourceIndex} faded={discard.tsumogiri} matched={riverMatches.byPlayer.find(matches => matches.playerId === player.id)?.pageIndices.includes(discard.sourceIndex)} animatePosition motion={motionFrame.motions.get(riverMotionKey(player.id, discard.sourceIndex))} reducedMotion={reducedMotion} placement={tilePlacement(motionFrame.placementSeed, riverMotionKey(player.id, discard.sourceIndex), 'river')} round={{ phase: roundPresentation }} />)}
      {impact && <MeldCallCut key={impact.id} event={impact} slots={slots} pixel={!!theme.pixel} side={tableSeat(player.id,playerCount)} layer={callLayer}/>}
      {slots.map(tile => {
        const key=meldGroupKey(player.id,tile.meldIndex), piece=meldMotionKey(player.id,tile.meldIndex,tile.tileIndex);
        return <Tile key={tile.key} pieceKey={piece} theme={theme} tile={tile.tile} position={tile.position} rotation={tile.rotation} scale={tile.scale} stackHeight={tile.stackHeight}
          inspect={meldHints.sources.has(key) ? {board:meldHints,key} : undefined}
          matched={!!tile.tile && !!riverMatches.byPlayer.find(matches => matches.playerId === player.id)?.meldIndices.some(index => index.meldIndex === tile.meldIndex && index.tileIndex === tile.tileIndex)} motion={motionFrame.motions.get(piece)} reducedMotion={reducedMotion} round={{ phase: roundPresentation }} />;
      })}
      {Array.from({ length: player.kita ?? 0 }, (_, i) => <Tile key={`bonus-${i}`} theme={theme} tile="z4" position={bonusPosition(i)} rotation={[-Math.PI / 2, 0, 0]} scale={.58} motion={motionFrame.motions.get(bonusMotionKey(player.id, (player.flowers?.length ?? 0) + i))} reducedMotion={reducedMotion} round={{ phase: roundPresentation }} />)}
    </group>;})}
    {snapshot?.players.filter(p=>p.riichi).map(p => <group key={`stick-${motionFrame.identity}-${p.id}`} rotation={[0,tableSeat(p.id,playerCount)*Math.PI/2,0]}>
      <RiichiStick motion={motionFrame.motions.get(stickMotionKey(p.id))} reduced={reducedMotion} pixel={theme.pixel} phase={roundPresentation} />
    </group>)}
  </ClassicObstacles.Provider>;
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
  const hints=useMeldSourceHints(props.roundPresentation ? null : props.snapshot,props.view+':'+theme.id+':'+!!theme.pixel,props.sessionIdentity);
  const [maxDpr, setMaxDpr] = useState<number>(() => TABLE_QUALITY[deviceTableQuality()].pixelRatio);
  const readout = useRef<HTMLDivElement>(null);
  const callLayer = useRef<HTMLDivElement>(null);
  return <div className="mahjong-viewport"><Canvas style={{ touchAction: 'none' }} flat={!!theme.pixel} shadows={theme.pixel ? 'basic' : 'soft'} camera={{ position: [0, 9, 11.8], fov: 43, near: .1, far: 100 }} dpr={[1, theme.pixel ? 2 : maxDpr]} gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', toneMappingExposure: theme.exposure }} fallback={<div className="webgl-fallback">当前浏览器无法创建 WebGL 3D 场景，请使用启用硬件加速的 Edge 或 Chrome。</div>}>
    <ContextMonitor onFailure={props.onFailure} onRestore={props.onRestore} /><AdaptiveTableQuality theme={theme} onDpr={setMaxDpr} /><Suspense fallback={null}><Scene {...props} theme={theme} meldHints={hints.board} callLayer={callLayer} /><MeldHintProjector control={hints.board.control} />{theme.pixel && <PixelReadoutAnchor node={readout} />}</Suspense>
  </Canvas>{props.snapshot && <MeldCallLayer layer={callLayer} pixel={!!theme.pixel}/>} {hints.overlay}{theme.pixel && <PixelTableReadout node={readout} snapshot={props.snapshot} theme={theme} />}</div>;
}
