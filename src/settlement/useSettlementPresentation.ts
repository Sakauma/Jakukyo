import { useCallback, useEffect, useState } from 'react';

interface PresentationFrame { key: string; revealed: number; progress: number; complete: boolean }

/** Presentation only: every number comes from the immutable engine settlement. */
export function useSettlementPresentation(key: string, yakuCount: number, enabled: boolean) {
  const [frame, setFrame] = useState<PresentationFrame>({ key: '', revealed: 0, progress: 0, complete: false });
  const complete = useCallback(() => {
    setFrame({ key, revealed: yakuCount, progress: 1, complete: true });
  }, [key, yakuCount]);

  useEffect(() => {
    if (!enabled || document.hidden) { complete(); return; }
    let request = 0;
    let stopped = false;
    const start = performance.now();
    const step = Math.min(210, 1200 / Math.max(1, yakuCount));
    const countStart = 180 + Math.max(0, yakuCount - 1) * step + 240;
    setFrame({ key, revealed: 0, progress: 0, complete: false });
    const tick = (now: number) => {
      if (stopped) return;
      const elapsed = now - start;
      const rawProgress = Math.max(0, Math.min(1, (elapsed - countStart) / 720));
      const progress = 1 - Math.pow(1 - rawProgress, 3);
      setFrame(current => current.key === key && current.complete ? current : {
        key,
        revealed: Math.min(yakuCount, Math.max(0, Math.floor((elapsed - 180) / step) + 1)),
        progress,
        complete: rawProgress === 1,
      });
      if (rawProgress < 1) request = requestAnimationFrame(tick);
    };
    const visibility = () => { if (document.hidden) { stopped = true; cancelAnimationFrame(request); complete(); } };
    document.addEventListener('visibilitychange', visibility);
    request = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(request); document.removeEventListener('visibilitychange', visibility); };
  }, [key, yakuCount, enabled, complete]);

  const view = !enabled ? { revealed: yakuCount, progress: 1, complete: true }
    : frame.key === key ? frame : { revealed: 0, progress: 0, complete: false };
  return { ...view, skip: complete };
}

export function presentedNumber(value: number, progress: number, from = 0) {
  if (progress >= 1) return value;
  const precision = Number.isInteger(value) && Number.isInteger(from) ? 1 : 100;
  return Math.round((from + (value - from) * progress) * precision) / precision;
}
