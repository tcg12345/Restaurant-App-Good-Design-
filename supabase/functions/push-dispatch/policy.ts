export interface PushJob {
  id: string; lease_id: string; attempts: number; device_id: string; token: string; environment: string; badge: number;
  notification: { id: string; user_id: string; kind: string; subject_type: string; subject_id: string; title: string; preview: string; path: string | null; subject_label: string; restaurant_id: string | null; created_at: string };
  preferences: { previews: boolean; sound: boolean; quiet_enabled: boolean; quiet_start: string; quiet_end: string; timezone: string };
}
export function destination(n: PushJob['notification']): string {
  if (n.path) return n.path;
  if (n.subject_type === 'post' || n.subject_type === 'reel') return `/r/${n.subject_type}-${n.subject_id}`;
  if (n.restaurant_id) return `/restaurant/${encodeURIComponent(n.restaurant_id)}`;
  return '/settings/notifications';
}
/** Find the end of quiet hours in the user's IANA timezone, including DST changes. */
export function quietRetry(p: PushJob['preferences'], now = Date.now()): string | null {
  if (!p.quiet_enabled) return null;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: p.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const inQuiet = (at: number) => {
    const time = formatter.format(at);
    return p.quiet_start < p.quiet_end ? time >= p.quiet_start && time < p.quiet_end : time >= p.quiet_start || time < p.quiet_end;
  };
  if (!inQuiet(now)) return null;
  for (let minutes = 1; minutes <= 1500; minutes++) if (!inQuiet(now + minutes * 60000)) return new Date(now + minutes * 60000).toISOString();
  return new Date(now + 86400000).toISOString();
}
export function apnsPayload(job: PushJob) {
  const n = job.notification;
  let title = n.title || 'GoodEats';
  let body = n.preview;
  if (!n.title && n.kind === 'like') body = `Someone liked your ${n.subject_type}${n.subject_label ? ` · ${n.subject_label}` : ''}.`;
  if (!n.title && n.kind === 'comment') { title = 'A new comment'; body = n.preview || `Someone commented on your ${n.subject_type}.`; }
  if (!job.preferences.previews) { title = 'GoodEats'; body = n.kind === 'message' ? 'You have a new message.' : n.kind === 'friend_request' ? 'You have a new friend request.' : 'You have a new update. Open GoodEats to take a look.'; }
  return { aps: { alert: { title: title.slice(0, 160), body: body.slice(0, 240) }, ...(job.preferences.sound ? { sound: 'default' } : {}),
    badge: Math.max(0, job.badge), 'thread-id': n.kind === 'message' ? `conversation:${n.subject_id}` : n.kind },
    notificationId: n.id, userId: n.user_id, path: destination(n) };
}
export function deliveryResult(status: number, reason: string): string {
  if (status === 200) return 'sent';
  if (status === 410 || (status === 400 && ['BadDeviceToken', 'DeviceTokenNotForTopic'].includes(reason))) return 'invalid_token';
  if (status === 429 || status >= 500 || status === 403) return `retry:${status}:${reason}`;
  return 'discarded';
}

/** Multiple messages in one delivery batch become one alert per conversation/device. */
export function coalescedMessageIds(jobs: PushJob[]): Set<string> {
  const latest = new Map<string, PushJob>();
  const skipped = new Set<string>();
  for (const job of jobs) {
    if (job.notification.kind !== 'message') continue;
    const key = `${job.device_id}:${job.notification.subject_id}`;
    const old = latest.get(key);
    if (old && Date.parse(old.notification.created_at) > Date.parse(job.notification.created_at)) skipped.add(job.id);
    else { if (old) skipped.add(old.id); latest.set(key, job); }
  }
  return skipped;
}
