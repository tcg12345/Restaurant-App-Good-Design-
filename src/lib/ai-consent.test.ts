// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
beforeEach(() => { vi.resetModules(); localStorage.clear(); });
it('does not authorize requests before the dialog explicitly accepts', async () => {
  const c = await import('./ai-consent');
  expect(await c.requestAiConsent('alice')).toBe(false);
  const show = vi.fn(); const stop = c.subscribeAiConsent(show);
  const result = c.requestAiConsent('alice');
  expect(show).toHaveBeenCalledWith('alice'); expect(c.hasAiConsent('alice')).toBe(false);
  c.finishAiConsent(false); expect(await result).toBe(false); stop();
});
it('persists versioned permission per account and supports revocation', async () => {
  const c = await import('./ai-consent'); const stop = c.subscribeAiConsent(() => {});
  const pending = c.requestAiConsent('alice'); c.finishAiConsent(true);
  expect(await pending).toBe(true); expect(c.hasAiConsent('alice')).toBe(true); expect(c.hasAiConsent('bob')).toBe(false);
  c.revokeAiConsent('alice'); expect(c.hasAiConsent('alice')).toBe(false); stop();
});
it('deduplicates simultaneous requests and cancels when the account or mounted UI changes', async () => {
  const c = await import('./ai-consent'); const show = vi.fn(); const stop = c.subscribeAiConsent(show);
  const a = c.requestAiConsent('alice'); expect(c.requestAiConsent('alice')).toBe(a);
  const b = c.requestAiConsent('bob'); expect(await a).toBe(false); stop(); expect(await b).toBe(false);
  expect(show).toHaveBeenCalledTimes(2);
});
it('requires consent again after the disclosure version changes', async () => {
  localStorage.setItem('goodeats-ai-consent:alice','old-version');
  const c = await import('./ai-consent'); expect(c.hasAiConsent('alice')).toBe(false);
});
