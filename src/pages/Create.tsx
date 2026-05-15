import React, { useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, type PanInfo } from 'motion/react';
import { ArrowLeft, FileText, Film, ChevronRight, ImagePlus, Video } from 'lucide-react';
import { useReels } from '../contexts/ReelsContext';
import { usePosts } from '../contexts/PostsContext';
import { cn } from '../lib/utils';

type Mode = 'post' | 'reel';
const MODES: Mode[] = ['post', 'reel'];

interface ModeMeta {
  label: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  preview: React.ReactNode;
  cta: string;
}

const MODE_META: Record<Mode, ModeMeta> = {
  post: {
    label: 'Post',
    title: 'Share a Post',
    description: 'Photos and short videos with captions, restaurant or recipe tags. Friends see it on their feed.',
    icon: <FileText size={28} />,
    preview: (
      <div className="w-44 h-56 rounded-2xl bg-on-surface/[0.04] border border-on-surface/[0.08] flex flex-col items-center justify-center gap-2 text-on-surface/35">
        <ImagePlus size={28} />
        <span className="text-[11px] font-bold uppercase tracking-[0.18em]">Photos &amp; text</span>
      </div>
    ),
    cta: 'Start Post',
  },
  reel: {
    label: 'Reel',
    title: 'Share a Reel',
    description: 'A short vertical food video with audio, dish tag, and the restaurant it came from.',
    icon: <Film size={28} />,
    preview: (
      <div className="w-44 h-56 rounded-2xl bg-on-surface/[0.04] border border-on-surface/[0.08] flex flex-col items-center justify-center gap-2 text-on-surface/35">
        <Video size={28} />
        <span className="text-[11px] font-bold uppercase tracking-[0.18em]">Vertical video</span>
      </div>
    ),
    cta: 'Start Reel',
  },
};

export const Create: React.FC = () => {
  const navigate = useNavigate();
  const { openAddPostModal } = usePosts();
  const { openAddReelModal } = useReels();

  const [mode, setMode] = useState<Mode>('post');
  const idx = MODES.indexOf(mode);

  const close = () => navigate('/');

  const begin = () => {
    if (mode === 'post') openAddPostModal();
    else openAddReelModal();
  };

  // Horizontal swipe on the content area changes mode — same gesture
  // Instagram uses on its create surface.
  const onContentDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -60 && idx < MODES.length - 1) setMode(MODES[idx + 1]);
    else if (info.offset.x > 60 && idx > 0) setMode(MODES[idx - 1]);
  };

  // Measure each tab so the underline indicator slides cleanly between
  // them regardless of label length / font metrics.
  const tabRefs = useRef<Record<Mode, HTMLButtonElement | null>>({ post: null, reel: null });
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = useState<{ x: number; w: number }>({ x: 0, w: 0 });
  useLayoutEffect(() => {
    const btn = tabRefs.current[mode];
    const track = trackRef.current;
    if (!btn || !track) return;
    const btnRect = btn.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    setIndicator({ x: btnRect.left - trackRect.left, w: btnRect.width });
  }, [mode]);

  const meta = MODE_META[mode];

  return (
    <div className="min-h-screen flex flex-col bg-surface text-on-surface">
      {/* Top bar */}
      <header className="flex-shrink-0 px-4 pt-safe-4 pb-2 grid grid-cols-[1fr_auto_1fr] items-center">
        <div className="flex items-center justify-start">
          <button
            onClick={close}
            aria-label="Close"
            className="w-10 h-10 rounded-full bg-on-surface/5 hover:bg-on-surface/10 flex items-center justify-center text-on-surface/70 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
        </div>
        <h1 className="text-base font-serif font-bold tracking-tight">Create</h1>
        <div />
      </header>

      {/* Content area — swipe horizontally to switch modes. */}
      <motion.div
        className="flex-1 flex flex-col items-center justify-center px-6 select-none"
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.18}
        dragMomentum={false}
        onDragEnd={onContentDragEnd}
        style={{ touchAction: 'pan-y' }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="flex flex-col items-center text-center max-w-sm"
          >
            <div className="mb-7">{meta.preview}</div>
            <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
              {meta.icon}
            </div>
            <h2 className="text-[22px] font-serif font-bold mb-2 leading-tight">{meta.title}</h2>
            <p className="text-[13.5px] text-on-surface/55 leading-relaxed mb-7 px-2">{meta.description}</p>
            <button
              onClick={begin}
              className="inline-flex items-center gap-2 bg-primary text-white px-7 py-3 rounded-full font-semibold text-[14px] shadow-sm hover:bg-primary/90 active:scale-[0.98] transition-all"
            >
              {meta.cta}
              <ChevronRight size={16} />
            </button>
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* Bottom mode picker — Instagram-style centered carousel. The
          selected label is opaque and large; the other shrinks and
          dims. A pill indicator slides under the active tab. */}
      <div className="flex-shrink-0 pb-10 pt-3">
        <div ref={trackRef} className="relative flex items-center justify-center gap-10 px-6">
          {MODES.map((m) => (
            <button
              key={m}
              ref={(el) => { tabRefs.current[m] = el; }}
              onClick={() => setMode(m)}
              className={cn(
                'uppercase tracking-[0.22em] text-[13px] font-bold py-1 transition-all duration-200',
                m === mode ? 'text-on-surface scale-100' : 'text-on-surface/35 scale-90',
              )}
            >
              {MODE_META[m].label}
            </button>
          ))}
          {indicator.w > 0 && (
            <motion.span
              className="absolute -bottom-1 h-[3px] rounded-full bg-primary"
              animate={{ x: indicator.x, width: indicator.w }}
              transition={{ type: 'spring', damping: 28, stiffness: 360 }}
              style={{ left: 0 }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
