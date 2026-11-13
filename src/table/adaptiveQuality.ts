export type TableQuality = 0 | 1 | 2;

export const TABLE_QUALITY = [
  { name: 'economy', pixelRatio: 1, shadowSize: 512 },
  { name: 'balanced', pixelRatio: 1.25, shadowSize: 1024 },
  { name: 'detailed', pixelRatio: 1.5, shadowSize: 2048 },
] as const;

export function initialTableQuality(device: { compact: boolean; cores?: number; memory?: number }): TableQuality {
  if (device.cores != null && device.cores <= 2 || device.memory != null && device.memory <= 2) return 0;
  return device.compact ? 1 : 2;
}

/** Whole active-frame windows and hysteresis keep isolated stalls from changing quality. */
export function createFrameQualityController(initial: TableQuality) {
  let quality = initial;
  let readyAt = 0, changedAt = -Infinity, windowStarted = 0;
  let samples = 0, total = 0, slow = 0, badWindows = 0, goodWindows = 0;
  const clearWindow = () => { windowStarted = 0; samples = 0; total = 0; slow = 0; };
  const reset = (now: number, warmup = 3000) => {
    readyAt = Math.max(readyAt, now + warmup); badWindows = 0; goodWindows = 0; clearWindow();
  };
  return {
    reset,
    get quality() { return quality; },
    sample(now: number, deltaSeconds: number, visible: boolean): TableQuality {
      if (!visible) { reset(now); return quality; }
      if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return quality;
      if (now < readyAt) return quality;
      if (!windowStarted) windowStarted = now;
      const milliseconds = Math.min(100, deltaSeconds * 1000);
      samples++; total += milliseconds; if (milliseconds > 28) slow++;
      // A continuously overloaded device must also downshift at 1–2 FPS.
      // An isolated long frame cannot pass both windows or the slow-frame ratio.
      if (now - windowStarted < 2000 || samples < 4 || samples < 20 && now - windowStarted < 4000) return quality;
      const average = total / samples, slowShare = slow / samples;
      badWindows = average > 25 || slowShare > .45 ? badWindows + 1 : 0;
      goodWindows = average < 18 && slowShare < .03 ? goodWindows + 1 : 0;
      clearWindow();
      if (now - changedAt < 15000) return quality;
      const next = badWindows >= 2 ? Math.max(0, quality - 1) : goodWindows >= 5 ? Math.min(2, quality + 1) : quality;
      if (next !== quality) { quality = next as TableQuality; changedAt = now; reset(now, 1500); }
      return quality;
    },
  };
}
