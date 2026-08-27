import React from 'react';
import { LoadingSkeleton } from 'gourmet-canvas';

/**
 * The app's one pending state. It replaced the assorted spinners and
 * "Loading…" strings, so every wait now looks the same: a slow pulse at 6%
 * of the on-surface ink, nothing else.
 *
 * Four variants, each shaped like the thing it stands in for. Render one per
 * call — for N placeholders use `LoadingSkeletonList`, or map an array.
 */

const Frame: React.FC<{ children: React.ReactNode; width?: number }> = ({ children, width = 320 }) => (
  <div style={{ width }} className="rounded-2xl bg-surface p-4 ring-1 ring-on-surface/[0.07]">
    {children}
  </div>
);

/** `card` — a 4:3 image block over a title and a subtitle bar, sized to
 *  stand in for a restaurant card in a two-up grid. */
export const Card = () => (
  <Frame width={260}>
    <LoadingSkeleton variant="card" />
  </Frame>
);

/** `list-item` — 64px thumbnail, two text bars, and a trailing 36px disc
 *  where the score badge lands. This is the search and feed row. */
export const ListItem = () => (
  <Frame width={380}>
    <LoadingSkeleton variant="list-item" />
  </Frame>
);

/** `avatar` — a bare 40px circle, `flex-shrink-0` so it holds its size in a
 *  row. Shown beside a name bar to give it the scale it has in use. */
export const AvatarOnly = () => (
  <Frame width={320}>
    <div className="flex items-center gap-3">
      <LoadingSkeleton variant="avatar" />
      <div className="flex-1">
        <LoadingSkeleton variant="text" />
      </div>
    </div>
  </Frame>
);

/** `text` — three lines at full, 5/6 and 3/5 width. The stagger is what
 *  makes it read as a paragraph rather than three bars. */
export const Text = () => (
  <Frame width={380}>
    <LoadingSkeleton variant="text" />
  </Frame>
);

/** All four together, at the sizes they ship at — the tint is identical
 *  across them by design, so only the shape changes. */
export const AllVariants = () => (
  <div style={{ width: 420 }} className="rounded-2xl bg-surface p-4 space-y-5 ring-1 ring-on-surface/[0.07]">
    <LoadingSkeleton variant="card" className="max-w-[220px]" />
    <LoadingSkeleton variant="list-item" />
    <LoadingSkeleton variant="avatar" />
    <LoadingSkeleton variant="text" />
  </div>
);
