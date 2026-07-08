import { describe, it, expect } from 'vitest';
import {
  parseWeekdayHours,
  passesHoursFilter,
  isOpenNow,
  emptyHoursFilter,
  type HoursFilter,
} from './hours';

/* ── Fixtures ──────────────────────────────────────────────────────────── */

// Google Places v1 weekdayDescriptions use narrow no-break spaces (U+202F)
// before AM/PM and thin-space-padded en dashes (U+2009 – U+2009). Build the
// fixtures with the real characters so the parser is tested against what
// production actually receives.
const NNBSP = ' ';
const THIN = ' ';
const dash = `${THIN}–${THIN}`;

const t = (s: string) => s.replace(/ AM/g, `${NNBSP}AM`).replace(/ PM/g, `${NNBSP}PM`);

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const everyDay = (range: string) => DAYS.map((d) => `${d}: ${range}`);

const DINNER_ONLY = everyDay(t(`5:00 PM${dash}10:00 PM`));
const LUNCH_AND_DINNER = everyDay(t(`11:30 AM${dash}2:30 PM, 5:00 PM${dash}9:30 PM`));
const ALL_DAY = everyDay(t(`9:00 AM${dash}10:00 PM`));
const BREAKFAST_ONLY = everyDay(t(`6:30 AM${dash}10:30 AM`));

const filterFor = (meals: HoursFilter['meals']): HoursFilter => ({ meals, openNow: false });

/* ── Parsing ───────────────────────────────────────────────────────────── */

describe('parseWeekdayHours', () => {
  it('parses real Google strings (narrow spaces + en dash)', () => {
    const ivs = parseWeekdayHours(DINNER_ONLY);
    expect(ivs).toHaveLength(7);
    expect(ivs[0]).toEqual({ day: 1, start: 17 * 60, end: 22 * 60 }); // Monday
  });

  it('parses split shifts into two intervals per day', () => {
    const ivs = parseWeekdayHours([`Monday: ${t(`11:30 AM${dash}2:30 PM, 5:00 PM${dash}9:30 PM`)}`]);
    expect(ivs).toEqual([
      { day: 1, start: 11 * 60 + 30, end: 14 * 60 + 30 },
      { day: 1, start: 17 * 60, end: 21 * 60 + 30 },
    ]);
  });

  it('borrows the end meridiem for a bare start ("5:00 – 10:00 PM")', () => {
    const ivs = parseWeekdayHours([`Friday: ${t(`5:00${dash}10:00 PM`)}`]);
    expect(ivs).toEqual([{ day: 5, start: 17 * 60, end: 22 * 60 }]);
  });

  it('handles Closed, 24 hours, and overnight spans', () => {
    const ivs = parseWeekdayHours([
      'Monday: Closed',
      'Tuesday: Open 24 hours',
      `Friday: ${t(`10:00 PM${dash}2:00 AM`)}`,
    ]);
    expect(ivs).toEqual([
      { day: 2, start: 0, end: 1440 },
      { day: 5, start: 22 * 60, end: 26 * 60 }, // rolls past midnight
    ]);
  });

  it('handles plain-ASCII strings too (hyphen, normal spaces)', () => {
    const ivs = parseWeekdayHours(['Wednesday: 11:00 AM - 3:00 PM']);
    expect(ivs).toEqual([{ day: 3, start: 11 * 60, end: 15 * 60 }]);
  });

  it('returns [] for unknown/empty input', () => {
    expect(parseWeekdayHours(undefined)).toEqual([]);
    expect(parseWeekdayHours([])).toEqual([]);
    expect(parseWeekdayHours(['garbage line'])).toEqual([]);
  });
});

/* ── Meal filtering (the reported bug) ─────────────────────────────────── */

describe('passesHoursFilter meals', () => {
  it('dinner-only places FAIL a lunch filter', () => {
    expect(passesHoursFilter(DINNER_ONLY, filterFor(['lunch']))).toBe(false);
  });

  it('dinner-only places pass a dinner filter', () => {
    expect(passesHoursFilter(DINNER_ONLY, filterFor(['dinner']))).toBe(true);
  });

  it('split-shift places pass both lunch and dinner', () => {
    expect(passesHoursFilter(LUNCH_AND_DINNER, filterFor(['lunch']))).toBe(true);
    expect(passesHoursFilter(LUNCH_AND_DINNER, filterFor(['dinner']))).toBe(true);
  });

  it('all-day places match every meal; breakfast-only fails dinner', () => {
    expect(passesHoursFilter(ALL_DAY, filterFor(['breakfast']))).toBe(true);
    expect(passesHoursFilter(ALL_DAY, filterFor(['lunch']))).toBe(true);
    expect(passesHoursFilter(ALL_DAY, filterFor(['dinner']))).toBe(true);
    expect(passesHoursFilter(BREAKFAST_ONLY, filterFor(['dinner']))).toBe(false);
  });

  it('meals are ORed: dinner-only passes a lunch-or-dinner filter', () => {
    expect(passesHoursFilter(DINNER_ONLY, filterFor(['lunch', 'dinner']))).toBe(true);
  });

  it('keeps unknown-hours places (documented fallback) and no-ops when inactive', () => {
    expect(passesHoursFilter(undefined, filterFor(['lunch']))).toBe(true);
    expect(passesHoursFilter([], filterFor(['lunch']))).toBe(true);
    expect(passesHoursFilter(DINNER_ONLY, emptyHoursFilter())).toBe(true);
  });

  it('a dinner-only place with a bare-start range still fails lunch', () => {
    // Without meridiem inference these lines parse to NOTHING, and the
    // unknown-hours fallback would wrongly keep the place — the exact
    // reported bug for any place Google formats this way.
    const bareDinner = everyDay(t(`5:00${dash}10:00 PM`));
    expect(passesHoursFilter(bareDinner, filterFor(['lunch']))).toBe(false);
    expect(passesHoursFilter(bareDinner, filterFor(['dinner']))).toBe(true);
  });
});

/* ── Open now ──────────────────────────────────────────────────────────── */

describe('open now', () => {
  // 2026-07-08 is a Wednesday.
  const wedNoon = new Date(2026, 6, 8, 12, 0);
  const wedLateNight = new Date(2026, 6, 8, 23, 30);
  const thu1am = new Date(2026, 6, 9, 1, 0);

  it('true during published hours, false outside them', () => {
    expect(isOpenNow(ALL_DAY, wedNoon)).toBe(true);
    expect(isOpenNow(DINNER_ONLY, wedNoon)).toBe(false);
  });

  it('overnight spans stay open past midnight into the next day', () => {
    const lateBar = everyDay(t(`6:00 PM${dash}2:00 AM`));
    expect(isOpenNow(lateBar, wedLateNight)).toBe(true);
    expect(isOpenNow(lateBar, thu1am)).toBe(true); // Wednesday's span, after midnight
  });

  it('unknown hours are never "open now"', () => {
    expect(isOpenNow(undefined, wedNoon)).toBe(false);
  });

  it('passesHoursFilter combines openNow AND meals', () => {
    const f: HoursFilter = { meals: ['dinner'], openNow: true };
    expect(passesHoursFilter(DINNER_ONLY, f, new Date(2026, 6, 8, 19, 0))).toBe(true);
    expect(passesHoursFilter(DINNER_ONLY, f, wedNoon)).toBe(false); // dinner spot, closed at noon
  });
});
