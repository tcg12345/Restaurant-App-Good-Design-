import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Play, Settings, RefreshCw, Check, Camera } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  PhotoLibrary,
  type MediaItem,
  type MediaTypeFilter,
  type PhotoPermissionStatus,
} from '../lib/native-photos';

interface Props {
  /** What to list from the camera roll. */
  mediaType: MediaTypeFilter;
  /** Fired when the user taps a thumbnail. The caller decides whether
   *  that's a single replace or a toggle in/out of `selectedIds`. */
  onSelect: (item: MediaItem) => void;
  /** Ordered list of currently-selected ids. In `multi` mode the order
   *  drives the numbered badges on the thumbnails. */
  selectedIds?: string[];
  /** `single`: tap replaces the selection, show a check on the picked
   *  thumb. `multi`: tap toggles into an ordered selection, show 1-based
   *  position badges. Default `single`. */
  selectionMode?: 'single' | 'multi';
  /** Initial page size. Subsequent pages fetched via infinite-scroll. */
  pageSize?: number;
  /** Optional Tailwind className applied to the outer scroller. */
  className?: string;
  /** Number of columns in the thumbnail grid. Defaults to 4. */
  columns?: number;
  /** If provided, the first cell of the grid renders as a camera button
   *  that fires this callback. The caller is responsible for actually
   *  opening the camera (we just provide the affordance). */
  onCameraTap?: () => void;
}

const COLS = 4;

/**
 * Instagram-style inline grid of the user's camera roll. Drives a custom
 * Swift Capacitor plugin (PhotoLibrary) rather than the system picker
 * sheet, so the photos load directly into the page without an extra tap.
 *
 * Permission flow:
 *   - On mount, check current PhotoKit authorisation status.
 *   - If `notDetermined`, render a small primer + a button that triggers
 *     iOS's native permission dialog.
 *   - If `denied`/`restricted`, render a recovery state with a button
 *     that deep-links to Settings.
 *   - If `limited` (user picked specific photos), render the limited set
 *     plus a banner explaining how to grant full access.
 *   - If `authorized`, render the full grid with infinite scroll.
 */
export const PhotoLibraryGrid: React.FC<Props> = ({
  mediaType,
  onSelect,
  selectedIds,
  selectionMode = 'single',
  pageSize = 48,
  className,
  onCameraTap,
  columns = COLS,
}) => {
  const [status, setStatus] = useState<PhotoPermissionStatus | 'loading'>('loading');
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Guard against double-fetches during fast scroll / React strict-mode
  // double-mount in dev.
  const inflightRef = useRef(false);

  const fetchPage = useCallback(
    async (offset: number) => {
      if (inflightRef.current) return;
      inflightRef.current = true;
      try {
        const res = await PhotoLibrary.listMedia({
          mediaType,
          limit: pageSize,
          offset,
        });
        setItems((prev) => (offset === 0 ? res.items : [...prev, ...res.items]));
        setTotal(res.total);
      } catch (err) {
        setError((err as Error).message || 'Failed to read camera roll');
      } finally {
        inflightRef.current = false;
        setLoadingMore(false);
      }
    },
    [mediaType, pageSize],
  );

  // Initial permission probe + first page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await PhotoLibrary.checkPermission();
        if (cancelled) return;
        setStatus(status);
        if (status === 'authorized' || status === 'limited') {
          await fetchPage(0);
        }
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message || 'Could not check photo permission');
        setStatus('denied');
      }
    })();
    return () => { cancelled = true; };
  }, [fetchPage]);

  // Infinite-scroll sentinel. Triggers when the bottom of the grid is
  // within ~400 px of the viewport; ignored if the page is already
  // saturated (items.length >= total) or another fetch is mid-flight.
  useEffect(() => {
    if (status !== 'authorized' && status !== 'limited') return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        if (inflightRef.current) return;
        if (items.length >= total) return;
        setLoadingMore(true);
        void fetchPage(items.length);
      },
      { rootMargin: '400px 0px 400px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [status, items.length, total, fetchPage]);

  const requestPermission = useCallback(async () => {
    try {
      const { status } = await PhotoLibrary.requestPermission();
      setStatus(status);
      if (status === 'authorized' || status === 'limited') {
        await fetchPage(0);
      }
    } catch (err) {
      setError((err as Error).message || 'Permission request failed');
    }
  }, [fetchPage]);

  if (status === 'loading') {
    return (
      <div className={cn('grid gap-[2px]', className)} style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="aspect-square bg-on-surface/[0.04] animate-pulse" />
        ))}
      </div>
    );
  }

  if (status === 'notDetermined') {
    return (
      <PermissionPrimer
        title="Show your photos here"
        body="Grant access to your camera roll so you can pick something to share without leaving this screen."
        cta="Allow access"
        onAction={requestPermission}
        className={className}
      />
    );
  }

  if (status === 'denied' || status === 'restricted') {
    return (
      <PermissionPrimer
        title="Photo access is off"
        body="Open Settings to enable photo library access for this app."
        cta="Open Settings"
        icon={<Settings size={22} />}
        onAction={() => { void PhotoLibrary.openSettings(); }}
        className={className}
      />
    );
  }

  return (
    <div className={className}>
      {status === 'limited' && (
        <div className="px-3 py-2 mb-1 bg-amber-50 text-amber-900 text-[11.5px] font-medium leading-snug flex items-center justify-between gap-3">
          <span>Showing only the photos you allowed. Grant full access for everything.</span>
          <button
            type="button"
            onClick={() => { void PhotoLibrary.openSettings(); }}
            className="flex-shrink-0 underline font-semibold"
          >
            Open Settings
          </button>
        </div>
      )}
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {onCameraTap && (
          <button
            type="button"
            onClick={onCameraTap}
            className="relative aspect-square bg-on-surface/[0.06] flex flex-col items-center justify-center gap-1 text-on-surface/70 active:bg-on-surface/[0.12] transition-colors"
            aria-label="Take a photo or video"
          >
            <Camera size={26} />
            <span className="text-[10px] font-semibold tracking-wide uppercase">Camera</span>
          </button>
        )}
        {items.map((it) => {
          const selectionIdx = selectedIds ? selectedIds.indexOf(it.id) : -1;
          const isSelected = selectionIdx >= 0;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => onSelect(it)}
              className={cn(
                'relative aspect-square overflow-hidden bg-on-surface/[0.04] transition-opacity',
                isSelected && 'opacity-75',
              )}
              aria-label={it.type === 'video' ? 'Video' : 'Photo'}
              aria-pressed={isSelected}
            >
              {it.thumbnailDataUrl && (
                <img
                  src={it.thumbnailDataUrl}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              )}
              {it.type === 'video' && (
                <>
                  <div className="absolute top-1 left-1 bg-black/55 rounded-full p-[3px]">
                    <Play size={9} className="text-white fill-white" />
                  </div>
                  {typeof it.durationSeconds === 'number' && (
                    <span className="absolute bottom-1 right-1 px-1 py-[1px] text-[9.5px] font-semibold text-white bg-black/55 rounded tabular-nums">
                      {formatDuration(it.durationSeconds)}
                    </span>
                  )}
                </>
              )}
              <span
                className={cn(
                  'absolute top-1 right-1 w-[22px] h-[22px] rounded-full flex items-center justify-center text-[11px] font-bold transition-colors',
                  isSelected
                    ? 'bg-primary text-white shadow-[0_0_0_1.5px_white]'
                    : 'bg-black/30 text-transparent border border-white/70',
                )}
              >
                {isSelected
                  ? (selectionMode === 'multi' ? selectionIdx + 1 : <Check size={12} strokeWidth={3} />)
                  : null}
              </span>
              {isSelected && (
                <div className="absolute inset-0 ring-[3px] ring-primary ring-inset pointer-events-none" />
              )}
            </button>
          );
        })}
      </div>
      {loadingMore && (
        <div className="py-3 flex items-center justify-center text-on-surface/45">
          <RefreshCw size={14} className="animate-spin" />
        </div>
      )}
      {error && (
        <p className="px-3 py-2 text-[11.5px] text-red-600">{error}</p>
      )}
      <div ref={sentinelRef} className="h-1" />
    </div>
  );
};

const PermissionPrimer: React.FC<{
  title: string;
  body: string;
  cta: string;
  icon?: React.ReactNode;
  onAction: () => void;
  className?: string;
}> = ({ title, body, cta, icon, onAction, className }) => (
  <div className={cn('flex flex-col items-center justify-center text-center py-12 px-6', className)}>
    <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
      {icon ?? <ImageIcon size={22} />}
    </div>
    <p className="font-serif font-bold text-[17px] leading-tight">{title}</p>
    <p className="text-[12.5px] text-on-surface/55 mt-1.5 max-w-[280px] leading-relaxed">{body}</p>
    <button
      type="button"
      onClick={onAction}
      className="mt-4 px-5 py-2 rounded-full bg-primary text-white text-[13px] font-semibold"
    >
      {cta}
    </button>
  </div>
);

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}
