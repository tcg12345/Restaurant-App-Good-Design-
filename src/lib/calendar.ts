import { localISODate } from './utils';
import type { RestaurantMeta, RestaurantRating } from '../contexts/ListsContext';

export type PlanKind = 'restaurant' | 'recipe';
export interface CalendarPlan {
  id: string;
  user_id?: string;
  kind: PlanKind;
  title: string;
  starts_at: string;
  ends_at: string;
  status: 'planned' | 'completed' | 'cancelled';
  review_state: 'pending' | 'dismissed' | 'reviewed';
  snoozed_until: string | null;
  details: {
    location: string;
    people: number;
    notes: string;
    reservation: 'idea' | 'to-book' | 'confirmed';
    confirmation: string;
    restaurant?: RestaurantMeta;
    recipePath?: string;
  };
  created_at: string;
  updated_at: string;
}
export type PlanDraft = Omit<CalendarPlan, 'user_id' | 'created_at' | 'updated_at'>;
export const dayKey = (plan: CalendarPlan) => localISODate(new Date(plan.starts_at));
export const formatPlanTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export function monthDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), 1 - offset + i, 12));
}
export function hasPlanReview(plan: CalendarPlan, ratings: RestaurantRating[]): boolean {
  const id = plan.details.restaurant?.id ?? `calendar-${plan.id}`;
  return ratings.some(r => r.restaurantId === id && r.visitDate === dayKey(plan) &&
    (r.updatedAt ?? r.createdAt) >= new Date(plan.starts_at).getTime());
}
export function needsPlanReview(plan: CalendarPlan, now: number, ratings: RestaurantRating[] = []): boolean {
  const end = new Date(plan.ends_at).getTime();
  return plan.kind === 'restaurant' && plan.status !== 'cancelled' && plan.review_state === 'pending' &&
    end <= now && end > now - 14 * 86_400_000 &&
    (!plan.snoozed_until || new Date(plan.snoozed_until).getTime() <= now) && !hasPlanReview(plan, ratings);
}
export function overlappingPlans(draft: PlanDraft, plans: CalendarPlan[]): CalendarPlan[] {
  if (draft.status === 'cancelled') return [];
  return plans.filter(p => p.id !== draft.id && p.status !== 'cancelled' &&
    new Date(p.starts_at).getTime() < new Date(draft.ends_at).getTime() &&
    new Date(p.ends_at).getTime() > new Date(draft.starts_at).getTime());
}
export function validatePlan(plan: PlanDraft): string | null {
  if (!plan.title.trim() || plan.title.trim().length > 160) return 'Add a name of up to 160 characters.';
  const start = new Date(plan.starts_at).getTime(), end = new Date(plan.ends_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 86_400_000) return 'Choose a valid date, time, and duration of up to 24 hours.';
  if (!Number.isInteger(plan.details.people) || plan.details.people < 1 || plan.details.people > 100) return 'Choose between 1 and 100 people.';
  return null;
}
/** UTC event times preserve the instant across calendar applications and time zones. */
export function planToICS(plan: CalendarPlan): string {
  const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
  const stamp = (s: string) => new Date(s).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GoodEats//Meal Calendar//EN', 'BEGIN:VEVENT',
    `UID:${plan.id}@goodeats`, `DTSTAMP:${stamp(plan.updated_at)}`, `DTSTART:${stamp(plan.starts_at)}`, `DTEND:${stamp(plan.ends_at)}`,
    `SUMMARY:${escape(plan.title)}`, `LOCATION:${escape(plan.details.location)}`,
    `DESCRIPTION:${escape([plan.details.notes, plan.details.confirmation ? `Booking reference: ${plan.details.confirmation}` : ''].filter(Boolean).join('\n'))}`,
    `STATUS:${plan.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT', 'END:VCALENDAR'];
  // RFC 5545: fold at 75 UTF-8 octets, without splitting a code point.
  return lines.map(line => {
    let out = '', bytes = 0;
    for (const character of line) {
      const size = new TextEncoder().encode(character).length;
      if (bytes + size > 75) { out += '\r\n '; bytes = 1; }
      out += character; bytes += size;
    }
    return out;
  }).join('\r\n') + '\r\n';
}
