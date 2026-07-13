// /create — the plus-button page. YouTube-Shorts-style creation hub:
// the bottom is an infinite wheel carousel of the three actions (Post,
// Guide, Recipe — momentum, always-centered selection, faded
// neighbors), and the area above it IS the selected action's surface,
// live and usable immediately — no "Start X" button:
//
//   Post   — pick media + write the caption right here (Instagram-style
//            media-first: a single video continues as a reel, anything
//            else as a post); Continue hands it into the right composer.
//   Guide  — choose the guide type and name it; Continue opens the
//            wizard pre-filled.
//   Recipe — the four ways in (link / photo / scratch / AI), one tap
//            deep-links into that flow.
//
// All surfaces stay mounted so half-written input survives wheel
// spins. The full flows open as the usual overlays above this page.

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, ImagePlus, Film, ChefHat, ArrowRight, Link2, Camera, PenLine,
  Sparkles, ChevronRight, MapPin,
} from 'lucide-react';
import { useGuideCreator } from '../contexts/GuideCreatorContext';
import { useLists } from '../contexts/ListsContext';
import { useUnifiedComposer, routesToReel } from '../components/useUnifiedComposer';
import type { GuideType } from '../lib/supabase-guides';
import { cn } from '../lib/utils';

type Mode = 'post' | 'guide' | 'recipe';
const MODES: Mode[] = ['post', 'guide', 'recipe'];
const MODE_LABELS: Record<Mode, string> = { post: 'Post', guide: 'Guide', recipe: 'Recipe' };

const mod = (n: number, m: number) => ((n % m) + m) % m;

/* ── Infinite mode wheel ──────────────────────────────────────────
   Horizontal looping carousel, iOS-camera-style: drag with momentum,
   the selected label always snaps to center, neighbors fade + shrink,
   tapping a side label glides to it. Pointer-driven (not native
   scroll) so the loop is seamless in both directions.               */

const ITEM_W = 92;
const WHEEL_MASK =
  'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.5) 18%, black 34%, black 66%, rgba(0,0,0,0.5) 82%, transparent 100%)';

const ModeWheel: React.FC<{
  count: number;
  labels: string[];
  onChange: (idx: number) => void;
}> = ({ count, labels, onChange }) => {
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const lastXRef = useRef(0);
  const movedRef = useRef(0);
  const lastTimeRef = useRef(0);
  const velRef = useRef(0);
  const lastReportedRef = useRef(0);

  const setOff = (v: number) => { offsetRef.current = v; setOffset(v); };

  const reportRef = useRef<(off: number) => void>(() => {});
  reportRef.current = (off: number) => {
    const v = mod(Math.round(off), count);
    if (v !== lastReportedRef.current) {
      lastReportedRef.current = v;
      onChange(v);
    }
  };
  const report = (off: number) => reportRef.current(off);

  const stopAnim = () => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  };

  const settleTo = (target?: number) => {
    const t = target ?? Math.round(offsetRef.current);
    stopAnim();
    const step = () => {
      const diff = t - offsetRef.current;
      if (Math.abs(diff) < 0.004) {
        setOff(t);
        report(t);
        rafRef.current = null;
        return;
      }
      setOff(offsetRef.current + diff * 0.22);
      report(offsetRef.current);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  const momentum = () => {
    stopAnim();
    const step = () => {
      velRef.current *= 0.93;
      const next = offsetRef.current + velRef.current;
      setOff(next);
      report(next);
      if (Math.abs(velRef.current) < 0.02) {
        rafRef.current = null;
        settleTo();
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  useEffect(() => () => stopAnim(), []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    stopAnim();
    lastXRef.current = e.clientX;
    movedRef.current = 0;
    velRef.current = 0;
    lastTimeRef.current = performance.now();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - lastXRef.current;
    lastXRef.current = e.clientX;
    movedRef.current += Math.abs(dx);
    const now = performance.now();
    const dt = Math.max(1, now - lastTimeRef.current);
    lastTimeRef.current = now;
    const dItems = -dx / ITEM_W;
    velRef.current = dItems * (16.7 / dt);
    const next = offsetRef.current + dItems;
    setOff(next);
    report(next);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (movedRef.current < 6) {
      // Tap — glide to the tapped label.
      const rect = e.currentTarget.getBoundingClientRect();
      const delta = Math.round((e.clientX - (rect.left + rect.width / 2)) / ITEM_W);
      settleTo(Math.round(offsetRef.current) + delta);
      return;
    }
    if (Math.abs(velRef.current) > 0.05) momentum();
    else settleTo();
  };

  // Labels around the current position (center ± 3 covers the mask).
  const first = Math.floor(offset) - 3;
  const items: Array<{ k: number; label: string; d: number }> = [];
  for (let k = first; k <= first + 7; k++) {
    items.push({ k, label: labels[mod(k, count)], d: k - offset });
  }

  return (
    <div className="flex flex-col items-center">
      <div
        className="relative w-full max-w-sm h-11 overflow-hidden select-none cursor-ew-resize"
        style={{ touchAction: 'none', WebkitMaskImage: WHEEL_MASK, maskImage: WHEEL_MASK }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="tablist"
        aria-label="Creation mode"
      >
        {items.map(({ k, label, d }) => {
          const dist = Math.min(Math.abs(d), 2.4);
          return (
            <span
              key={k}
              className="absolute top-1/2 left-1/2 flex items-center justify-center uppercase font-bold text-[12.5px] tracking-[0.2em] text-on-surface whitespace-nowrap pointer-events-none"
              style={{
                width: ITEM_W,
                transform: `translate(calc(-50% + ${d * ITEM_W}px), -50%) scale(${1 - dist * 0.07})`,
                opacity: Math.max(0.25, 1 - dist * 0.42),
                willChange: 'transform, opacity',
              }}
              aria-hidden
            >
              {label}
            </span>
          );
        })}
      </div>
      <span className="mt-1 w-1 h-1 rounded-full bg-primary" aria-hidden />
    </div>
  );
};

/* ── Shared surface bits ─────────────────────────────────────────── */

const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/40 mb-3">{children}</div>
);

const ContinueBtn: React.FC<{ label?: string; disabled?: boolean; onClick: () => void }> = ({ label = 'Continue', disabled, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'inline-flex items-center gap-2 px-7 py-3 rounded-full font-semibold text-[14px] transition-all active:scale-[0.98]',
      disabled
        ? 'bg-on-surface/[0.07] text-on-surface/35'
        : 'bg-primary text-white shadow-sm hover:bg-primary/90',
    )}
  >
    {label}
    <ArrowRight size={15} strokeWidth={2.2} />
  </button>
);

/* ── Post surface — media-first, Instagram-style ──────────────────
   One surface covers both posts and reels: pick photos and/or videos,
   and the selection decides where Continue goes — exactly one video
   routes into the reel editor (already loaded), anything else into
   the post composer with the caption carried along.                 */

const PostSurface: React.FC = () => {
  const openComposer = useUnifiedComposer();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Revoke preview URLs on unmount.
  useEffect(() => () => { previews.forEach((u) => URL.revokeObjectURL(u)); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list).filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (picked.length === 0) return;
    setFiles((prev) => [...prev, ...picked]);
    setPreviews((prev) => [...prev, ...picked.map((f) => URL.createObjectURL(f))]);
  };

  const removeAt = (i: number) => {
    URL.revokeObjectURL(previews[i]);
    setFiles((prev) => prev.filter((_, j) => j !== i));
    setPreviews((prev) => prev.filter((_, j) => j !== i));
  };

  const isReel = routesToReel(files);
  const canContinue = files.length > 0 || caption.trim().length > 0;

  const handleContinue = () => {
    openComposer(files, caption.trim());
    previews.forEach((u) => URL.revokeObjectURL(u));
    setFiles([]);
    setPreviews([]);
    setCaption('');
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <Eyebrow>Share a post</Eyebrow>

      <div className="flex gap-2.5 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
        {previews.map((url, i) => (
          <div key={url} className="relative flex-shrink-0 w-[96px] h-[128px] rounded-2xl overflow-hidden border border-on-surface/[0.08] bg-on-surface/[0.04]">
            {files[i]?.type.startsWith('video/') ? (
              <video src={url} muted playsInline className="w-full h-full object-cover" />
            ) : (
              <img src={url} alt="" className="w-full h-full object-cover" />
            )}
            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label="Remove"
              className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 backdrop-blur-sm text-white flex items-center justify-center"
            >
              <X size={12} strokeWidth={2.6} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex-shrink-0 rounded-2xl border-[1.5px] border-dashed border-on-surface/20 text-on-surface/45',
            'flex flex-col items-center justify-center gap-2 transition-colors hover:border-primary hover:text-primary',
            previews.length > 0 ? 'w-[96px] h-[128px]' : 'w-full h-[128px]',
          )}
        >
          <ImagePlus size={22} />
          <span className="text-[11px] font-bold uppercase tracking-[0.14em]">
            {previews.length > 0 ? 'Add' : 'Add photos or video'}
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi,.3gp,.qt,.hevc"
          multiple
          className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {isReel ? (
        // A lone video continues as a reel — the reel editor has its own
        // caption field, so swap the textarea for a heads-up instead.
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-primary/[0.05] border border-primary/15 px-4 py-3.5">
          <span className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            <Film size={16} />
          </span>
          <p className="text-[12.5px] leading-snug text-on-surface/70">
            <span className="font-bold text-on-surface">One video — this continues as a reel.</span>
            <br />Add a photo to make it a post instead.
          </p>
        </div>
      ) : (
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Write a caption…"
          rows={4}
          className="w-full mt-3 rounded-2xl bg-on-surface/[0.04] border border-on-surface/[0.08] p-4 text-[15px] leading-relaxed placeholder:text-on-surface/35 focus:outline-none focus:border-primary/50 resize-none"
        />
      )}

      <div className="mt-4 flex justify-end">
        <ContinueBtn disabled={!canContinue} onClick={handleContinue} />
      </div>
    </div>
  );
};

/* ── Guide surface — type + title, wizard opens pre-filled ───────── */

const GuideSurface: React.FC = () => {
  const { openGuideCreator } = useGuideCreator();
  const [type, setType] = useState<GuideType>('restaurants');
  const [title, setTitle] = useState('');

  const handleContinue = () => {
    openGuideCreator(null, { seed: { type, title: title.trim() } });
    setTitle('');
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <Eyebrow>Build a guide</Eyebrow>

      <div className="grid grid-cols-2 gap-2.5">
        {([
          { key: 'restaurants' as GuideType, label: 'Restaurants', sub: 'Places to eat & drink', icon: <MapPin size={16} /> },
          { key: 'recipes' as GuideType, label: 'Recipes', sub: 'Things to cook at home', icon: <ChefHat size={16} /> },
        ]).map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => setType(o.key)}
            className={cn(
              'flex flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-all',
              type === o.key
                ? 'border-primary ring-1 ring-primary bg-primary/[0.04]'
                : 'border-on-surface/[0.1] hover:border-on-surface/25',
            )}
          >
            <span className={cn('mb-1.5 w-9 h-9 rounded-full flex items-center justify-center',
              type === o.key ? 'bg-primary/10 text-primary' : 'bg-on-surface/[0.05] text-on-surface/45')}>
              {o.icon}
            </span>
            <span className="text-[14px] font-semibold">{o.label}</span>
            <span className="text-[11.5px] text-on-surface/45 leading-snug">{o.sub}</span>
          </button>
        ))}
      </div>

      <div className="mt-6">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-on-surface/40 mb-1.5">Title</div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={type === 'recipes' ? 'Weeknight comfort classics' : 'Best pasta in the Village'}
          maxLength={80}
          className="w-full bg-transparent border-0 border-b-[1.5px] border-on-surface/15 focus:border-primary focus:outline-none py-2 font-serif font-semibold text-[21px] placeholder:text-on-surface/25"
        />
      </div>

      <div className="mt-6 flex justify-end">
        <ContinueBtn onClick={handleContinue} />
      </div>
    </div>
  );
};

/* ── Recipe surface — the four ways in, one tap deep ─────────────── */

const RecipeSurface: React.FC = () => {
  const { openHomeMealModal } = useLists();

  const methods: Array<{ key: 'link' | 'photo' | 'custom' | 'ai'; icon: React.ReactNode; title: string; sub: string }> = [
    { key: 'link', icon: <Link2 size={17} strokeWidth={2} />, title: 'From a web link', sub: 'Paste a link from any recipe site' },
    { key: 'photo', icon: <Camera size={17} strokeWidth={2} />, title: 'From a photo', sub: 'A cookbook page, screenshot, or card' },
    { key: 'custom', icon: <PenLine size={17} strokeWidth={2} />, title: 'Start from scratch', sub: 'Build it step by step' },
    { key: 'ai', icon: <Sparkles size={17} strokeWidth={2} />, title: 'Create with AI', sub: 'Describe it, get a complete draft' },
  ];

  return (
    <div className="w-full max-w-md mx-auto">
      <Eyebrow>Add a recipe</Eyebrow>
      <div>
        {methods.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => openHomeMealModal(undefined, { initialMethod: m.key })}
            className="w-full flex items-center gap-3.5 py-3.5 text-left border-b border-on-surface/[0.07] last:border-0 active:bg-on-surface/[0.03] transition-colors"
          >
            <span className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
              {m.icon}
            </span>
            <span className="flex flex-col gap-0.5 flex-1 min-w-0">
              <span className="text-[15px] font-semibold">{m.title}</span>
              <span className="text-[12.5px] text-on-surface/45">{m.sub}</span>
            </span>
            <ChevronRight size={15} className="text-on-surface/30 flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
};

/* ── Page ─────────────────────────────────────────────────────────── */

export const Create: React.FC = () => {
  const navigate = useNavigate();
  const [modeIdx, setModeIdx] = useState(0);
  const mode = MODES[modeIdx];

  return (
    <div className="min-h-screen flex flex-col bg-surface text-on-surface">
      {/* Top bar */}
      <header className="flex-shrink-0 px-4 pt-safe-4 pb-2 grid grid-cols-[1fr_auto_1fr] items-center">
        <div className="flex items-center justify-start">
          <button
            onClick={() => navigate('/')}
            aria-label="Close"
            className="w-10 h-10 rounded-full bg-on-surface/5 hover:bg-on-surface/10 flex items-center justify-center text-on-surface/70 transition-colors"
          >
            <X size={19} />
          </button>
        </div>
        <h1 className="text-base font-serif font-bold tracking-tight">Create</h1>
        <div />
      </header>

      {/* Live surfaces — all mounted so half-written input survives
          wheel spins; only the active one is visible + interactive. */}
      <div className="relative flex-1 min-h-0">
        {MODES.map((m) => {
          const active = m === mode;
          return (
            <div
              key={m}
              className={cn(
                'absolute inset-0 overflow-y-auto px-5 pt-4 pb-6 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                active ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none',
              )}
              aria-hidden={!active}
            >
              {m === 'post' && <PostSurface />}
              {m === 'guide' && <GuideSurface />}
              {m === 'recipe' && <RecipeSurface />}
            </div>
          );
        })}
      </div>

      {/* Infinite mode wheel */}
      <div className="flex-shrink-0 pt-2 pb-safe-6">
        <ModeWheel
          count={MODES.length}
          labels={MODES.map((m) => MODE_LABELS[m])}
          onChange={setModeIdx}
        />
      </div>
    </div>
  );
};
