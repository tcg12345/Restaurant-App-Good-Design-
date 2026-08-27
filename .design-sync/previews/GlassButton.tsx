import React from 'react';
import { GlassButton } from 'gourmet-canvas';
import { Plus, MessageCircle, Bookmark } from 'lucide-react';

/**
 * A floating control that bridges to the native iOS 26 Liquid Glass layer.
 *
 * NOTE: the prompt extractor only keeps text from the first `export const`
 * onward, so the guidance below is repeated INSIDE the first export's body —
 * that copy is the one that ships.
 */

const circle = 'w-11 h-11 rounded-full flex items-center justify-center text-on-surface';

/** The floating circular action — the app's most common glass button. */
export const IconButtons = () => (
  // IMPORTANT for building with this in a browser: only `className`,
  // `children` and the component's own `.glass-control` class produce
  // anything visible here. `symbol`, `title`, `titleStyle`, `prominent`,
  // `tint` and `badge` are passed to the NATIVE registry and have no web
  // rendering at all — pass them for correctness on device, but style the
  // web fallback through `className`. `symbol` and `label` are required
  // regardless: `label` is the accessible name, and `symbol` is the SF
  // Symbol the native capsule draws. The circle class used throughout is
  // 'w-11 h-11 rounded-full flex items-center justify-center text-on-surface'.
  <div style={{ display: 'flex', gap: 10 }}>
    <GlassButton id="preview-create" symbol="plus" label="Create" onClick={() => {}} className={circle}>
      <Plus size={20} />
    </GlassButton>
    <GlassButton id="preview-messages" symbol="message" label="Messages" onClick={() => {}} className={circle}>
      <MessageCircle size={20} />
    </GlassButton>
    <GlassButton id="preview-save" symbol="bookmark" label="Save" onClick={() => {}} className={circle}>
      <Bookmark size={20} />
    </GlassButton>
  </div>
);

/** A pill with a word on it. `title`/`titleStyle` drive the native capsule;
 *  the web fallback needs the same text as `children` and its shape from
 *  `className`. */
export const LabelledPill = () => (
  <GlassButton
    id="preview-pill" symbol="chevron.left" title="New recipe" titleStyle="chip"
    label="Back to new recipe" onClick={() => {}}
    className="h-10 px-4 rounded-full inline-flex items-center gap-1.5 text-on-surface text-[13px] font-semibold"
  >
    ‹ New recipe
  </GlassButton>
);

/** Glass samples what sits behind it, so it only reads as a material over
 *  content — which is where the app always puts it (over the map, over a
 *  photo hero). */
export const OverContent = () => (
  <div
    style={{
      display: 'flex', gap: 10, padding: 20, borderRadius: 22,
      background: 'linear-gradient(135deg, #3f5d52 0%, #9f3012 55%, #2a2422 100%)',
    }}
  >
    <GlassButton
      id="preview-og-1" symbol="plus" label="Create" onClick={() => {}}
      className="w-11 h-11 rounded-full flex items-center justify-center text-on-surface"
    >
      <Plus size={20} />
    </GlassButton>
    <GlassButton
      id="preview-og-2" symbol="bookmark" label="Save" onClick={() => {}}
      className="w-11 h-11 rounded-full flex items-center justify-center text-on-surface"
    >
      <Bookmark size={20} />
    </GlassButton>
  </div>
);
