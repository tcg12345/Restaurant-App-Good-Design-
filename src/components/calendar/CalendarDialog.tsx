import React, { useEffect, useLayoutEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { usePlanSheetMotion } from './usePlanSheetMotion';
import { pushOverlay } from '../../lib/overlay-registry';
import { acquireHardScrollLock } from '../../lib/useBottomSheet';

export function CalendarDialog({ title, subtitle, onClose, children, className = '', eyebrow = 'GOOD THINGS AHEAD', fitKeyboard = false, interactive = false, closeDisabled = false }: { title: string; subtitle?: string; className?: string; eyebrow?: string; fitKeyboard?: boolean; interactive?: boolean; closeDisabled?: boolean; onClose: () => void; children: React.ReactNode | ((close: () => void) => React.ReactNode) }) {
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const focused = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const release = pushOverlay({ dimPresenter: false });
    const unlock = acquireHardScrollLock();
    return () => { dialog.close(); release(); unlock(); focused?.focus?.({ preventScroll: true }); };
  }, []);
  const sheet = usePlanSheetMotion(panel, interactive, closeDisabled, () => closeRef.current());
  useEffect(() => {
    if (!fitKeyboard) return;
    const dialog = ref.current!;
    const viewport = window.visualViewport;
    let frame = 0;
    const revealField = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const field = document.activeElement as HTMLElement | null;
        const scroller = field?.closest('.plan-editor-scroll');
        if (!field || !scroller || !dialog.contains(field)) return;
        const bounds = scroller.getBoundingClientRect(), input = field.getBoundingClientRect();
        if (input.bottom > bounds.bottom || input.top < bounds.top) field.scrollIntoView({ block: 'nearest' });
      });
    };
    const resize = () => {
      dialog.style.setProperty('--plan-visible-height', `${viewport?.height ?? window.innerHeight}px`);
      dialog.style.setProperty('--plan-bottom-inset', `${Math.max(0, window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0))}px`);
      revealField();
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    dialog.addEventListener('focusin', revealField);
    // Native keyboards change --app-vh without resizing the visual viewport.
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(revealField) : null;
    const scroller = dialog.querySelector('.plan-editor-scroll');
    if (scroller) observer?.observe(scroller);
    return () => {
      cancelAnimationFrame(frame); observer?.disconnect();
      viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize);
      dialog.removeEventListener('focusin', revealField);
    };
  }, [fitKeyboard]);
  const content = <>
    {interactive && <div className="plan-sheet-grabber" aria-hidden="true" {...sheet.dragHandlers}><span /></div>}
    <header {...(interactive ? sheet.dragHandlers : {})}><div><span className="meal-eyebrow">{eyebrow}</span><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="meal-icon-button" disabled={closeDisabled} onClick={sheet.requestClose} aria-label="Close dialog"><X size={20} /></button></header>
    {typeof children === 'function' ? children(sheet.requestClose) : children}
  </>;
  return createPortal(<dialog ref={ref} className={`meal-dialog ${className} ${interactive ? 'meal-sheet-dialog' : ''}`} aria-labelledby={titleId}
    onCancel={e => { e.preventDefault(); sheet.requestClose(); }} onClick={e => { if (e.target === e.currentTarget) sheet.requestClose(); }}>
    {interactive ? <>
      <motion.div className="plan-sheet-backdrop" style={{ opacity: sheet.backdrop }} aria-hidden="true" onClick={sheet.requestClose} />
      <motion.div ref={panel} className="meal-dialog-inner" style={{ y: sheet.y }}>{content}</motion.div>
    </> : <div ref={panel} className="meal-dialog-inner">{content}</div>}
  </dialog>, document.body);
}
