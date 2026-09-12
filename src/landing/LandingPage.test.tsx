// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LandingPage from './LandingPage';

let container: HTMLDivElement;
let root: Root;
let animationFrames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let motionListeners: Set<() => void>;
let motionPreference: { matches: boolean; addEventListener: (event: string, cb: () => void) => void; removeEventListener: (event: string, cb: () => void) => void };
function flushFrame(time = 16) {
  const callbacks = [...animationFrames.values()];
  animationFrames.clear();
  act(() => callbacks.forEach(callback => callback(time)));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  animationFrames = new Map(); nextFrame = 0; motionListeners = new Set();
  motionPreference = { matches: true, addEventListener: (_, cb) => { motionListeners.add(cb); }, removeEventListener: (_, cb) => { motionListeners.delete(cb); } };
  vi.stubGlobal('matchMedia', () => motionPreference);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { animationFrames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { animationFrames.delete(id); });
  vi.stubGlobal('scrollY', 0);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  window.history.replaceState(null, '', '/welcome');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  act(() => root.render(<LandingPage />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const button = (label: string) => [...container.querySelectorAll('button')].find(el => el.textContent?.trim() === label)!;

describe('landing page actions', () => {
  it('links the official App Store badges directly to the supplied app ID', () => {
    const badges = [...container.querySelectorAll<HTMLAnchorElement>('.lp-app-store-badge')];
    expect(badges).toHaveLength(3);
    for (const badge of badges) {
      expect(badge.getAttribute('href')).toBe('https://apps.apple.com/app/id6779690841');
      expect(badge.querySelector('img')?.getAttribute('src')).toBe('/images/landing/download-on-the-app-store.svg');
      expect(badge.querySelector('img')?.getAttribute('alt')).toBe('Download on the App Store');
    }
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.textContent).not.toContain('Mobile download coming soon');
    const footerDownload = [...container.querySelectorAll<HTMLAnchorElement>('footer a')].find(a => a.textContent === 'Get the app');
    expect(footerDownload?.getAttribute('href')).toBe('https://apps.apple.com/app/id6779690841');
  });
  it('changes the illustrative app screen when a feature is selected', () => {
    act(() => button('Rank').click());
    expect(button('Rank').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.lp-phone')?.getAttribute('aria-label')).toBe('rank app preview');
    act(() => button('Together').click());
    expect(container.querySelector('.lp-phone')?.textContent).toContain('Where are we eating tonight?');
  });
  it('keeps the download-options route and restores body scrolling when closed', () => {
    window.history.replaceState(null, '', '/download');
    act(() => root.render(<LandingPage key="download" />));
    const dialog = container.querySelector('dialog')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.querySelector('a[href="/app"]')).not.toBeNull();
    expect(document.body.style.overflow).toBe('hidden');
    act(() => (dialog.querySelector('[aria-label="Close download options"]') as HTMLButtonElement).click());
    expect(container.querySelector('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });
  it('connects the mobile menu and all in-page navigation to real destinations', () => {
    const toggle = container.querySelector('[aria-controls="mobile-navigation"]') as HTMLButtonElement;
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const link = container.querySelector('#mobile-navigation a[href="#your-taste"]') as HTMLAnchorElement;
    act(() => link.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    for (const anchor of container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      expect(container.querySelector(anchor.getAttribute('href')!)).not.toBeNull();
    }
    expect(container.querySelector('a[href="/login"]')).not.toBeNull();
  });
  it('leaves all sections visible when reduced motion is requested', () => {
    expect(container.querySelector('.lp')?.getAttribute('data-motion')).toBe('reduced');
    expect(container.querySelector('[data-reveal]')?.getAttribute('style')).toBeNull();
  });
  it('compacts the header, tracks the visible section and restores its expanded state at the top', () => {
    const offsets: Record<string, number> = { 'the-app': 0, 'your-taste': 1600, 'good-company': 2800, 'get-goodeats': 4000 };
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) { return offsets[this.dataset.chapter || ''] || 0; });
    act(() => window.dispatchEvent(new Event('resize')));
    flushFrame();
    const header = container.querySelector('header')!;
    expect(header.getAttribute('data-compact')).toBe('false');
    vi.stubGlobal('scrollY', 1700);
    act(() => window.dispatchEvent(new Event('scroll')));
    flushFrame(32);
    expect(header.getAttribute('data-compact')).toBe('true');
    expect(header.getAttribute('data-theme')).toBe('dark');
    expect(container.querySelector('.lp-nav-desktop a[aria-current="location"]')?.getAttribute('href')).toBe('#your-taste');
    vi.stubGlobal('scrollY', 3000);
    act(() => window.dispatchEvent(new Event('scroll')));
    flushFrame(48);
    expect(header.getAttribute('data-theme')).toBe('light');
    expect(container.querySelector('.lp-current-chapter')?.textContent).toBe('Better together');
    vi.stubGlobal('scrollY', 0);
    act(() => window.dispatchEvent(new Event('scroll')));
    flushFrame(64);
    expect(header.getAttribute('data-compact')).toBe('false');
  });
  it('updates decorative scroll effects without moving the page and responds to a reduced-motion change', () => {
    const nativeScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    motionPreference.matches = false;
    act(() => motionListeners.forEach(listener => listener()));
    flushFrame();
    const page = container.querySelector('.lp') as HTMLElement;
    expect(page.dataset.motion).toBe('full');
    vi.stubGlobal('scrollY', 200);
    act(() => window.dispatchEvent(new Event('scroll')));
    flushFrame(32);
    expect(parseFloat(page.style.getPropertyValue('--lp-hero-shift'))).toBeGreaterThan(0);
    expect(nativeScroll).not.toHaveBeenCalled();
    motionPreference.matches = true;
    act(() => motionListeners.forEach(listener => listener()));
    flushFrame(48);
    expect(page.dataset.motion).toBe('reduced');
    expect(animationFrames.size).toBe(0);
  });

});
