import React from 'react';
import { GlassChipRow } from 'goodeats';
import { ArrowUpDown, Clock, SlidersHorizontal, Star, Users } from 'lucide-react';

/**
 * A horizontally scrolling row of independent glass filter chips — the map
 * chrome's filter row, and the same row on the Following feed.
 *
 * One registration for the whole strip, so the row is passed as `items` rather
 * than composed by hand; `className` is the scroller.
 *
 * Real call sites: `Discover.tsx:4458`, `FollowingFeed.tsx:461`.
 */

/** The map's filter row on the Discover tab, with two filters chosen. */
export const MapFilters = () => (
  // Unlike the other glass components this one has a REAL web material: every
  // chip gets `.map-chip` — a blurred, saturated near-white capsule, 36px tall,
  // 13.5px/700 — and a chosen chip adds `.is-accent`, which drops the glass for
  // a solid `--color-primary` (#9f3012 rust) fill with white text. So
  // `prominent` is the one native-looking prop here that DOES render in a
  // browser. `symbol` is still native-only: pass `icon` for the web glyph.
  <div
    style={{
      padding: 18, borderRadius: 22,
      background: 'linear-gradient(135deg, #b7c9bb 0%, #dcd5c4 45%, #a6b9c6 100%)',
    }}
  >
    <GlassChipRow
      id="preview-map-chips"
      className="flex gap-2.5 overflow-x-auto scrollbar-hide pb-1"
      items={[
        {
          // Icon only — `title: ''` with an `icon` is a legitimate chip; the
          // rust fill says "active" louder than a count would, and `label`
          // carries the accessible name.
          id: 'filters',
          symbol: 'line.3.horizontal.decrease',
          title: '',
          prominent: true,
          label: 'Filters (2 active)',
          icon: <SlidersHorizontal size={14} strokeWidth={2.2} />,
          onClick: () => {},
        },
        {
          id: 'open-now',
          symbol: 'clock',
          title: 'Open now',
          prominent: true,
          icon: <Clock size={13} strokeWidth={2.2} />,
          onClick: () => {},
        },
        {
          id: 'top-rated',
          symbol: 'star',
          title: 'Top rated',
          icon: <Star size={13} strokeWidth={2.2} />,
          onClick: () => {},
        },
        { id: 'cuisine-italian', title: 'Italian', onClick: () => {} },
        { id: 'cuisine-japanese', title: 'Japanese', onClick: () => {} },
        { id: 'cuisine-mexican', title: 'Mexican', onClick: () => {} },
      ]}
    />
  </div>
);

/** The Following feed's row — same geometry, different filters, and a different
 *  selection. The titles carry their own counts ("Cuisine (2)"); a chip has no
 *  badge of its own. */
export const FollowingFilters = () => (
  <div
    style={{
      padding: 18, borderRadius: 22,
      background: 'linear-gradient(135deg, #7d5b4a 0%, #c07a4a 50%, #3a2f2a 100%)',
    }}
  >
    <GlassChipRow
      id="preview-follow-chips"
      className="flex gap-2.5 overflow-x-auto scrollbar-hide pb-1"
      items={[
        {
          id: 'filters',
          symbol: 'line.3.horizontal.decrease',
          title: '',
          label: 'Filters',
          icon: <SlidersHorizontal size={14} strokeWidth={2.2} />,
          onClick: () => {},
        },
        {
          id: 'who',
          symbol: 'person.2',
          title: 'Everyone',
          icon: <Users size={13} strokeWidth={2.2} />,
          onClick: () => {},
        },
        { id: 'cuisine', title: 'Cuisine (2)', prominent: true, onClick: () => {} },
        { id: 'price', title: '$$', prominent: true, onClick: () => {} },
        {
          id: 'sort',
          symbol: 'arrow.up.arrow.down',
          title: 'Sort',
          icon: <ArrowUpDown size={13} strokeWidth={2.2} />,
          onClick: () => {},
        },
      ]}
    />
  </div>
);

/** The short row: off the Discover mode the map keeps only the filters and the
 *  hours chip, and here nothing is chosen — every chip is glass. */
export const RestingRow = () => (
  <div
    style={{
      padding: 18, borderRadius: 22,
      background: 'linear-gradient(135deg, #b7c9bb 0%, #dcd5c4 45%, #a6b9c6 100%)',
    }}
  >
    <GlassChipRow
      id="preview-saved-chips"
      className="flex gap-2.5 overflow-x-auto scrollbar-hide pb-1"
      items={[
        {
          id: 'filters',
          symbol: 'line.3.horizontal.decrease',
          title: '',
          label: 'Filters',
          icon: <SlidersHorizontal size={14} strokeWidth={2.2} />,
          onClick: () => {},
        },
        {
          id: 'open-now',
          symbol: 'clock',
          title: 'Open now',
          icon: <Clock size={13} strokeWidth={2.2} />,
          onClick: () => {},
        },
      ]}
    />
  </div>
);
