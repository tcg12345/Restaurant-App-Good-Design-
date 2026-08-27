import React from 'react';
import { GlassButton, GlassGroup, GlassSurface } from 'gourmet-canvas';
import { ArrowLeft, MessageCircle, Users } from 'lucide-react';

/**
 * Marks a subtree as ALREADY sitting on a piece of glass. One floating layer
 * of glass, never two stacked.
 *
 * It renders no element of its own — it is a context provider and nothing else
 * (glass-buttons.tsx:322). Wrap it around chrome that already sits inside a
 * `.glass-control` capsule (or any blurred bar) and the `GlassButton`s and
 * `GlassGroup`s inside it drop their own `.glass-control` class, so they render
 * flat on the surface they are riding instead of frosting a second time.
 *
 * Takes only `children`. `GlassChipRow` reads the same context, but its chips
 * keep the `.map-chip` material either way (glass-buttons.tsx:596) — inside a
 * surface only its native registration stands down.
 *
 * Real call site: the condensed scroll header in `TopBar.tsx:215`.
 */

/** The condensed scroll header: ONE `.glass-control` pill, everything on it
 *  wrapped in `GlassSurface` so the back button and the actions capsule inside
 *  render plain. Preview it over content — the frost has nothing to bend over
 *  white. */
export const CondensedHeaderBar = () => (
  <div
    style={{
      padding: 18,
      borderRadius: 24,
      background: 'linear-gradient(135deg, #3f5d52 0%, #9f3012 55%, #2a2422 100%)',
    }}
  >
    <div className="glass-control relative flex items-center gap-1.5 rounded-full p-1.5">
      <GlassSurface>
        <GlassButton
          id="preview-surface-back"
          symbol="arrow.left"
          label="Back"
          onClick={() => {}}
          className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface/70"
        >
          <ArrowLeft size={18} />
        </GlassButton>
        <button
          type="button"
          className="flex-1 min-w-0 px-1 text-center font-serif font-bold text-[15px] leading-tight truncate text-on-surface"
        >
          Bar Sardine
        </button>
        <GlassGroup
          id="preview-surface-actions"
          className="flex items-center rounded-full"
          itemClassName="relative flex items-center justify-center text-on-surface/70 w-9 h-9"
          items={[
            { id: 'messages', symbol: 'message', label: 'Messages', onClick: () => {}, icon: <MessageCircle size={18} /> },
            { id: 'circle', symbol: 'person.2', label: 'Your Circle', onClick: () => {}, icon: <Users size={18} /> },
          ]}
        />
      </GlassSurface>
    </div>
  </div>
);

/** Why it exists, and the one glass prop that IS visible in a browser: without
 *  the provider every child frosts on its own, so you get glass on glass — a
 *  second rim and a second shadow inside the pill. With it, one surface. */
export const NestedGlassComparison = () => {
  const caption: React.CSSProperties = {
    color: 'rgba(255,255,255,0.72)', fontSize: 11, fontWeight: 700,
    letterSpacing: '0.06em', marginBottom: 6,
  };
  const region = 'relative flex items-center justify-center text-on-surface/70 w-9 h-9';
  const pill = 'glass-control relative flex items-center gap-1.5 rounded-full p-1.5';
  const title = 'flex-1 px-1 text-center font-serif font-bold text-[15px] text-on-surface';
  const back = 'w-9 h-9 rounded-full flex items-center justify-center text-on-surface/70';
  const items = [
    { id: 'messages', symbol: 'message', label: 'Messages', onClick: () => {}, icon: <MessageCircle size={18} /> },
    { id: 'circle', symbol: 'person.2', label: 'Your Circle', onClick: () => {}, icon: <Users size={18} /> },
  ];
  return (
    <div
      style={{
        padding: 18, borderRadius: 24, display: 'flex', flexDirection: 'column', gap: 14,
        background: 'linear-gradient(135deg, #3f5d52 0%, #9f3012 55%, #2a2422 100%)',
      }}
    >
      <div>
        <div style={caption}>WITHOUT — GLASS ON GLASS</div>
        <div className={pill}>
          <GlassButton id="preview-surface-off-back" symbol="arrow.left" label="Back" onClick={() => {}} className={back}>
            <ArrowLeft size={18} />
          </GlassButton>
          <span className={title}>Bar Sardine</span>
          <GlassGroup
            id="preview-surface-off-actions"
            className="flex items-center rounded-full"
            itemClassName={region}
            items={items}
          />
        </div>
      </div>
      <div>
        <div style={caption}>WITH GLASSSURFACE — ONE LAYER</div>
        <div className={pill}>
          <GlassSurface>
            <GlassButton id="preview-surface-on-back" symbol="arrow.left" label="Back" onClick={() => {}} className={back}>
              <ArrowLeft size={18} />
            </GlassButton>
            <span className={title}>Bar Sardine</span>
            <GlassGroup
              id="preview-surface-on-actions"
              className="flex items-center rounded-full"
              itemClassName={region}
              items={items}
            />
          </GlassSurface>
        </div>
      </div>
    </div>
  );
};
