import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { SKELETON_PULSE } from './LoadingSkeleton';
import { acquireHardScrollLock } from '../lib/useBottomSheet';
import { pushOverlay } from '../lib/overlay-registry';

function EditorPlaceholder({ label, dismiss, failed, retry }: { label: string; dismiss: () => void; failed: boolean; retry: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    const release = pushOverlay({ dimPresenter: false });
    const unlock = acquireHardScrollLock();
    return () => { dialog.close(); release(); unlock(); };
  }, []);
  return createPortal(<dialog ref={dialogRef} aria-label={label}
    className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 text-on-surface backdrop:bg-black/50"
    onCancel={event => { event.preventDefault(); dismiss(); }}
    onClick={event => { if (event.target === event.currentTarget) dismiss(); }}>
    <div className="absolute bottom-0 left-0 right-0 mx-auto max-h-[90dvh] overflow-y-auto rounded-t-3xl bg-surface pb-safe-4 sm:bottom-auto sm:top-1/2 sm:max-w-lg sm:-translate-y-1/2 sm:rounded-3xl">
      <header className="flex items-center justify-between gap-4 px-5 pt-4">
        <h2 className="font-serif text-xl font-bold">{label}</h2>
        <button type="button" aria-label="Close editor" onClick={dismiss} className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-on-surface/10"><X size={20} /></button>
      </header>
      {failed ? <div role="alert" className="space-y-4 px-5 py-8">
        <p>Couldn't open this editor. Check your connection and try again.</p>
        <button type="button" onClick={retry} className="rounded-full bg-primary px-6 py-3 font-medium text-on-primary">Try again</button>
      </div> : <div role="status" aria-label="Loading editor" aria-busy="true" className="space-y-5 px-5 py-8">
        <span className="sr-only">Loading editor…</span>
        <div aria-hidden="true" className="space-y-5">
          <div className={`${SKELETON_PULSE} h-40 rounded-2xl`} />
          <div className={`${SKELETON_PULSE} h-5 w-1/3 rounded`} />
          <div className={`${SKELETON_PULSE} h-12 rounded-xl`} />
          <div className={`${SKELETON_PULSE} h-24 rounded-xl`} />
        </div>
      </div>}
    </div>
  </dialog>, document.body);
}

/** Import on intent; keep the editor mounted after its first opening so its
 * own dismissal animation, draft cleanup, and later openings stay intact. */
export function lazyEditor<P extends object>(load: () => Promise<{ default: React.ComponentType<P> }>) {
  let pending: ReturnType<typeof load> | undefined;
  let resolved: Awaited<ReturnType<typeof load>> | undefined;
  const preload = () => pending ??= Promise.resolve().then(load).then(module => {
    resolved = module;
    return module;
  }).catch(error => { pending = undefined; throw error; });

  function LazyEditor({ active, dismiss, label, componentProps }: { active: boolean; dismiss: () => void; label: string; componentProps: P }) {
    const [Mounted, setMounted] = React.useState<React.ComponentType<P> | null>(null);
    const [failed, setFailed] = React.useState(false);
    const [attempt, retry] = React.useReducer(value => value + 1, 0);
    const [, refresh] = React.useReducer(value => value + 1, 0);
    const Editor = Mounted ?? (active ? resolved?.default : null);
    // A warmed editor can render immediately without a placeholder flash.
    if (Editor && !Mounted) setMounted(() => Editor);
    React.useEffect(() => {
      if (!active || Editor) return;
      let cancelled = false;
      setFailed(false);
      void preload().then(() => { if (!cancelled) refresh(); }, () => { if (!cancelled) setFailed(true); });
      return () => { cancelled = true; };
    }, [active, Editor, attempt]);
    if (Editor) return <Editor {...componentProps} />;
    if (!active) return null;
    return <EditorPlaceholder label={label} dismiss={dismiss} failed={failed} retry={retry} />;
  }
  return Object.assign(LazyEditor, { preload });
}
