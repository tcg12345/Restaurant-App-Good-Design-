import React, { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { acquireHardScrollLock, mergeRefs, useBottomSheet } from '../lib/useBottomSheet';
import { useGlassOccluder } from '../lib/glass-buttons';

/** Full-screen collections keep their own gesture and scroll ownership until exit. */
export function MobilePageSheet({ children, label, onClose, scrollRef, className = '' }: {
  children: React.ReactNode; label: string; onClose: () => void; scrollRef: RefObject<HTMLElement | null>; className?: string;
}) {
  const { sheetRef, dragProps } = useBottomSheet(true, onClose, scrollRef);
  const panel = useRef<HTMLDivElement>(null);
  const glass = useGlassOccluder();
  const ref = useMemo(() => mergeRefs<HTMLDivElement>(panel, sheetRef, glass), [sheetRef, glass]);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const release = acquireHardScrollLock();
    panel.current?.focus({ preventScroll: true });
    return () => { release(); requestAnimationFrame(() => { if (opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true }); }); };
  }, []);
  return <motion.div {...dragProps} ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
    className={`fixed inset-0 z-[110] flex flex-col overflow-hidden bg-surface ${className}`}
    initial={reduced ? false : { y: '100%' }} animate={{ y: 0 }} exit={{ y: reduced ? 0 : '100%', transition: { duration: reduced ? 0 : .2 } }}
    transition={{ duration: reduced ? 0 : .26, ease: [.22, 1, .36, 1] }} dragMomentum={false} dragTransition={{ bounceStiffness: 420, bounceDamping: 40 }}>
    {children}
  </motion.div>;
}
