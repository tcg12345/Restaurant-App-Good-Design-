import React from 'react';
import { SearchField } from 'gourmet-canvas';
import { Navigation } from 'lucide-react';

/**
 * The app's one search input. Controlled: `value` + `onChange` always, so
 * every cell here holds real state and shows real typed text.
 *
 * `plain` (the default) is nearly transparent — 12% of the system grey
 * (#767680) on a 24px blurred backdrop — because it sits on the page's own
 * ground and is meant to let it read through. The input is 17px: under 16px
 * iOS zooms the viewport on focus.
 *
 * Not exercised here: `glassId`. It hands the field to a native iOS 26
 * `UIGlassEffect` layer that has no browser equivalent — in a preview it
 * only strips the CSS material and leaves an empty box.
 */

/** Typed state. The clear disc appears only when `value` is non-empty and
 *  the field is not `readOnly` — it's the system's filled glyph, not an
 *  outlined ×, which at 18px would read as "close the thing behind me". */
export const Plain = () => {
  const [query, setQuery] = React.useState('Tartine');
  const results = ['Tartine Bakery', 'Tartine Manufactory', 'Tartine Sycamore'];
  return (
    <div style={{ width: 380 }}>
      <SearchField
        value={query}
        onChange={setQuery}
        onSubmit={() => {}}
        placeholder="Restaurants, recipes, people"
        aria-label="Search"
      />
      <div className="mt-3">
        {results.map((r) => (
          <div key={r} className="flex items-center gap-3 py-2.5">
            <div className="w-9 h-9 rounded-lg bg-on-surface/[0.06] flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-on-surface truncate">{r}</p>
              <p className="text-[12px] text-on-surface/50">Bakery · $$ · San Francisco</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** `floating` is the map variant. 12% of anything is illegible over a
 *  satellite tile, so this one carries its own near-opaque base (#fcfcfc at
 *  70%) instead of borrowing the ground. `tall` takes the 36px minimum to
 *  44px — the map chrome's primary field. Shown over a ground on purpose:
 *  over white the floating material is invisible. */
export const FloatingOverMap = () => {
  const [query, setQuery] = React.useState('Omakase');
  return (
    <div
      style={{
        width: 420,
        padding: 20,
        borderRadius: 20,
        backgroundImage:
          'linear-gradient(90deg, #f7f4ec 0 9px, transparent 9px 100%),' +
          'linear-gradient(0deg, #f7f4ec 0 8px, transparent 8px 100%),' +
          'linear-gradient(115deg, #a8c6d8 0 18%, transparent 18%),' +
          'linear-gradient(0deg, #9fbf9a, #9fbf9a)',
        backgroundSize: '132px 100%, 100% 88px, 100% 100%, 100% 100%',
        backgroundPosition: '48px 0, 0 58px, 0 0, 0 0',
      }}
    >
      <SearchField
        variant="floating"
        tall
        value={query}
        onChange={setQuery}
        onSubmit={() => {}}
        placeholder="Restaurants, cuisines, lists"
        aria-label="Search"
      />
      <div style={{ height: 96 }} />
    </div>
  );
};

/** The home header, ported from Discover: a `readOnly` field that is really
 *  a button (tapping it goes to the Search page, which has a real one) beside
 *  a second read-only field worn as a location chip. Keeping both as fields
 *  means the material and the metrics match across the transition. */
export const AsAButton = () => {
  const [city] = React.useState('Miami');
  return (
    <div style={{ width: 420 }} className="flex items-center gap-2">
      <SearchField
        className="flex-1 min-w-0"
        readOnly
        onPress={() => {}}
        value=""
        onChange={() => {}}
        placeholder="Dishes, places, people"
        aria-label="Open search"
      />
      <div className="relative flex-none" style={{ width: 108 }}>
        <SearchField
          leadingIcon={<Navigation size={14} strokeWidth={2.2} />}
          readOnly
          onPress={() => {}}
          value={city}
          onChange={() => {}}
          placeholder="Location"
          aria-label="Change location"
        />
      </div>
    </div>
  );
};

/** Both heights side by side — 36px default in a list, 44px `tall` for the
 *  map's primary field. The type stays 17px in both; only the box grows. */
export const Heights = () => {
  const [a, setA] = React.useState('Cacio e pepe');
  const [b, setB] = React.useState('Natural wine bars');
  return (
    <div style={{ width: 380 }} className="space-y-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-on-surface/35 mb-1.5">Default · 36px</p>
        <SearchField value={a} onChange={setA} placeholder="Search recipes" aria-label="Search recipes" />
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-on-surface/35 mb-1.5">Tall · 44px</p>
        <SearchField tall value={b} onChange={setB} placeholder="Search places" aria-label="Search places" />
      </div>
    </div>
  );
};
