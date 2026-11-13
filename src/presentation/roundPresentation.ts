import { useEffect, useRef, useState } from 'react';
import type { GameSessionAPI, GameSnapshot, HandTile } from '../game/types';

export type RoundPresentationKind = 'deal' | 'reveal' | 'collect';
export const ROUND_PRESENTATION_DURATION = { deal: 680, reveal: 460, collect: 440 } as const;
export const ROUND_DEAL_TRAVEL = 220;
export const roundDealDelay = (index: number, physicalSeat: number) => Math.floor(index / 4) * 96 + physicalSeat * 24;
export const roundRevealContact = (phase: RoundPresentation) => phase.duration * (phase.returnToHand ? .4 : .82);
export function roundRevealProgress(phase: RoundPresentation, elapsed: number) {
  const progress = Math.min(1, Math.max(0, elapsed / phase.duration));
  return phase.returnToHand ? progress < .4 ? progress / .4 : progress < .58 ? 1 : (1 - progress) / .42 : Math.min(1, progress / .82);
}
export interface RoundPresentation {
  id: number;
  kind: RoundPresentationKind;
  started: number;
  duration: number;
  hands: Record<number, string[]>;
  returnToHand?: boolean;
}

export function roundPresentationSounds(snapshot: GameSnapshot, phase: RoundPresentation): { sound: 'deal' | 'reveal' | 'collect'; seat: number; at: number; volume: number }[] {
  if (phase.kind === 'deal') return snapshot.players.flatMap(player => {
    const physicalSeat = snapshot.players.length === 3 && player.id === 2 ? 3 : player.id;
    const count = (snapshot.handSize ?? 13) + (player.id === snapshot.round.dealer ? 1 : 0);
    return Array.from({ length: Math.ceil(count / 4) }, (_, group) => ({ sound: 'deal' as const, seat: player.id,
      at: roundDealDelay(group * 4, physicalSeat) + ROUND_DEAL_TRAVEL, volume: .72 }));
  });
  if (phase.kind === 'reveal') return Object.keys(phase.hands).map(seat => ({ sound: 'reveal' as const, seat: Number(seat), at: roundRevealContact(phase) - 70, volume: .76 }));
  return snapshot.players.map(player => ({ sound: 'collect', seat: player.id, at: player.id * 8, volume: .45 }));
}

export const roundPresentationScope = (snapshot: GameSnapshot) =>
  `${snapshot.mode}:${snapshot.seed}:${snapshot.round.wind}:${snapshot.round.hand}:${snapshot.round.honba}:${snapshot.round.dealer}:${snapshot.round.sequence ?? ''}`;

/** Snapshot reveals are the complete source of face-up opponent tiles. */
export function publicRoundHands(snapshot: GameSnapshot): Record<number, string[]> {
  const hands: Record<number, string[]> = {};
  // Blood-flow winners keep playing; a historical win is not their final hand.
  const winners = snapshot.mode === 'sichuan-river' && snapshot.status !== 'playing' ? [] : snapshot.result?.winners ?? snapshot.latestWin?.winners ?? [];
  for (const winner of winners) hands[winner.playerId] = winner.hand;
  for (const player of snapshot.players) if (player.revealedHand) hands[player.id] = player.revealedHand;
  return hands;
}

export function revealedOwnHand(held: HandTile[], revealed?: string[]): HandTile[] {
  if (!revealed) return held;
  const remaining = [...revealed];
  const existing = held.filter(item => {
    const index = remaining.indexOf(item.tile);
    if (index < 0) return false;
    remaining.splice(index, 1); return true;
  });
  return [...existing, ...remaining.map((tile, index) => ({ id: `revealed-${index}`, tile, label: '', drawn: true }))];
}

/** Presentation pauses are always released by completion, cancellation, hiding or disposal. */
export function useRoundPresentation(session: GameSessionAPI | null, snapshot: GameSnapshot | null, reduced: boolean) {
  const [phase, setPhase] = useState<RoundPresentation | null>(null);
  const [settledScope, setSettledScope] = useState('');
  const active = useRef<{ phase: RoundPresentation; session: GameSessionAPI; scope: string; after?: () => void } | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequence = useRef(0);
  const previous = useRef<{ session: GameSessionAPI | null; snapshot: GameSnapshot | null }>({ session: null, snapshot: null });
  const publicHands = useRef<Record<number, string[]>>({});
  const current = useRef({ session, snapshot, reduced }); current.current = { session, snapshot, reduced };

  function finish(runAfter = true) {
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
    const ending = active.current; active.current = null; setPhase(null);
    if (!ending) return;
    ending.session.setPresentationPaused(false);
    if (ending.phase.kind === 'reveal') setSettledScope(ending.scope);
    if (runAfter) ending.after?.();
  }

  function start(kind: RoundPresentationKind, target: GameSessionAPI, hands: Record<number, string[]> = {}, after?: () => void) {
    finish(false);
    const frame = target.getSnapshot(), scope = roundPresentationScope(frame);
    if (current.current.reduced || typeof document !== 'undefined' && document.hidden) {
      target.setPresentationPaused(false);
      if (kind === 'reveal') setSettledScope(scope);
      after?.(); return;
    }
    const next: RoundPresentation = { id: ++sequence.current, kind, hands, started: performance.now(), duration: ROUND_PRESENTATION_DURATION[kind],
      returnToHand: kind === 'reveal' && frame.mode === 'sichuan-river' && frame.status === 'playing' && frame.latestWin?.continuing };
    target.setPresentationPaused(true);
    active.current = { phase: next, session: target, scope, after }; setPhase(next);
    timeout.current = setTimeout(() => finish(), next.duration);
  }

  useEffect(() => {
    const old = previous.current;
    previous.current = { session, snapshot };
    if (!session || !snapshot) { finish(false); publicHands.current = {}; setSettledScope(''); return; }
    const scope = roundPresentationScope(snapshot);
    const fresh = old.session !== session || !old.snapshot || roundPresentationScope(old.snapshot) !== scope;
    if (fresh) {
      publicHands.current = publicRoundHands(snapshot);
      if (active.current && active.current.session !== session) finish(false);
      setSettledScope(snapshot.status === 'playing' ? '' : scope);
      return;
    }
    const newWin = !!snapshot.latestWin && snapshot.latestWin.id !== old.snapshot!.latestWin?.id;
    const ended = snapshot.status !== 'playing' && old.snapshot!.status === 'playing';
    if (!newWin && !ended) return;
    const hands = publicRoundHands(snapshot);
    if (snapshot.mode === 'sichuan-blood') Object.assign(publicHands.current, hands);
    if (ended && snapshot.humanId != null) {
      const human = snapshot.players.find(player => player.id === snapshot.humanId);
      if (human && !hands[human.id]) hands[human.id] = human.hand.map(tile => tile.tile);
    }
    setSettledScope(''); start('reveal', session, hands);
  }, [session, snapshot?.revision]);

  useEffect(() => { if (reduced) finish(); }, [reduced]);
  useEffect(() => {
    const hide = () => { if (document.hidden) finish(); };
    document.addEventListener('visibilitychange', hide);
    return () => { document.removeEventListener('visibilitychange', hide); finish(false); };
  }, []);

  const ended = !!snapshot && snapshot.status !== 'playing';
  const sameHand = !!snapshot && previous.current.session === session && !!previous.current.snapshot
    && roundPresentationScope(previous.current.snapshot) === roundPresentationScope(snapshot);
  const persistent = ended && snapshot ? publicRoundHands(snapshot) : snapshot?.mode === 'sichuan-blood'
    ? { ...(sameHand ? publicHands.current : {}), ...publicRoundHands(snapshot) } : {};
  return {
    phase,
    revealedHands: phase?.kind === 'reveal' ? { ...persistent, ...phase.hands } : persistent,
    busy: !!phase,
    settlementReady: reduced || !!snapshot && settledScope === roundPresentationScope(snapshot),
    deal(target: GameSessionAPI) { start('deal', target); },
    collect(after: () => void): boolean {
      if (active.current || !session || !ended) return false;
      start('collect', session, persistent, after); return true;
    },
    cancel() { finish(false); },
  };
}
