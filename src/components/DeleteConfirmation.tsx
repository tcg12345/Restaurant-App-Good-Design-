import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { LiquidGlass } from '../lib/native-glass';
import { liftOverlayToTopLayer, acquireHardScrollLock } from '../lib/useBottomSheet';
import { pushOverlay } from '../lib/overlay-registry';
import { useSocialDialog } from './social/useSocialDialog';
import './CardActions.css';

/** UIKit owns the confirmation on iOS; the browser keeps an accessible fallback. */
export function DeleteConfirmation({ name, title, message = 'This can’t be undone.', confirmLabel = 'Delete', onCancel, onConfirm }: {
  name?: string; title?: string; message?: string; confirmLabel?: string; onCancel: () => void; onConfirm: () => void;
}) {
  const heading = title || `Delete ${name || 'this item'}?`;
  const [web, setWeb] = useState(Capacitor.getPlatform() !== 'ios');
  const callbacks = useRef({ onCancel, onConfirm }); callbacks.current = { onCancel, onConfirm };
  const request = useRef<Promise<{ confirmed: boolean }> | null>(null);
  const settled = useRef(false);
  const finish = (confirmed: boolean) => {
    if (settled.current) return;
    settled.current = true;
    callbacks.current[confirmed ? 'onConfirm' : 'onCancel']();
  };
  useEffect(() => {
    if (web) return;
    let active = true;
    // Retain one request across React Strict Mode's effect replay.
    request.current ||= LiquidGlass.confirmDestructive({ title: heading, message, confirmLabel });
    void request.current.then(result => { if (active) finish(result.confirmed); }).catch(() => { if (active) setWeb(true); });
    return () => { active = false; };
  }, [web, heading, message, confirmLabel]);
  const ref = useSocialDialog(web, () => finish(false));
  useLayoutEffect(() => {
    const release = pushOverlay(), releaseLock = acquireHardScrollLock();
    if (web) liftOverlayToTopLayer(ref.current);
    return () => { release(); releaseLock(); };
  }, [web]);
  if (!web) return null;
  return createPortal(<div ref={ref} className="card-confirm-layer" onClick={e => { if (e.target === e.currentTarget) finish(false); }}>
    <div className="card-confirm" role="alertdialog" aria-modal="true" aria-labelledby="card-delete-title" aria-describedby="card-delete-message">
      <h2 id="card-delete-title">{heading}</h2><p id="card-delete-message">{message}</p>
      <div><button type="button" onClick={() => finish(false)}>Cancel</button><button type="button" className="is-danger" onClick={() => finish(true)}>{confirmLabel}</button></div>
    </div>
  </div>, document.body);
}
