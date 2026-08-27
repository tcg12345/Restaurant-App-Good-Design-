import React from 'react';
import { LoadingSkeletonList } from 'gourmet-canvas';

/**
 * `count` placeholders of one variant, so callers don't map an array inline.
 *
 * The wrapper is deliberately thin: for `variant="card"` it lays the items
 * out as a two-column grid with a 12px gap; for every other variant it is a
 * plain `div`, and the items stack. `className` styles that wrapper and
 * `itemClassName` each item, which is how the real call sites add the
 * hairline dividers between rows.
 */

/** Exactly what the Search tab renders while a query is in flight:
 *  six rows, hairline-divided. */
export const SearchResults = () => (
  <div style={{ width: 420 }} className="rounded-2xl bg-surface p-4">
    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface/35 mb-1">Restaurants</p>
    <LoadingSkeletonList count={6} variant="list-item" className="divide-y divide-on-surface/[0.06]" />
  </div>
);

/** `variant="card"` is the one that brings its own layout — the wrapper
 *  becomes a two-column grid, so four items are two rows of tiles. */
export const CardGrid = () => (
  <div style={{ width: 420 }} className="rounded-2xl bg-surface p-4">
    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface/35 mb-3">Saved places</p>
    <LoadingSkeletonList count={4} variant="card" />
  </div>
);

/** A short list — three rows, the restaurant page's "your visits" block
 *  while it loads. Same call, smaller `count`. */
export const ShortList = () => (
  <div style={{ width: 420 }} className="rounded-2xl bg-surface p-4">
    <p className="font-serif font-bold text-[17px] text-on-surface mb-1">Recent visits</p>
    <LoadingSkeletonList count={3} variant="list-item" className="divide-y divide-on-surface/[0.06]" />
  </div>
);

/** Non-card variants stack in a plain `div`, so `className` is where the
 *  rhythm comes from — here three paragraph blocks for a loading review
 *  thread. */
export const TextBlocks = () => (
  <div style={{ width: 420 }} className="rounded-2xl bg-surface p-4">
    <p className="font-serif font-bold text-[17px] text-on-surface mb-3">Reviews</p>
    <LoadingSkeletonList count={3} variant="text" className="space-y-6" />
  </div>
);
