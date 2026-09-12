// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fetchTokens = vi.hoisted(() => vi.fn());
vi.mock('./mux', () => ({ fetchMuxTokens: fetchTokens }));
import { useMuxPlaybackTokens } from './useMuxPlaybackTokens';
import { resetMediaAccess } from './media-access-scope';
let host: HTMLDivElement, root: Root;
const result = (token: string, lifetime = 900) => new Map([['video', { playback: token, thumbnail: 't', storyboard: 's', expiresAt: Date.now() / 1000 + lifetime }]]);
function Player({ enabled = true }: { enabled?: boolean }) {
  const { tokens, failed } = useMuxPlaybackTokens('reel', 'video', enabled);
  return <output>{tokens?.playback ?? (failed ? 'retry' : 'waiting')}</output>;
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-12T12:00:00Z')); resetMediaAccess(); fetchTokens.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
it('renews a nearby signed video before its original token expires', async () => {
  fetchTokens.mockImplementationOnce(async () => result('first')).mockImplementation(async () => result('renewed'));
  await act(async () => root.render(<Player />)); expect(host.textContent).toBe('first');
  await act(async () => vi.advanceTimersByTimeAsync(780000));
  expect(fetchTokens).toHaveBeenCalledTimes(2); expect(host.textContent).toBe('renewed');
});
it('clears revoked playback and never restores a response from the previous access scope', async () => {
  let finish!: (value: any) => void;
  fetchTokens.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(new Map());
  await act(async () => root.render(<Player />));
  await act(async () => resetMediaAccess()); expect(host.textContent).toBe('retry');
  await act(async () => finish(result('revoked'))); expect(host.textContent).toBe('retry');
});
it('does not request tokens for a public or distant player and stops renewal on unmount', async () => {
  fetchTokens.mockImplementation(async () => result('fresh'));
  await act(async () => root.render(<Player enabled={false} />)); expect(fetchTokens).not.toHaveBeenCalled();
  await act(async () => root.render(<Player />)); expect(fetchTokens).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<Player enabled={false} />));
  await act(async () => vi.advanceTimersByTimeAsync(900000)); expect(fetchTokens).toHaveBeenCalledTimes(1);
});
it('reauthorizes on resume and rejects expired tokens', async () => {
  fetchTokens.mockImplementationOnce(async () => result('first')).mockImplementation(async () => result('expired', -1));
  await act(async () => root.render(<Player />));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(host.textContent).toBe('retry');
});
