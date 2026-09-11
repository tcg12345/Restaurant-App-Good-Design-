import { track } from './analytics';

const directives = new Set(['default-src', 'script-src', 'script-src-elem', 'script-src-attr', 'style-src', 'style-src-elem', 'style-src-attr', 'connect-src', 'img-src', 'font-src', 'media-src', 'worker-src', 'frame-src', 'frame-ancestors', 'object-src', 'base-uri', 'form-action', 'manifest-src']);

/** Persist only a fixed provider category, never a URL, token, script sample,
 * pathname or user-supplied hostname from a browser violation report. */
export function policyViolationDetails(event: Pick<SecurityPolicyViolationEvent, 'effectiveDirective' | 'blockedURI' | 'disposition'>, origin: string) {
  if (!directives.has(event.effectiveDirective)) return null;
  let provider = 'unknown';
  if (['inline', 'eval', 'wasm-eval', 'data', 'blob'].includes(event.blockedURI)) provider = event.blockedURI;
  else {
    let url: URL;
    try { url = new URL(event.blockedURI); } catch { return null; }
    if (url.protocol === 'chrome-extension:' || url.protocol === 'safari-extension:' || url.protocol === 'moz-extension:') return null;
    if (url.protocol === 'blob:' || url.protocol === 'data:') provider = url.protocol.slice(0, -1);
    else if (url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'wss:') {
      const host = url.hostname;
      const under = (domain: string) => host === domain || host.endsWith(`.${domain}`);
      provider = url.origin === origin ? 'self'
        : under('supabase.co') ? 'supabase'
        : under('mapbox.com') ? 'mapbox'
        : under('mux.com') || under('litix.io') ? 'mux'
        : under('posthog.com') ? 'posthog'
        : under('googleapis.com') || under('googleusercontent.com') || under('gstatic.com') ? 'google'
        : url.protocol === 'https:' ? 'external_https' : 'external_other';
    }
  }
  return { provider, endpoint: event.effectiveDirective, outcome: event.disposition === 'report' ? 'report_only' : 'blocked' };
}

/** Bounded first-party diagnostics. The collector respects analytics opt-out;
 * report-only connection violations must never interrupt the original request. */
export function observeSecurityPolicy(target: Document, origin: string, report = track) {
  const seen = new Set<string>();
  const onViolation = (event: SecurityPolicyViolationEvent) => {
    const details = policyViolationDetails(event, origin);
    if (!details) return;
    const key = JSON.stringify(details);
    if (seen.has(key) || seen.size >= 20) return;
    seen.add(key);
    report('security_policy_violation', { feature: 'browser_security', properties: details });
  };
  target.addEventListener('securitypolicyviolation', onViolation);
  return () => target.removeEventListener('securitypolicyviolation', onViolation);
}
