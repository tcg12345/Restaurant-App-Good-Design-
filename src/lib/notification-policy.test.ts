import { describe, expect, it } from 'vitest';
import { defaultNotificationPreferences, mealNotifications, safeNotificationPath } from './notification-policy';
import type { CalendarPlan } from './calendar';
import { apnsPayload, coalescedMessageIds, deliveryResult, quietRetry, type PushJob } from '../../supabase/functions/push-dispatch/policy';
const now = Date.parse('2026-09-08T12:00:00Z');
const plan = { id: 'dinner', kind: 'restaurant', title: 'Maple & Ash', starts_at: '2026-09-08T19:00:00Z', ends_at: '2026-09-08T21:00:00Z', status: 'planned', review_state: 'pending', snoozed_until: null, details: {} } as CalendarPlan;
const prefs = { ...defaultNotificationPreferences(), enabled: true };
describe('meal reminders', () => {
  it('schedules one reminder and one review, hides private details by default', () => {
    const rows = mealNotifications([plan], prefs, 'owner', now);
    expect(rows.map(r => r.at)).toEqual([Date.parse('2026-09-08T18:00:00Z'), Date.parse('2026-09-08T22:00:00Z')]);
    expect(JSON.stringify(rows)).not.toContain('Maple');
    expect(rows[0].path).toBe('/calendar?plan=dinner');
  });
  it('cancels, reschedules, respects category and review state without duplicate identifiers', () => {
    expect(mealNotifications([{ ...plan, status: 'cancelled' }], prefs, 'owner', now)).toEqual([]);
    expect(mealNotifications([plan], { ...prefs, enabled: false }, 'owner', now)).toEqual([]);
    const changed = mealNotifications([{ ...plan, starts_at: '2026-09-09T19:00:00Z', ends_at: '2026-09-09T21:00:00Z', review_state: 'reviewed' }], prefs, 'owner', now);
    expect(changed).toHaveLength(1);
    expect(changed[0].id).toBe(mealNotifications([plan], prefs, 'owner', now)[0].id);
    expect(changed[0].at).toBe(Date.parse('2026-09-09T18:00:00Z'));
    expect(mealNotifications([plan], { ...prefs, categories: { ...prefs.categories, reviews: false } }, 'owner', now)).toHaveLength(1);
  });
  it('caps at the nearest 60 notifications and never schedules past alerts', () => {
    expect(mealNotifications(Array.from({length: 50}, (_, i) => ({ ...plan, id: String(i) })), prefs, 'owner', now)).toHaveLength(60);
    expect(mealNotifications([plan], prefs, 'owner', Date.parse('2026-09-09'))).toEqual([]);
  });
});
it('allows internal notification routes and rejects URL injection', () => {
  for (const path of ['/messages?conversation=123', '/calendar?plan=abc', '/settings/reviews', '/restaurant/ChIJ123', '/pantry?shared=123']) expect(safeNotificationPath(path)).toBe(path);
  for (const path of ['javascript:alert(1)', '//evil.test', '/\\evil.test', '/restaurant/%2f%2fevil.test', '/settings/delete', '/unknown', '/calendar\n']) expect(safeNotificationPath(path)).toBeNull();
});
it('defers overnight quiet hours in the account timezone and handles DST', () => {
  const p = { quiet_enabled:true, quiet_start:'22:00', quiet_end:'08:00', timezone:'America/New_York' } as PushJob['preferences'];
  expect(quietRetry(p, Date.parse('2026-09-09T03:00:00Z'))).toBe('2026-09-09T12:00:00.000Z');
  expect(quietRetry(p, Date.parse('2026-09-09T16:00:00Z'))).toBeNull();
  expect(quietRetry(p, Date.parse('2026-11-01T04:00:00Z'))).toBe('2026-11-01T13:00:00.000Z');
});
it('separates permanent token failures from retryable APNs failures', () => {
  expect(deliveryResult(200, '')).toBe('sent');
  expect(deliveryResult(410, 'Unregistered')).toBe('invalid_token');
  expect(deliveryResult(400, 'BadDeviceToken')).toBe('invalid_token');
  expect(deliveryResult(429, 'TooManyRequests')).toMatch(/^retry/);
  expect(deliveryResult(403, 'ExpiredProviderToken')).toMatch(/^retry/);
});
it('omits message previews and sound according to account preferences', () => {
  const job = { badge:3, preferences: {previews:false,sound:false}, notification: {id:'n',user_id:'u',kind:'message',subject_type:'conversation',subject_id:'c',title:'Private name',preview:'Private message',path:'/messages?conversation=c'} } as PushJob;
  const payload = apnsPayload(job);
  expect(JSON.stringify(payload)).not.toContain('Private');
  expect(payload.aps).not.toHaveProperty('sound');
  expect(payload.path).toBe('/messages?conversation=c');
  expect(payload.userId).toBe('u');
});

it('keeps only the newest alert in a conversation burst for each device', () => {
 const job=(id:string,date:string,device='phone')=>({id,device_id:device,notification:{kind:'message',subject_id:'chat',created_at:date}} as PushJob);
 expect([...coalescedMessageIds([job('new','2026-09-08T20:00:00Z'),job('old','2026-09-08T19:00:00Z'),job('second-phone','2026-09-08T19:00:00Z','other')])]).toEqual(['old']);
});
