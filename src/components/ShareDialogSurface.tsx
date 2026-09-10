import { PhotoImage } from './PhotoImage';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { X, Search, Users, Check, Send, Loader2, Share2 } from 'lucide-react';
import { useBottomSheet, liftOverlayToTopLayer, acquireHardScrollLock, mergeRefs } from '../lib/useBottomSheet';
import { useGlassOccluder } from '../lib/glass-buttons';
import type { QuickAction, ShareTarget } from './ShareDialog';
import './ShareDialog.css';

const Thumbnail: React.FC<{ src?: string | null; fallback: React.ReactNode }> = ({ src, fallback }) => {
  const [failed, setFailed] = useState(false);
  return <>{fallback}{src && !failed && <PhotoImage src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}</>;
}

/** The mounted surface owns focus, native chrome, and scroll until its exit finishes. */
export const ShareDialogSurface: React.FC<{
  phoneMode: boolean;
  header: { cover: string | null; icon: React.ReactNode; title: string; subtitle: string };
  targets: ShareTarget[]; hasTargets: boolean;
  search: string; onSearch: (value: string) => void;
  selected: Set<string>; onToggle: (key: string) => void;
  message: string; onMessage: (value: string) => void;
  phase: 'idle' | 'sending' | 'sent'; onSend: () => void;
  onClose: () => void; actions: QuickAction[];
}> = ({ phoneMode, header, targets, hasTargets, search, onSearch, selected, onToggle, message, onMessage, phase, onSend, onClose, actions }) => {
  const reduced = useReducedMotion();
  const layer = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null);
  const occlude = useGlassOccluder();
  const layerRef = useCallback((el: HTMLDivElement | null) => { layer.current = el; occlude(el); }, [occlude]);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const scroll = useRef<HTMLDivElement>(null);
  const { dragProps, sheetRef } = useBottomSheet(true, onClose, scroll);
  const panelRef = React.useMemo(() => mergeRefs<HTMLDivElement>(panel, sheetRef), [sheetRef]);
  const [viewport, setViewport] = useState<{ width: number; height: number; left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const release = acquireHardScrollLock();
    liftOverlayToTopLayer(layer.current);
    const update = () => { const v = window.visualViewport; if (v) setViewport({ width: v.width, height: v.height, left: v.offsetLeft, top: v.offsetTop }); };
    update(); window.visualViewport?.addEventListener('resize', update); window.visualViewport?.addEventListener('scroll', update);
    panel.current?.focus({ preventScroll: true });
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from<HTMLElement>(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') || []).filter(el => el.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('keydown', keyboard);
      window.visualViewport?.removeEventListener('resize', update); window.visualViewport?.removeEventListener('scroll', update);
      release();
      if (document.activeElement === document.body || layer.current?.contains(document.activeElement)) previous?.focus({ preventScroll: true });
    };
  }, []);
  const active = selected.size > 0;
  const primary = actions.filter(action => action.key === 'copy' || action.key === 'more');
  const secondary = actions.filter(action => action.key !== 'copy' && action.key !== 'more');

  return <motion.div ref={layerRef} className={`share-glass-layer${phoneMode ? ' is-phone' : ''}`}
    style={viewport ? { ...viewport, right: 'auto', bottom: 'auto' } : undefined}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .28 }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <motion.div {...dragProps} ref={panelRef} className="share-glass-sheet" role="dialog" aria-modal="true" aria-label={`Share ${header.title}`} tabIndex={-1}
      initial={reduced ? false : { y: '100%' }} animate={{ y: 0 }} exit={{ y: reduced ? 0 : '100%', transition: { duration: reduced ? 0 : .28, ease: [.32, .72, 0, 1] } }}
      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 370, damping: 38 }}
      dragMomentum={false} dragSnapToOrigin dragTransition={{ bounceStiffness: 370, bounceDamping: 38 }}>
      <div className="share-glass-handle" aria-hidden="true"><span /></div>
      <header className="share-glass-toolbar"><h2>Share</h2><button type="button" className="share-glass-close" onClick={onClose} aria-label="Close share sheet"><X size={20} /></button></header>
      <div ref={scroll} className="share-glass-scroll">
        <div className="share-glass-preview">
          <div className="share-glass-cover"><Thumbnail key={header.cover} src={header.cover} fallback={header.icon || <Share2 size={22} />} /></div>
          <div><h3>{header.title}</h3>{header.subtitle && <p>{header.subtitle}</p>}</div>
        </div>
        {(hasTargets || search) && <>
          <label data-search-field className="share-glass-search"><Search size={18} /><input data-search-input="embedded" value={search} onChange={event => onSearch(event.target.value)} placeholder="People and groups" aria-label="Search people and groups" />{search && <button type="button" onClick={() => onSearch('')} aria-label="Clear search"><X size={16} /></button>}</label>
          <div className="share-glass-section-title"><span>{search.trim() ? 'Search results' : 'Send in GoodEats'}</span>{active && <span>{selected.size} selected</span>}</div>
        </>}
        {!hasTargets ? <p className="share-glass-empty">Good food is better shared. Send a link with any of the options below.</p>
          : !targets.length ? <p className="share-glass-empty">No people or groups found.</p>
          : <div className={`share-glass-people${search.trim() ? ' is-searching' : ''}`} data-horizontal-gesture="">
            {targets.map(target => <button type="button" key={target.key} className="share-glass-person" aria-label={target.name} aria-pressed={selected.has(target.key)} disabled={phase !== 'idle'} onClick={() => onToggle(target.key)}>
              <span className="share-glass-avatar"><Thumbnail key={target.kind === 'friend' ? target.avatarUrl : target.key} src={target.kind === 'friend' ? target.avatarUrl : null} fallback={target.kind === 'friend' ? target.initials : <Users size={24} />} />{selected.has(target.key) && <i><Check size={12} strokeWidth={3} /></i>}</span>
              <strong>{target.kind === 'friend' ? target.name.split(' ')[0] : target.name}</strong>
              {target.kind === 'group' && <small>{target.participantCount} people</small>}
            </button>)}
          </div>}
      </div>
      <footer className="share-glass-footer">
        {active ? <motion.div className="share-glass-compose" initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .18 }}>
          <input value={message} onChange={event => onMessage(event.target.value)} aria-label="Add a message" placeholder="Add a message…" maxLength={280} disabled={phase !== 'idle'} />
          <button type="button" className="share-glass-send" aria-label={phase === 'sent' ? 'Sent' : phase === 'sending' ? 'Sending' : selected.size > 1 ? `Send to ${selected.size}` : 'Send message'} aria-busy={phase === 'sending'} disabled={phase !== 'idle'} onClick={onSend}>
            {phase === 'sending' ? <Loader2 size={18} className="animate-spin" /> : phase === 'sent' ? <Check size={18} /> : <Send size={18} />}
            <span role="status">{phase === 'sent' ? 'Sent' : phase === 'sending' ? 'Sending…' : selected.size > 1 ? `Send to ${selected.size}` : 'Send message'}</span>
          </button>
        </motion.div> : <motion.div className="share-glass-options" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .18 }}>
          <div className="share-glass-primary">{primary.map(action => <button type="button" key={action.key} onClick={action.onClick}>{action.key === 'more' ? <Share2 size={19} /> : action.icon}<span>{action.label}</span></button>)}</div>
          <div className="share-glass-secondary">{secondary.map(action => <button type="button" key={action.key} onClick={action.onClick}>{action.icon}<span>{action.label}</span></button>)}</div>
        </motion.div>}
      </footer>
    </motion.div>
  </motion.div>;
};
