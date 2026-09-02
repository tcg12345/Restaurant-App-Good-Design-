import React from 'react';
import { GlassGroup } from 'goodeats';
import { Bookmark, MessageCircle, Share2, Users } from 'lucide-react';

/**
 * Several actions sharing ONE capsule of glass — the header's Messages +
 * Circle pair, the detail page's Save + Share pair.
 *
 * Use it instead of two `GlassButton`s side by side: two touching capsules read
 * as two objects, and glass beside glass is the same mistake as glass on glass.
 *
 * Layout is entirely the caller's: `className` styles the capsule (the app
 * always passes `flex items-center rounded-full`) and `itemClassName` styles
 * every region (a square, so the glyphs sit on the centres the old circles
 * used). The component adds its own `.glass-control` material and a press dip.
 *
 * Real call sites: `TopBar.tsx:152`, `RestaurantDetailMobile.tsx:345`,
 * `RecipePage.tsx:2503`, `Discover.tsx:4378`.
 */

/** The header pair, full size. */
export const HeaderActions = () => (
  // Two things to know when building with this in a browser:
  // 1. The capsule is a plain <div> — it takes the width its parent gives it.
  //    Put it in a flex row (every real call site does) or it stretches.
  // 2. Each item's `symbol`, `tint`, `badge` and `badgeTone` go to the NATIVE
  //    iOS registry and render NOTHING on the web — `icon` is what draws. That
  //    is why the app's icon carries the state itself and renders its own badge
  //    element. Pass both: native props for device, `icon` for everywhere else.
  <div
    className="flex items-center justify-between gap-6"
    style={{
      padding: 16, borderRadius: 24,
      background: 'linear-gradient(135deg, #3f5d52 0%, #9f3012 55%, #2a2422 100%)',
    }}
  >
    <h1 className="text-xl font-serif font-bold tracking-tight" style={{ color: '#fff', textShadow: '0 1px 6px rgba(0,0,0,0.35)' }}>
      Explore
    </h1>
    <GlassGroup
      id="preview-topbar-actions"
      className="flex items-center rounded-full"
      itemClassName="relative flex items-center justify-center text-on-surface/70 w-11 h-11"
      items={[
        {
          id: 'messages',
          symbol: 'message',
          label: 'Messages',
          badge: '3',
          onClick: () => {},
          icon: (
            <>
              <MessageCircle size={21} />
              <span className="absolute -top-0.5 -right-0.5 min-w-[20px] h-5 px-1.5 text-[12px] rounded-full text-white font-bold flex items-center justify-center border-2 border-surface bg-primary">
                3
              </span>
            </>
          ),
        },
        { id: 'circle', symbol: 'person.2', label: 'Your Circle', onClick: () => {}, icon: <Users size={21} /> },
      ]}
    />
  </div>
);

/** The detail page's floating chrome: save + share on one capsule over the hero
 *  photo. Saved is a filled rust bookmark — glass has no fill to darken, so the
 *  state lives in the glyph (and in `tint` on the native side). */
export const SaveAndShare = () => (
  <div
    className="flex items-start justify-end"
    style={{
      padding: 16, borderRadius: 24, height: 132,
      background: 'linear-gradient(160deg, #6b7f5e 0%, #2f2a26 60%, #120f0e 100%)',
    }}
  >
    <GlassGroup
      id="preview-detail-actions"
      className="flex items-center rounded-full"
      itemClassName="relative w-11 h-11 flex items-center justify-center text-ink-2"
      items={[
        {
          id: 'save',
          symbol: 'bookmark.fill',
          tint: 'primary',
          label: 'Remove from wishlist',
          onClick: () => {},
          icon: <Bookmark size={16} className="fill-primary text-primary" />,
        },
        {
          id: 'share',
          symbol: 'square.and.arrow.up',
          label: 'Share',
          onClick: () => {},
          icon: <Share2 size={16} />,
        },
      ]}
    />
  </div>
);

/** The condensed scroll header's size: 36px regions and a smaller badge, set
 *  purely through `itemClassName`. Same capsule, tighter. */
export const CompactRegions = () => {
  const badge =
    'absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 text-[10px] rounded-full text-white font-bold flex items-center justify-center border-2 border-surface';
  return (
    <div
      className="flex items-center justify-between gap-6"
      style={{
        padding: 16, borderRadius: 24,
        background: 'linear-gradient(135deg, #3f5d52 0%, #9f3012 55%, #2a2422 100%)',
      }}
    >
      <span className="font-serif font-bold text-[15px] leading-tight" style={{ color: '#fff', textShadow: '0 1px 6px rgba(0,0,0,0.35)' }}>
        Bar Sardine
      </span>
      <GlassGroup
        id="preview-compact-actions"
        className="flex items-center rounded-full"
        itemClassName="relative flex items-center justify-center text-on-surface/70 w-9 h-9"
        items={[
          {
            id: 'messages',
            symbol: 'message',
            label: 'Messages',
            badge: '12',
            onClick: () => {},
            icon: (<><MessageCircle size={18} /><span className={`${badge} bg-primary`}>12</span></>),
          },
          {
            id: 'circle',
            symbol: 'person.2',
            label: 'Your Circle',
            badge: '2',
            badgeTone: 'danger',
            onClick: () => {},
            icon: (<><Users size={18} /><span className={`${badge} bg-red-500`}>2</span></>),
          },
        ]}
      />
    </div>
  );
};
