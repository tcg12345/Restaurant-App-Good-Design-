import { describe, it, expect } from 'vitest';
import { monthDays, needsPlanReview, hasPlanReview, overlappingPlans, planToICS, validatePlan, dayKey, type CalendarPlan } from './calendar';
import { localISODate } from './utils';
const start = new Date(2026, 8, 8, 19).toISOString(), end = new Date(2026, 8, 8, 21).toISOString();
export const plan: CalendarPlan = { id: 'one', kind: 'restaurant', title: 'A lovely table', starts_at: start, ends_at: end, status: 'planned', review_state: 'pending', snoozed_until: null,
  details: { people: 2, location: 'New York', notes: '', confirmation: '', reservation: 'confirmed', restaurant: { id: 'restaurant-1', name: 'A lovely table', image: '', cuisine: '', price: '', address: '' } }, created_at: start, updated_at: start };
describe('calendar dates and post-visit eligibility', () => {
  it('builds Monday-first leap-year and year-boundary grids in local time', () => {
    const leap = monthDays(new Date(2024, 1, 1));
    expect(leap).toHaveLength(42); expect(leap[0].getDay()).toBe(1);
    expect(leap.some(d => localISODate(d) === '2024-02-29')).toBe(true);
    expect(localISODate(monthDays(new Date(2027, 0, 1))[0])).toBe('2026-12-28');
    expect(dayKey(plan)).toBe('2026-09-08');
  });
  it('waits until the visit ends, respects snooze, and never prompts for cancelled/cooking/stale plans', () => {
    const after = +new Date(end) + 1;
    expect(needsPlanReview(plan, after)).toBe(true);
    expect(needsPlanReview(plan, +new Date(start) + 1)).toBe(false);
    for (const changes of [{ status: 'cancelled' }, { kind: 'recipe' }, { review_state: 'reviewed' }, { review_state: 'dismissed' }, { snoozed_until: new Date(after + 1000).toISOString() }] as Partial<CalendarPlan>[]) expect(needsPlanReview({ ...plan, ...changes }, after)).toBe(false);
    expect(needsPlanReview(plan, after + 15 * 86400000)).toBe(false);
    expect(needsPlanReview({ ...plan, snoozed_until: end }, after)).toBe(true);
  });
  it('suppresses a completed rating but still invites reviews for return visits', () => {
    const rating = { restaurantId: 'restaurant-1', visitDate: '2026-09-08', createdAt: +new Date(end) } as any;
    expect(hasPlanReview(plan, [rating])).toBe(true);
    expect(needsPlanReview(plan, +new Date(end) + 1, [rating])).toBe(false);
    expect(hasPlanReview(plan, [{ ...rating, visitDate: '2026-09-01' }])).toBe(false);
    expect(hasPlanReview(plan, [{ ...rating, restaurantId: 'different' }])).toBe(false);
  });
  it('detects actual overlaps, allowing adjacent plans and excluding cancellations and self', () => {
    expect(overlappingPlans(plan, [plan])).toHaveLength(0);
    const other = { ...plan, id: 'two' };
    expect(overlappingPlans(other, [plan])).toHaveLength(1);
    expect(overlappingPlans({ ...other, starts_at: end, ends_at: new Date(+new Date(end) + 3600000).toISOString() }, [plan])).toHaveLength(0);
    expect(overlappingPlans(other, [{ ...plan, status: 'cancelled' }])).toHaveLength(0);
  });
  it('rejects invalid dates, empty titles, noninteger party sizes and reversed times', () => {
    expect(validatePlan(plan)).toBeNull();
    for (const changes of [{ title: '  ' }, { starts_at: 'invalid' }, { ends_at: start }, { details: { ...plan.details, people: 1.5 } }]) expect(validatePlan({ ...plan, ...changes })).toBeTruthy();
  });
  it('exports UTC dates, escapes special text, and folds multi-byte text without event injection', () => {
    const text = planToICS({ ...plan, title: 'Dinner, pasta; 🍝'.repeat(12), details: { ...plan.details, notes: 'hello\nBEGIN:VEVENT\nprivate\\note' } });
    expect(text).toContain('VERSION:2.0\r\n');
    expect(text).toContain('DESCRIPTION:hello\\nBEGIN:VEVENT\\nprivate\\\\note');
    expect(text.split('\r\n').filter(l => l === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(text).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    for (const line of text.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});
