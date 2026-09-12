import { createClient } from 'npm:@supabase/supabase-js@2.100.0';
import { apnsPayload, coalescedMessageIds, deliveryResult, quietRetry, type PushJob } from './policy.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function equalSecret(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false;
  let different = 0; for (let i = 0; i < actual.length; i++) different |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return different === 0;
}
const b64url = (data: Uint8Array) => btoa(String.fromCharCode(...data)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
let cached: { token: string; until: number } | null = null;
async function providerToken(keyId: string, teamId: string, pem: string): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const keyBytes = Uint8Array.from(atob(pem.replace(/\\n/g, '\n').replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', keyBytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const encode = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ alg: 'ES256', kid: keyId })}.${encode({ iss: teamId, iat: Math.floor(Date.now() / 1000) })}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  const token = `${unsigned}.${b64url(new Uint8Array(signature))}`;
  cached = { token, until: Date.now() + 45 * 60000 }; return token;
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('PUSH_DISPATCH_SECRET');
  if (!secret || !equalSecret(req.headers.get('x-dispatch-secret') || '', secret)) return json({ error: 'Unauthorized' }, 401);
  const keyId = Deno.env.get('APNS_KEY_ID'), teamId = Deno.env.get('APNS_TEAM_ID'), pem = Deno.env.get('APNS_PRIVATE_KEY');
  const topic = Deno.env.get('APNS_BUNDLE_ID') || 'com.tylergorin.restaurantapp';
  // Fail before claiming work. Missing setup must not consume retries or drop notifications.
  if (!keyId || !teamId || !pem) return json({ error: 'APNs is not configured' }, 503);
  try {
    const token = await providerToken(keyId, teamId, pem);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data, error } = await db.rpc('claim_push_notifications', { p_limit: 40 });
    if (error) throw error;
    const counts = { sent: 0, deferred: 0, retried: 0, discarded: 0 };
    // Keep concurrency bounded; each request has a timeout shorter than its lease.
    const jobs = data as PushJob[];
    const coalesced = coalescedMessageIds(jobs);
    for (let offset = 0; offset < jobs.length; offset += 8) {
      await Promise.all(jobs.slice(offset, offset + 8).map(async job => {
        let result: string, retryAt: string | null = null;
        try {
          retryAt = quietRetry(job.preferences);
          const safety = await db.rpc('safety_push_allowed', { p_notification: job.notification.id });
          if (safety.error) throw safety.error;
          if (safety.data !== true || coalesced.has(job.id)) result = 'discarded';
          else if (retryAt) result = 'deferred';
          else {
            const host = job.environment === 'development' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
            // Deno's native fetch negotiates HTTP/2 with APNs via TLS/ALPN.
            const response = await fetch(`https://${host}/3/device/${job.token}`, { method: 'POST', signal: AbortSignal.timeout(8000),
              headers: { authorization: `bearer ${token}`, 'apns-topic': topic, 'apns-push-type': 'alert', 'apns-priority': '10',
                'apns-id': job.id, 'apns-expiration': String(Math.floor((Date.parse(job.notification.created_at) + 3 * 86400000) / 1000)),
                'apns-collapse-id': job.notification.kind === 'message' ? job.notification.subject_id : job.notification.id },
              body: JSON.stringify(apnsPayload(job)) });
            const body = response.status === 200 ? {} : await response.json().catch(() => ({}));
            result = deliveryResult(response.status, body.reason || 'Unknown');
          }
        } catch { result = 'retry:transport'; }
        const { error: finishError } = await db.rpc('finish_push_notification', { p_id: job.id, p_lease_id: job.lease_id, p_result: result, p_retry_at: retryAt });
        if (finishError) throw finishError;
        if (result === 'sent') counts.sent++; else if (result === 'deferred') counts.deferred++; else if (result.startsWith('retry')) counts.retried++; else counts.discarded++;
      }));
    }
    return json(counts);
  } catch {
    // No device tokens, private message text, JWTs, or keys in logs/responses.
    return json({ error: 'Push delivery is temporarily unavailable' }, 503);
  }
});
