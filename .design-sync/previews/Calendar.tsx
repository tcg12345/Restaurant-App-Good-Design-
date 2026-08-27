import React from 'react';
import { Calendar } from 'gourmet-canvas';

/**
 * The visit-date picker from the rating flow. Controlled on a `YYYY-MM-DD`
 * string; `onChange` gets the same shape back. Every cell here holds that
 * string in state, so picking a day really moves the selection.
 *
 * What it decides for you: **future days are disabled** — this dates a visit
 * that already happened, so tomorrow is not a thing you can pick. Today is
 * marked in primary text; the selection is a filled primary disc. Month and
 * year are dropdowns (the year list spans the last ten), with chevrons for
 * stepping a month at a time.
 *
 * `onClear` is optional. Pass it and the selected-date chip grows an ×;
 * leave it off and the chip is a label.
 */

const Sheet: React.FC<{ children: React.ReactNode; title: string }> = ({ children, title }) => (
  <div style={{ width: 360 }} className="rounded-2xl bg-surface p-4">
    <p className="font-serif font-bold text-[17px] text-on-surface text-center mb-4">{title}</p>
    {children}
  </div>
);

/** A day picked from the grid: the chip above carries the long-form date and
 *  its clear ×, and the day itself becomes a filled primary disc. */
export const VisitDate = () => {
  const [date, setDate] = React.useState('2024-05-09');
  return (
    <Sheet title="When did you go?">
      <Calendar value={date} onChange={setDate} onClear={() => setDate('')} />
    </Sheet>
  );
};

/** Nothing selected yet — no chip, and the view opens on the current month
 *  with today marked. This is the state the sheet opens in for a new visit. */
export const NoDateYet = () => {
  const [date, setDate] = React.useState('');
  return (
    <Sheet title="When did you go?">
      <Calendar value={date} onChange={setDate} onClear={() => setDate('')} />
    </Sheet>
  );
};

/** A date from an earlier month. The view follows the value on mount, and a
 *  fully past month has no disabled days at all. */
export const EarlierMonth = () => {
  const [date, setDate] = React.useState('2024-03-22');
  return (
    <Sheet title="Carbone · first visit">
      <Calendar value={date} onChange={setDate} onClear={() => setDate('')} />
    </Sheet>
  );
};

/** Without `onClear` the chip is a plain label — for flows where the date is
 *  required and clearing it would leave the form invalid. */
export const NotClearable = () => {
  const [date, setDate] = React.useState('2024-04-27');
  return (
    <Sheet title="Visit date">
      <Calendar value={date} onChange={setDate} />
    </Sheet>
  );
};
