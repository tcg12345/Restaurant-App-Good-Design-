// @vitest-environment jsdom
import html from '../../index.html?raw';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
vi.mock('./analytics', () => ({ track: vi.fn() }));
import { observeSecurityPolicy, policyViolationDetails } from './security-policy';
import hosting from '../../vercel.json';

const origin = 'https://grubbyrater.com';
const details = (blockedURI: string, effectiveDirective = 'connect-src', disposition = 'report') => policyViolationDetails({ blockedURI, effectiveDirective, disposition } as SecurityPolicyViolationEvent, origin);

describe('privacy-safe CSP diagnostics', () => {
  it('strips credentials, paths, search terms, signatures and arbitrary hostnames', () => {
    expect(details('https://user:secret@ocpmhsquwsdaauflbygf.supabase.co/storage/private/person/photo?token=secret')).toEqual({ provider: 'supabase', endpoint: 'connect-src', outcome: 'report_only' });
    expect(details('https://private-customer-site.example/photos/name?signature=secret')).toEqual({ provider: 'external_https', endpoint: 'connect-src', outcome: 'report_only' });
    expect(details('https://posthog.com.attacker.example/')).toMatchObject({ provider: 'external_https' });
  });
  it('categorizes inline, eval, binary and local resources without retaining their content', () => {
    expect(details('inline', 'script-src-elem', 'enforce')).toMatchObject({ provider: 'inline', outcome: 'blocked' });
    expect(details('eval', 'script-src')).toMatchObject({ provider: 'eval' });
    expect(details('blob:https://grubbyrater.com/private-id')).toMatchObject({ provider: 'blob' });
    expect(details('data:text/javascript,secret')).toMatchObject({ provider: 'data' });
    expect(details(`${origin}/assets/file.js`)).toMatchObject({ provider: 'self' });
  });
  it('ignores browser extensions, malformed addresses and unexpected directive text', () => {
    expect(details('chrome-extension://extension-id/main.js')).toBeNull();
    expect(details('moz-extension://extension-id/main.js')).toBeNull();
    expect(details('private text')).toBeNull();
    expect(details('inline', 'private contents')).toBeNull();
  });
  it('deduplicates reports, caps the document budget and removes its listener', () => {
    const report = vi.fn();
    const stop = observeSecurityPolicy(document, origin, report);
    const dispatch = (blockedURI: string, effectiveDirective = 'connect-src', disposition = 'report') => {
      const event = new Event('securitypolicyviolation');
      Object.assign(event, { blockedURI, effectiveDirective, disposition, sample: 'private code', documentURI: `${origin}/secret` });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    };
    for (let i = 0; i < 100; i++) dispatch(`https://unknown${i}.example/private?token=${i}`);
    expect(report).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/secret|private|unknown\d/);
    for (const directive of ['img-src', 'media-src', 'connect-src', 'script-src', 'font-src']) {
      for (const host of ['api.mapbox.com', 'image.mux.com', 'us.i.posthog.com', 'places.googleapis.com', 'grubbyrater.com']) dispatch(`https://${host}/secret`, directive);
    }
    expect(report).toHaveBeenCalledTimes(20);
    stop(); dispatch('inline', 'script-src-attr', 'enforce');
    expect(report).toHaveBeenCalledTimes(20);
  });
});

describe('deployed security policy', () => {
  const headers = Object.fromEntries(hosting.headers[0].headers.map(({ key, value }) => [key, value]));
  const policy = new Map(headers['Content-Security-Policy'].split(';').map(part => {
    const [name, ...values] = part.trim().split(/\s+/); return [name, values];
  }));
  it('authorizes the exact before-paint theme bootstrap without opening all inline scripts', () => {
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(match => !/\bsrc=/.test(match[1]));
    expect(inline).toHaveLength(1);
    for (const [, , script] of inline) expect(policy.get('script-src')).toContain(`'sha256-${createHash('sha256').update(script).digest('base64')}'`);
    expect(policy.get('script-src')).not.toContain("'unsafe-inline'");
    expect(policy.get('script-src')).not.toContain("'unsafe-eval'");
    expect(policy.get('script-src')).not.toContain('https:');
    expect(policy.get('script-src')).not.toContain('blob:');
    expect(policy.get('script-src-attr')).toEqual(["'none'"]);
  });
  it('preserves app modules, maps, video workers, inline layout and external photos', () => {
    expect(policy.get('script-src')).toContain("'self'");
    expect(policy.get('script-src')).toContain("'wasm-unsafe-eval'");
    expect(policy.get('worker-src')).toContain('blob:');
    expect(policy.get('img-src')).toEqual(expect.arrayContaining(['https:', 'data:', 'blob:']));
    expect(policy.get('style-src')).toContain("'unsafe-inline'");
    expect(policy.get('connect-src')).toContain('https:');
    expect(policy.get('connect-src')).toContain('wss://ocpmhsquwsdaauflbygf.supabase.co');
    expect(headers['Content-Security-Policy-Report-Only']).toContain('https://storage.googleapis.com');
    expect(headers['Content-Security-Policy-Report-Only'].split(/\s+/)).not.toContain('https:');
  });
  it('blocks embedding, base redirection, plugins and cross-origin HTML form posts', () => {
    expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'none'"]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('form-action')).toEqual(["'self'"]);
  });
});
