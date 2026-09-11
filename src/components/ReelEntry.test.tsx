// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RouteMotionLayer } from './RouteMotionLayer';
import { MuxReelMedia } from './MuxReelMedia';

let complete: (definition: string) => void;
vi.mock('motion/react', () => ({ motion: { div: ({ children, onAnimationComplete }: any) => {
  complete = onAnimationComplete;
  return <div>{children}</div>;
} } }));
vi.mock('@mux/mux-player-react', () => ({ default: React.forwardRef(({ onPlaying, onEmptied }: any, ref: any) =>
  <video data-player ref={ref} onPlaying={onPlaying} onEmptied={onEmptied} />) }));

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

async function render({ instant = false, near = true, poster = '/poster.jpg', entry = 'one' } = {}) {
  await act(async () => root.render(<RouteMotionLayer key={entry} initial="enter" animate="center" custom={{ instant }}>
    <MuxReelMedia playbackId="sample" poster={poster} active near={near} muted phoneMode />
  </RouteMotionLayer>));
  // The player engine is now a separate chunk; wait for delivery before
  // asserting its route-settling behavior. Loading it never mounts a decoder.
  await act(async () => { await import('./MuxReelPlayer'); });
}
it('opens on the poster, defers the decoder until landing, then fades only on playing', async () => {
  await render();
  expect(host.querySelector('[data-player]')).toBeNull();
  expect(host.querySelector('img')?.style.opacity).toBe('1');
  await act(async () => complete('center'));
  const video = host.querySelector('video')!;
  expect(video).not.toBeNull();
  await act(async () => video.dispatchEvent(new Event('canplay')));
  expect(host.querySelector('img')?.style.opacity).toBe('1');
  await act(async () => video.dispatchEvent(new Event('playing')));
  expect(host.querySelector('img')?.style.opacity).toBe('0');
});
it('starts immediately for instant/reduced-motion routes or media without a poster', async () => {
  await render({ instant: true });
  expect(host.querySelector('video')).not.toBeNull();
  await render({ entry: 'two', poster: '' });
  expect(host.querySelector('video')).not.toBeNull();
});
it('releases players outside the window and restores the poster before remounting', async () => {
  await render({ instant: true });
  await act(async () => host.querySelector('video')!.dispatchEvent(new Event('playing')));
  await render({ instant: true, near: false });
  expect(host.querySelector('video')).toBeNull();
  await render({ instant: true });
  expect(host.querySelector('img')?.style.opacity).toBe('1');
  await render({ entry: 'another-page' });
  expect(host.querySelector('video')).toBeNull();
});
