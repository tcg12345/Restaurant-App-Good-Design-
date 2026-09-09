import type { CalendarPlan } from './calendar';

export const NOTIFICATION_CATEGORIES = [
  { key: 'friends', title: 'Friends', description: 'New requests and accepted invitations' },
  { key: 'messages', title: 'Messages', description: 'Direct conversations and group chats' },
  { key: 'activity', title: 'Your activity', description: 'Likes and comments on your ratings, posts and reels' },
  { key: 'shared_lists', title: 'Shared lists', description: 'Invitations to a list and places added by friends' },
  { key: 'plans', title: 'Meal reminders', description: 'A heads-up before dining out or cooking' },
  { key: 'reviews', title: 'After your visit', description: 'A gentle reminder to rate a restaurant' },
  { key: 'recaps', title: 'GoodEats in Review', description: 'Your weekly, monthly and yearly food recaps' },
  { key: 'account', title: 'Account updates', description: 'Membership changes and verification decisions' },
] as const;
export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number]['key'];
export interface NotificationPreferences {
  enabled: boolean;
  categories: Record<NotificationCategory, boolean>;
  previews: boolean;
  sound: boolean;
  reminder_minutes: number;
  quiet_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  timezone: string;
}
export function defaultNotificationPreferences(): NotificationPreferences {
  return { enabled: false, categories: Object.fromEntries(NOTIFICATION_CATEGORIES.map(c => [c.key, true])) as NotificationPreferences['categories'],
    previews: false, sound: true, reminder_minutes: 60, quiet_enabled: false, quiet_start: '22:00', quiet_end: '08:00',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
}
export function normalizeNotificationPreferences(raw?: Partial<NotificationPreferences> | null): NotificationPreferences {
  const defaults = defaultNotificationPreferences();
  return { ...defaults, ...raw, categories: { ...defaults.categories, ...raw?.categories } };
}
/** A push payload can select a destination, never an external URL or script. */
export function safeNotificationPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 1000 || /[\\\s\u0000-\u001f]/.test(raw) || !raw.startsWith('/') || raw.startsWith('//')) return null;
  const url = new URL(raw, 'https://goodeats.invalid');
  if (url.origin !== 'https://goodeats.invalid' || /%2f|%5c/i.test(url.pathname)) return null;
  if (!/^\/(?:messages|calendar|pantry|settings\/(?:notifications|reviews|account|subscription|verification)|admin\/cuisine|restaurant\/[^/]+|r\/(?:post|reel)-[a-f\d-]+)$/.test(url.pathname)) return null;
  return url.pathname + url.search;
}
export interface MealNotification { id: string; title: string; body: string; at: number; path: string; userId: string; category: string; sound: boolean }
export function mealNotifications(plans: CalendarPlan[], preferences: NotificationPreferences, userId: string, now = Date.now()): MealNotification[] {
  if (!preferences.enabled) return [];
  const rows: MealNotification[] = [];
  for (const plan of plans) {
    if (plan.status === 'cancelled') continue;
    const start = Date.parse(plan.starts_at), end = Date.parse(plan.ends_at);
    const add = (category: 'plans' | 'reviews', at: number, title: string, body: string) => {
      if (!preferences.categories[category] || at <= now || !Number.isFinite(at)) return;
      // Time-sensitive meal reminders are omitted in quiet hours, never delayed until after the meal.
      const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: preferences.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
      const minutes = Number(localTime.slice(0, 2)) * 60 + Number(localTime.slice(3, 5));
      const toMinutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
      const a = toMinutes(preferences.quiet_start), b = toMinutes(preferences.quiet_end);
      if (preferences.quiet_enabled && (a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b)) return;
      rows.push({ id: `meal:${userId}:${plan.id}:${category}`, title: preferences.previews ? title : 'GoodEats',
        body: preferences.previews ? body : (category === 'plans' ? 'You have a meal coming up. Open your calendar for details.' : 'How was your visit? Save a rating in GoodEats.'),
        at, path: `/calendar?plan=${encodeURIComponent(plan.id)}`, userId, category, sound: preferences.sound });
    };
    if (plan.status === 'planned') add('plans', start - preferences.reminder_minutes * 60000,
      plan.kind === 'restaurant' ? 'Your table is coming up' : 'Something good is cooking', `${plan.title} · ${new Date(start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    if (plan.kind === 'restaurant' && plan.review_state === 'pending') add('reviews', Math.max(end + 3600000, plan.snoozed_until ? Date.parse(plan.snoozed_until) : 0), 'How was your visit?', `Take a moment to rate ${plan.title}.`);
  }
  // Keep headroom under iOS's pending-request limit. Refilled whenever the app opens or a plan changes.
  return rows.sort((a, b) => a.at - b.at).slice(0, 60);
}
