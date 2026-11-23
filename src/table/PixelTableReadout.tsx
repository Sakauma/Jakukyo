import { useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';
import type { GameSnapshot } from '../game/types';
import type { TableTheme } from './themes';

type ReadoutRef = RefObject<HTMLDivElement | null>;

/** Attach a real text readout to the board. Unlike lettering on a sloped texture,
 * it stays upright and uses the display's text rasterizer, even in small replays. */
export function PixelReadoutAnchor({ node }: { node: ReadoutRef }) {
  const p = useMemo(() => new Vector3(), []);
  const last = useRef({ x: NaN, y: NaN, width: NaN });
  useFrame(({ camera, size }) => {
    const el = node.current; if (!el) return;
    camera.updateMatrixWorld();
    p.set(0, .20, 0).project(camera);
    const x = Math.round((p.x + 1) * size.width / 2), y = Math.round((1 - p.y) * size.height / 2);
    const width = 2 * Math.round((p.set(1, .20, 0).project(camera).x + 1) * size.width / 2 - x);
    if (last.current.x === x && last.current.y === y && last.current.width === width) return;
    last.current = { x, y, width };
    el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.width = Math.max(32, width) + 'px';
    // Drop secondary copy before it would require a sub-native font size.
    el.dataset.fit = width < 64 ? 'tiny' : width < 104 ? 'small' : 'full';
  });
  return null;
}

export function PixelTableReadout({ node, snapshot, theme }: { node: ReadoutRef; snapshot: GameSnapshot | null; theme: TableTheme }) {
  const round = snapshot?.round;
  return <div className="pixel-readout" ref={node} data-carry={!!(round?.honba || round?.riichiSticks) || undefined}>
    <strong>{round ? <>{round.wind}{round.hand}<b>局</b></> : '雀境'}</strong>
    <span>{round ? `余${round.tilesLeft}张` : theme.name}</span>
    {round && (!snapshot?.mode || ['riichi','sanma'].includes(snapshot.mode)) && <small>{round.honba}本场·供托{round.riichiSticks}</small>}
  </div>;
}
