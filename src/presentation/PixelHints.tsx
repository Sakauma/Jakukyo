import { createContext, useContext, useEffect, useRef } from 'react';

type Hint = (message?: string) => { title?: string; 'data-pixel-hint'?: string; 'aria-description'?: string };
export const classicHint: Hint = title => ({ title });
export const pixelHint: Hint = message => ({ 'data-pixel-hint': message, 'aria-description': message });
export const GameHints = createContext<Hint>(classicHint);
export const useHintProps = () => useContext(GameHints);

/** Browser title bubbles use an OS font. Keep their text in the accessible
 * description and render one themed bubble for mouse and keyboard users. */
export function PixelHintLayer() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tip = ref.current!, root = tip.parentElement!;
    let owner: HTMLElement | null = null, timer: number | undefined;
    const find = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>('[data-pixel-hint]') : null;
    const hide = () => { window.clearTimeout(timer); tip.hidden = true; owner = null; };
    const show = (target: HTMLElement | null, delay: number) => {
      if (owner === target) return;
      hide(); owner = target;
      if (!target) return;
      timer = window.setTimeout(() => {
        const text = target.dataset.pixelHint;
        if (!text || !target.isConnected || !target.getClientRects().length) { hide(); return; }
        tip.textContent = text; tip.hidden = false;
        const r = target.getBoundingClientRect(), margin = 8;
        const x = Math.min(r.left, innerWidth - tip.offsetWidth - margin);
        const y = r.bottom + margin + tip.offsetHeight <= innerHeight ? r.bottom + margin : r.top - tip.offsetHeight - margin;
        tip.style.left = Math.max(margin, Math.round(x)) + 'px';
        tip.style.top = Math.max(margin, Math.round(y)) + 'px';
      }, delay);
    };
    const over = (e: PointerEvent) => { if (e.pointerType !== 'touch') show(find(e.target), 450); };
    const focus = (e: FocusEvent) => { if (e.target instanceof Element && e.target.matches(':focus-visible')) show(find(e.target), 0); };
    const leave = (e: MouseEvent | FocusEvent) => { if (find(e.relatedTarget) !== owner) hide(); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !owner) return;
      if (!tip.hidden) { e.preventDefault(); e.stopPropagation(); }
      hide();
    };
    const events = new AbortController(), options = { signal: events.signal };
    root.addEventListener('pointerover', over, options); root.addEventListener('pointerout', leave, options);
    root.addEventListener('focusin', focus, options); root.addEventListener('focusout', leave, options);
    root.addEventListener('pointerdown', hide, options);
    window.addEventListener('keydown', key, { ...options, capture: true });
    root.addEventListener('scroll', hide, { ...options, capture: true });
    window.addEventListener('resize', hide, options); window.addEventListener('blur', hide, options);
    return () => { events.abort(); hide(); };
  }, []);
  return <div ref={ref} className="pixel-hint" role="tooltip" hidden />;
}
