/**
 * Opening-hours filtering.
 *
 * Restaurants expose their hours as Google Places `weekdayDescriptions` — an
 * array of human strings like `"Monday: 9:00 AM – 5:00 PM"`, `"Tuesday: Closed"`,
 * `"Wed: 11:00 AM – 2:30 PM, 5:00 PM – 9:30 PM"`, `"Thursday: Open 24 hours"`.
 * This module parses those into open intervals and answers "does this place
 * serve breakfast / lunch / dinner?" and "is it open right now?".
 *
 * Meal windows are deliberately broad so a place open across multiple meals
 * matches all of them (a 9 AM–10 PM spot matches lunch AND dinner). A place is
 * considered to "serve" a meal if it's open during any part of that meal's
 * window on any day of the week.
 */

export type MealKey = 'breakfast' | 'lunch' | 'dinner';

/** Meal-time windows, in minutes from midnight. */
export const MEAL_WINDOWS: Record<MealKey, [number, number]> = {
  breakfast: [6 * 60, 11 * 60],   // 6:00 AM – 11:00 AM
  lunch: [11 * 60, 15 * 60],      // 11:00 AM – 3:00 PM
  dinner: [17 * 60, 22 * 60],     // 5:00 PM – 10:00 PM
};

export const MEAL_LABELS: Record<MealKey, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

export const MEAL_KEYS: MealKey[] = ['breakfast', 'lunch', 'dinner'];

/** One open span. `day`: 0=Sun … 6=Sat. Minutes from midnight; `end` may exceed
 *  1440 when the place closes after midnight (overnight span). */
interface Interval { day: number; start: number; end: number }

const DAY_INDEX: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

/** "9:00 AM" / "12:30 PM" / "Noon" / "Midnight" → minutes from midnight, or null. */
function parseTime(raw: string): number | null {
  const t = raw.trim().toLowerCase();
  if (t === 'noon') return 12 * 60;
  if (t === 'midnight') return 0;
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const isPM = m[3].startsWith('p');
  if (h === 12) h = isPM ? 12 : 0;
  else if (isPM) h += 12;
  return h * 60 + min;
}

/** Parse Google `weekdayDescriptions` into open intervals. Robust to "Closed",
 *  "Open 24 hours", multiple periods per day, en/em/hyphen dashes, and
 *  overnight spans (end ≤ start ⇒ rolls past midnight). */
export function parseWeekdayHours(hours: string[] | undefined | null): Interval[] {
  if (!hours || hours.length === 0) return [];
  const out: Interval[] = [];
  for (const line of hours) {
    if (typeof line !== 'string') continue;
    const ci = line.indexOf(':');
    if (ci < 0) continue;
    const day = DAY_INDEX[line.slice(0, ci).trim().toLowerCase()];
    if (day === undefined) continue;
    const rest = line.slice(ci + 1).trim();
    if (/closed/i.test(rest)) continue;
    if (/(open\s+)?24\s*hours/i.test(rest)) { out.push({ day, start: 0, end: 1440 }); continue; }
    for (const period of rest.split(/,\s*/)) {
      const parts = period.split(/\s*[–—-]\s*/); // en/em dash or hyphen
      if (parts.length !== 2) continue;
      let start = parseTime(parts[0]);
      let end = parseTime(parts[1]);
      // Same-meridiem ranges are sometimes written with a bare start —
      // "5:00 – 10:00 PM" means 5 PM. Borrow the end's meridiem for a
      // start that's digits-only. (Cross-meridiem ranges are always fully
      // qualified, so the borrow can't misread "11:00 AM – 2:00 PM".)
      if (start === null && end !== null && /^\d{1,2}(?::\d{2})?$/.test(parts[0].trim())) {
        const meridiem = /p\.?m\.?/i.test(parts[1]) ? 'pm' : 'am';
        start = parseTime(`${parts[0].trim()} ${meridiem}`);
      }
      if (start === null || end === null) continue;
      if (end <= start) end += 1440; // overnight
      out.push({ day, start, end });
    }
  }
  return out;
}

const overlaps = (s: number, e: number, ws: number, we: number) => s < we && e > ws;

/** Does any open interval overlap the meal window on any day? Overnight spans
 *  are split so their post-midnight portion is considered too. */
function servesMeal(intervals: Interval[], meal: MealKey): boolean {
  const [ws, we] = MEAL_WINDOWS[meal];
  for (const iv of intervals) {
    if (overlaps(iv.start, Math.min(iv.end, 1440), ws, we)) return true;
    if (iv.end > 1440 && overlaps(0, iv.end - 1440, ws, we)) return true;
  }
  return false;
}

function openAtTime(intervals: Interval[], now: Date): boolean {
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  const yesterday = (day + 6) % 7;
  for (const iv of intervals) {
    if (iv.day === day && mins >= iv.start && mins < Math.min(iv.end, 1440)) return true;
    if (iv.day === yesterday && iv.end > 1440 && mins < iv.end - 1440) return true; // overnight from yesterday
  }
  return false;
}

/** Open right now, by the place's published hours. False when hours are unknown. */
export function isOpenNow(hours: string[] | undefined | null, now: Date = new Date()): boolean {
  return openAtTime(parseWeekdayHours(hours), now);
}

export interface HoursFilter {
  meals: MealKey[];
  openNow: boolean;
}

export const emptyHoursFilter = (): HoursFilter => ({ meals: [], openNow: false });

export const isHoursFilterActive = (f: HoursFilter): boolean => f.meals.length > 0 || f.openNow;

/** Toggle a meal in a HoursFilter, returning a new filter. */
export const toggleMeal = (f: HoursFilter, meal: MealKey): HoursFilter => ({
  ...f,
  meals: f.meals.includes(meal) ? f.meals.filter((m) => m !== meal) : [...f.meals, meal],
});

/**
 * Page-level predicate: keep an item when it passes the hours filter.
 *
 * - No active hours filter → keep everything.
 * - Unknown hours (none published / not yet fetched) → keep (we never hide a
 *   place just because we lack its hours data).
 * - Otherwise the place must be open now (if "Open now") AND open for at least
 *   one of the selected meals (meals are OR'd together).
 */
export function passesHoursFilter(
  hours: string[] | undefined | null,
  f: HoursFilter,
  now: Date = new Date(),
): boolean {
  if (!isHoursFilterActive(f)) return true;
  const intervals = parseWeekdayHours(hours);
  if (intervals.length === 0) return true; // unknown hours → never hide
  if (f.openNow && !openAtTime(intervals, now)) return false;
  if (f.meals.length > 0 && !f.meals.some((m) => servesMeal(intervals, m))) return false;
  return true;
}
