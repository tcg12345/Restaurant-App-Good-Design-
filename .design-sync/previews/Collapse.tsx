import React from 'react';
import { Collapse } from 'goodeats';
import { ChevronDown } from 'lucide-react';

const HOURS: Array<[string, string, boolean]> = [
  ['Monday', 'Closed', false],
  ['Tuesday', '5:30 – 10:00 PM', false],
  ['Wednesday', '5:30 – 10:00 PM', true],
  ['Thursday', '5:30 – 10:30 PM', false],
  ['Friday', '5:00 – 11:00 PM', false],
];

const PANEL: React.CSSProperties = {
  width: 300,
  padding: '4px 16px 12px',
  borderRadius: 16,
  border: '1px solid color-mix(in srgb, var(--color-on-surface) 9%, transparent)',
  background: 'var(--color-surface)',
};

const Header = ({ label, sub, open }: { label: string; sub?: string; open: boolean }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0' }}>
    <span style={{ fontSize: 14.5, fontWeight: 600 }}>{label}</span>
    {sub && <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, opacity: 0.45 }}>· {sub}</span>}
    <ChevronDown
      size={16}
      style={{
        marginLeft: 'auto',
        opacity: 0.4,
        transform: open ? 'rotate(180deg)' : undefined,
        transition: 'transform 200ms var(--ease-out-strong)',
      }}
    />
  </div>
);

const HoursList = () => (
  <ul style={{ paddingTop: 4 }}>
    {HOURS.map(([day, time, today], i) => (
      <li
        key={day}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          padding: '10px 0',
          borderTop: i > 0 ? '1px solid color-mix(in srgb, var(--color-on-surface) 9%, transparent)' : undefined,
          fontSize: 14,
          fontWeight: today ? 600 : 400,
          opacity: today ? 1 : 0.6,
        }}
      >
        <span>{day}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{time}</span>
      </li>
    ))}
  </ul>
);

/** Both states, side by side. `Collapse` is a controlled open/closed wrapper —
 *  it renders a grid whose single row animates `0fr → 1fr` over 200ms on
 *  `--ease-out-strong`, with opacity riding along. The browser interpolates
 *  the height, so a mid-flight toggle retargets and reverses instead of
 *  snapping; the old `AnimatePresence` + `height: 0 → auto` pattern it
 *  replaced could not do that, because it tore the content out of the tree
 *  on every close.
 *
 *  Closed, the panel occupies zero height and its children are `inert` — out
 *  of the tab order and the accessibility tree — but they stay mounted, which
 *  is what preserves their state across a toggle. */
export const OpenAndClosed = () => (
  <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
    {[true, false].map((open) => (
      <div key={String(open)} style={PANEL}>
        <Header label="Hours" sub="5:30 – 10:00 PM" open={open} />
        <Collapse open={open}>
          <HoursList />
        </Collapse>
      </div>
    ))}
  </div>
);

/** The accordion it was written for: four stacked sections on the restaurant
 *  page, only one open. The closed sections contribute no height at all, so
 *  the headers below the open one sit flush — there is no collapsed-but-
 *  present gap to design around. */
export const InAnAccordion = () => {
  const sections: Array<[string, boolean, React.ReactNode]> = [
    ['Your rating', false, null],
    ['Hours', true, <HoursList key="h" />],
    ['What to order', false, null],
    ['Location', false, null],
  ];
  return (
    <div style={{ ...PANEL, padding: '0 16px' }}>
      {sections.map(([label, open, body], i) => (
        <div
          key={label}
          style={{ borderTop: i > 0 ? '1px solid color-mix(in srgb, var(--color-on-surface) 9%, transparent)' : undefined }}
        >
          <Header label={label} open={open} />
          <Collapse open={open}>
            <div style={{ paddingBottom: 8 }}>{body}</div>
          </Collapse>
        </div>
      ))}
    </div>
  );
};

/** An expanded review row — the profile list's disclosure. `className` lands
 *  on the grid wrapper, so margins belong there rather than on the content,
 *  or they collapse along with the row. */
export const InAReviewRow = () => (
  <div style={{ width: 360 }}>
    {[
      ['Jungsik', 'Korean · $$$$', 9.4, true],
      ['Odd Duck', 'American · $$$', 7.6, false],
    ].map(([name, sub, score, open], i) => (
      <div
        key={name as string}
        style={{ borderTop: i > 0 ? '1px solid color-mix(in srgb, var(--color-on-surface) 9%, transparent)' : undefined, padding: '4px 0' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>{name as string}</span>
            <span style={{ display: 'block', fontSize: 12.5, opacity: 0.55, marginTop: 3 }}>{sub as string}</span>
          </span>
          <span style={{ fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: 17, fontVariantNumeric: 'tabular-nums' }}>
            {(score as number).toFixed(1)}
          </span>
          <ChevronDown
            size={16}
            style={{ opacity: 0.4, transform: open ? 'rotate(180deg)' : undefined }}
          />
        </div>
        <Collapse open={open as boolean} className="pb-4">
          <p
            style={{
              fontFamily: 'var(--font-serif)',
              fontStyle: 'italic',
              fontSize: 15.5,
              lineHeight: 1.6,
              paddingLeft: 12,
              borderLeft: '2px solid var(--color-primary)',
            }}
          >
            The sea urchin course alone was worth the trip. Go at the counter if you can get it.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
            {['tasting-menu', 'date-night', 'counter-seating'].map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 11.5,
                  fontWeight: 500,
                  padding: '4px 10px',
                  borderRadius: 9999,
                  background: 'color-mix(in srgb, var(--color-on-surface) 5%, transparent)',
                }}
              >
                #{t}
              </span>
            ))}
          </div>
        </Collapse>
      </div>
    ))}
  </div>
);
