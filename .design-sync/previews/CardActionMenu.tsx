import React from 'react';
import { CardActionMenu } from 'goodeats';
import { Pencil, Lock, Globe, Trash2, Share, Bookmark, EyeOff } from 'lucide-react';

/**
 * The long-press menu for a grid tile. It portals to `document.body` and
 * positions itself from a `DOMRect` — the anchor tile's own
 * `getBoundingClientRect()` — so every cell here renders real tiles and
 * measures one of them rather than passing a made-up rect.
 *
 * Geometry it owns: 212px wide, 46px per row plus 8px of padding, centered
 * under the tile and clamped 10px from either viewport edge. If the menu
 * would run past the bottom (respecting the home indicator via `--sat-bottom`)
 * it flips above the tile instead. The scrim dims and lightly blurs
 * everything behind it and dismisses on tap or a second right-click.
 */

// The menu's entry animation (motion/react, 140ms) never settles under the
// capture harness: it pins the page clock, which skews motion's WAAPI
// startTime into the future, so the element holds its `initial` opacity of 0
// and photographs as nothing at all. Important-author declarations outrank
// animations in the cascade, so this pins the settled state — which is what a
// still frame of a menu should show anyway.
const SettledMotion = () => (
  <style>{'body > div.fixed > div:nth-child(2){opacity:1!important;transform:none!important}'}</style>
);

/** Measures a real element once on mount and hands back its rect. */
function useAnchorRect() {
  const ref = React.useRef(null);
  const [rect, setRect] = React.useState(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el) setRect(el.getBoundingClientRect());
  }, []);
  return { ref, rect };
}

const Tile = React.forwardRef(({ title, meta, from, to, highlight }, ref) => (
  <div ref={ref} className="min-w-0">
    <div
      className="aspect-[4/5] w-full rounded-2xl"
      style={{
        background: `linear-gradient(150deg, ${from} 0%, ${to} 100%)`,
        boxShadow: highlight ? '0 0 0 2px var(--color-primary)' : undefined,
      }}
    />
    <p className="mt-2 text-[13px] font-semibold text-on-surface truncate">{title}</p>
    <p className="text-[11px] text-on-surface/50 truncate">{meta}</p>
  </div>
));

/** The reel grid's menu, ported from ProfileReelsSection: edit, flip the
 *  visibility, delete. `danger: true` turns the row and its glyph rose. */
export const OnAReelTile = () => {
  const { ref, rect } = useAnchorRect();
  return (
    <div style={{ width: 560 }}>
      <SettledMotion />
      <p className="font-serif font-bold text-[17px] text-on-surface mb-3">Reels</p>
      <div className="grid grid-cols-3 gap-3">
        <Tile title="Sunday gnocchi" meta="42 views" from="#c9a227" to="#8a5a2b" />
        <Tile ref={ref} title="Kaiseki at Kissaki" meta="1.2k views" from="#9f3012" to="#4a1d0c" highlight />
        <Tile title="Oaxaca market run" meta="308 views" from="#2e7d5c" to="#14402f" />
      </div>
      {rect && (
        <CardActionMenu
          rect={rect}
          onClose={() => {}}
          actions={[
            { label: 'Edit', icon: <Pencil size={16} />, onClick: () => {} },
            { label: 'Make followers-only', icon: <Lock size={16} />, onClick: () => {} },
            { label: 'Delete', icon: <Trash2 size={16} />, onClick: () => {}, danger: true },
          ]}
        />
      )}
    </div>
  );
};

/** A saved place, with the share / save / remove set. Four rows is 200px of
 *  menu — still comfortably under the tile. */
export const OnASavedPlace = () => {
  const { ref, rect } = useAnchorRect();
  return (
    <div style={{ width: 560 }}>
      <SettledMotion />
      <p className="font-serif font-bold text-[17px] text-on-surface mb-3">Want to try</p>
      <div className="grid grid-cols-3 gap-3">
        <Tile ref={ref} title="Carbone" meta="Italian · $$$$" from="#a8392a" to="#5b1c14" highlight />
        <Tile title="Sushi Nakazawa" meta="Sushi · $$$$" from="#3b6ea5" to="#17324d" />
        <Tile title="Le Bernardin" meta="French · $$$$" from="#c28f3a" to="#6b4a17" />
      </div>
      {rect && (
        <CardActionMenu
          rect={rect}
          onClose={() => {}}
          actions={[
            { label: 'Share', icon: <Share size={16} />, onClick: () => {} },
            { label: 'Add to a list', icon: <Bookmark size={16} />, onClick: () => {} },
            { label: 'Hide from feed', icon: <EyeOff size={16} />, onClick: () => {} },
            { label: 'Remove', icon: <Trash2 size={16} />, onClick: () => {}, danger: true },
          ]}
        />
      )}
    </div>
  );
};

/** The flip: a tile low enough that the menu would run off the bottom, so it
 *  opens upward instead. Same call, no flag — the component decides. */
export const FlipsAbove = () => {
  const { ref, rect } = useAnchorRect();
  return (
    <div style={{ width: 560 }}>
      <SettledMotion />
      <p className="font-serif font-bold text-[17px] text-on-surface mb-3">Guides</p>
      <div style={{ height: 300 }} />
      <div className="grid grid-cols-3 gap-3">
        <Tile title="Best pasta in Rome" meta="18 places" from="#2e7d5c" to="#123a2b" />
        <Tile ref={ref} title="Tokyo, 6 days" meta="31 places" from="#9f3012" to="#3d1207" highlight />
        <Tile title="Basque cider houses" meta="9 places" from="#c28f3a" to="#5e4114" />
      </div>
      {rect && (
        <CardActionMenu
          rect={rect}
          onClose={() => {}}
          actions={[
            { label: 'Edit guide', icon: <Pencil size={16} />, onClick: () => {} },
            { label: 'Make public', icon: <Globe size={16} />, onClick: () => {} },
            { label: 'Delete', icon: <Trash2 size={16} />, onClick: () => {}, danger: true },
          ]}
        />
      )}
    </div>
  );
};
