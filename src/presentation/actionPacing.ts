import { useEffect, useLayoutEffect, useRef } from 'react';
import type { GameSessionAPI, GameSnapshot } from '../game/types';
import { actionObservationDelay, needsTableBaseline, tableMotionCues } from './tableTimeline';

/** A short automatic-step hold, independent of the deal/reveal/collect pause owner. */
export function useActionPacing(session: GameSessionAPI | null, snapshot: GameSnapshot | null, reduced: boolean, roundBusy: boolean) {
  const previous = useRef<{ session: GameSessionAPI | null; snapshot: GameSnapshot | null }>({ session: null, snapshot: null });
  const hold = useRef<{ session: GameSessionAPI; timer: ReturnType<typeof setTimeout> | null } | null>(null);

  function release() {
    const active = hold.current;
    hold.current = null;
    if (!active) return;
    if (active.timer !== null) clearTimeout(active.timer);
    active.session.setPresentationPaused(false, 'action');
  }

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { session, snapshot };
    const manualChoice = !!snapshot && !snapshot.autoPlay && snapshot.actions.length > 0;
    if (!session || !snapshot || snapshot.status !== 'playing' || reduced || roundBusy || document.hidden
      || snapshot.speed <= 250 || manualChoice || before.session !== session || needsTableBaseline(before.snapshot, snapshot)
      || before.snapshot?.speed !== snapshot.speed
      || snapshot.latestWin?.id !== before.snapshot?.latestWin?.id) {
      release(); return;
    }
    const delay = actionObservationDelay(tableMotionCues(before.snapshot!, snapshot), snapshot.speed, reduced);
    if (!delay) return;
    if (hold.current?.timer != null) clearTimeout(hold.current.timer);
    const active = { session, timer: null as ReturnType<typeof setTimeout> | null };
    hold.current = active;
    // Register before publishing the held snapshot so its revision cannot restart the window.
    active.timer = setTimeout(() => { if (hold.current === active) release(); }, delay);
    session.setPresentationPaused(true, 'action');
  }, [session, snapshot?.revision, reduced, roundBusy]);

  useEffect(() => {
    const hide = () => {
      if (!document.hidden) return;
      previous.current = { session: null, snapshot: null };
      release();
    };
    document.addEventListener('visibilitychange', hide);
    return () => { document.removeEventListener('visibilitychange', hide); release(); };
  }, []);
}
