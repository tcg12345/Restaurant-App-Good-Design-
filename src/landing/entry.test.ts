import { describe, expect, it } from 'vitest';
import { resolveEntry, storeLink } from './entry';
const url = (path = '/') => new URL(path, 'https://goodeats.example');

describe('landing and app entry', () => {
  it('shows the landing page for a new browser visit and remembers web app entry for reloads', () => {
    expect(resolveEntry(url(), false, false, false).surface).toBe('landing');
    expect(resolveEntry(url(), false, false, true).surface).toBe('app');
    expect(resolveEntry(url('/welcome'), false, false, true).surface).toBe('landing');
    expect(resolveEntry(url('/download'), false, false, true).surface).toBe('landing');
  });
  it('keeps native and installed PWA launches in the app', () => {
    expect(resolveEntry(url(), true, false, false).surface).toBe('app');
    expect(resolveEntry(url(), false, true, false).surface).toBe('app');
  });
  it('opens the existing root app and preserves link parameters', () => {
    expect(resolveEntry(url('/app?invite=abc#details'), false, false, false)).toEqual({ surface: 'app', remember: true, replace: '/?invite=abc#details' });
    expect(resolveEntry(url('/login?next=%2Fpantry'), false, false, false)).toEqual({ surface: 'app', remember: true, replace: '/auth?login=1&next=%2Fpantry' });
  });
  it.each(['/restaurant/123', '/decide?room=abc', '/r/video', '/auth', '/?code=example', '/?token_hash=example&type=recovery', '/#access_token=example&refresh_token=example', '/#error=access_denied', '/?error_description=Expired'])('preserves app and auth deep links: %s', path => {
    expect(resolveEntry(url(path), false, false, false).surface).toBe('app');
  });
});

describe('store configuration', () => {
  it('accepts App Store, TestFlight, and Google Play HTTPS links', () => {
    expect(storeLink('https://apps.apple.com/app/id123', 'apple')).toBe('https://apps.apple.com/app/id123');
    expect(storeLink('https://testflight.apple.com/join/example', 'apple')).toBe('https://testflight.apple.com/join/example');
    expect(storeLink('https://play.google.com/store/apps/details?id=example', 'android')).toContain('play.google.com');
  });
  it.each([undefined, '', 'not-a-url', 'javascript:alert(1)', 'http://apps.apple.com/app/id123', 'https://apps.apple.com.attacker.example/app/id123', 'https://play.google.com/store/apps'])('uses the honest fallback for an absent or invalid Apple link: %s', value => {
    expect(storeLink(value, 'apple')).toBeNull();
  });
});
