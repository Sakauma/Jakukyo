import { useEffect, useState } from 'react';
import type { WinEffect } from './winEffects';

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(query.matches); query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return reduced;
}

export function WinCelebration({ effect, reduced, dismiss }: { effect: WinEffect; reduced: boolean; dismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(dismiss, reduced ? 1200 : 2800);
    return () => clearTimeout(timer);
  }, [effect.id, reduced]);
  return <div className={`win-celebration win-tier-${effect.tier} ${reduced ? 'reduced-motion' : ''}`} role="dialog" aria-modal="true" aria-label={effect.preview ? '和牌特效预览' : '大牌和了'}>
    <button className="effect-skip" onClick={dismiss}>{effect.preview ? '结束预览' : '跳过 · 查看结算'}</button>
    <div className="celebration-halo" />
    <div className="celebration-copy"><div className="celebration-eyebrow">{effect.preview ? '特效预览' : `${effect.playerName} · 和了`}</div><h2>{effect.title}</h2><div className="celebration-line" /><p>{effect.subtitle}</p></div>
  </div>;
}
