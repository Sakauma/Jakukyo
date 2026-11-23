import { useLayoutEffect, useRef } from 'react';

export interface DeskCommand {
  label: string;
  ariaLabel?: string;
  run: () => void;
  disabled?: boolean;
}

/** Keep secondary actions in one place; the native dialog also prevents a
 * backdrop click or an Enter inside the menu from playing the selected tile. */
export function DesktopPlayMenu({ open, onOpen, primary, more }: {
  open: boolean; onOpen: (value: boolean) => void; primary: DeskCommand[]; more: DeskCommand[];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (open && el && !el.open) el.showModal();
  }, [open]);
  const close = () => { ref.current?.close(); onOpen(false); };
  const buttons = (items: DeskCommand[]) => items.map(item => <button key={item.label} type="button"
    aria-label={item.ariaLabel} disabled={item.disabled} onClick={() => { close(); item.run(); }}>{item.label}</button>);
  return <>
    <button type="button" className="desk-nav-button" aria-label="对局菜单" aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? 'desk-play-menu' : undefined} onClick={() => onOpen(true)}>菜单 <span aria-hidden="true">≡</span></button>
    {open && <dialog id="desk-play-menu" className="desk-play-menu" ref={ref} aria-label="对局菜单"
      onCancel={e => { e.preventDefault(); close(); }} onKeyDown={e => e.stopPropagation()}
      onClick={e => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
      }}>
      <header><strong>对局菜单</strong><button type="button" aria-label="关闭对局菜单" onClick={close}>关闭</button></header>
      <div className="desk-command-grid">{buttons(primary)}</div>
      <details><summary>记录与帮助</summary><div className="desk-command-grid">{buttons(more)}</div></details>
    </dialog>}
  </>;
}
