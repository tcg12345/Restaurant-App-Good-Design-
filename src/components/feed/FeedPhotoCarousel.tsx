import React, { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { FeedPostMedia } from './FeedPost';

/** Keep the original large-photo + two-photo mosaic. Avoid a lone final tile
 * by splitting a four-photo remainder into two pairs. */
export function feedPhotoPages(count: number): number[][] {
  const pages: number[][] = [];
  let start = 0;
  while (start < count) {
    const remaining = count - start;
    const size = remaining === 4 ? 2 : Math.min(3, remaining);
    pages.push(Array.from({ length: size }, (_, i) => start + i));
    start += size;
  }
  return pages;
}

/** Native scroll snapping pages through grids independently of feed scrolling. */
export const FeedPhotoCarousel: React.FC<{
  photos: FeedPostMedia[];
  name: string;
  onOpen: (index: number) => void;
  onError: (id: string) => void;
}> = ({ photos, name, onOpen, onError }) => {
  const track = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [index, setIndex] = useState(0);
  const pages = feedPhotoPages(photos.length);
  const current = Math.max(0, Math.min(index, pages.length - 1));
  const multiple = pages.length > 1;
  const goTo = (next: number) => {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: Math.max(0, Math.min(pages.length - 1, next)) * el.clientWidth,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  // A bounded window keeps large albums from filling the row with dots.
  const dotStart = Math.max(0, Math.min(current - 2, pages.length - 5));

  return <section className="feed-photo-carousel" aria-label={`${name} photos`} aria-roledescription="carousel" data-horizontal-gesture="">
    <div className="feed-photo-track" ref={track}
      onScroll={event => {
        const el = event.currentTarget;
        if (el.clientWidth) setIndex(Math.max(0, Math.min(pages.length - 1, Math.round(el.scrollLeft / el.clientWidth))));
        if (pointer.current) pointer.current.moved = true;
      }}
      onPointerDown={event => { pointer.current = { x: event.clientX, y: event.clientY, moved: false }; }}
      onPointerMove={event => {
        const start = pointer.current;
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) start.moved = true;
      }}
      onPointerCancel={() => { if (pointer.current) pointer.current.moved = true; }}
      onKeyDown={event => {
        if (!multiple) return;
        const next = event.key === 'ArrowRight' ? current + 1 : event.key === 'ArrowLeft' ? current - 1
          : event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : null;
        if (next !== null) {
          event.preventDefault(); goTo(next);
          track.current?.querySelectorAll<HTMLElement>('.feed-photo-page')[Math.max(0, Math.min(pages.length - 1, next))]?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
        }
      }}>
      {pages.map((page, pageIndex) => <div key={page[0]} className={`feed-photo-page has-${page.length}`} role="group" aria-label={`Photos ${page[0] + 1}${page.length > 1 ? ` through ${page[page.length - 1] + 1}` : ''} of ${photos.length}`}>
      {page.map(i => { const photo = photos[i]; return <button className="feed-photo-slide" key={photo.id} type="button"
        tabIndex={pageIndex === current ? 0 : -1}
        aria-label={`Expand photo ${i + 1} of ${photos.length}${photo.caption ? `: ${photo.caption}` : ''}`}
        onClick={event => { if (event.detail === 0 || !pointer.current?.moved) onOpen(i); }}>
        <img src={photo.url} alt={photo.caption || `${name}, photo ${i + 1}`} loading="lazy" decoding="async" draggable={false} referrerPolicy="no-referrer" onError={() => onError(photo.id)} />
        {photo.caption && <span className="feed-photo-caption">{photo.caption}</span>}
      </button>; })}
      </div>)}
    </div>
    {multiple && <>
      <span className="feed-photo-count" aria-live="polite" aria-atomic="true">{pages[current][0] + 1}–{pages[current][pages[current].length - 1] + 1} / {photos.length}</span>
      <button className="feed-photo-arrow is-previous" type="button" aria-label="Previous photo grid" disabled={current === 0} onClick={() => goTo(current - 1)}><ChevronLeft size={19} /></button>
      <button className="feed-photo-arrow is-next" type="button" aria-label="Next photo grid" disabled={current === pages.length - 1} onClick={() => goTo(current + 1)}><ChevronRight size={19} /></button>
      <div className="feed-photo-dots" aria-hidden="true">{pages.slice(dotStart, dotStart + 5).map((page, i) => <span key={page[0]} className={dotStart + i === current ? 'is-current' : ''} />)}</div>
    </>}
  </section>;
}
