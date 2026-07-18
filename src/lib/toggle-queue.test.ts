import { describe, it, expect } from 'vitest';
import { createToggleQueue } from './toggle-queue';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('createToggleQueue', () => {
  it('serializes sends per key — no concurrent INSERT/DELETE', async () => {
    const q = createToggleQueue();
    let inFlight = 0;
    let maxInFlight = 0;
    const send = async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await tick(); await tick();
      inFlight--;
      return true;
    };
    const results = await Promise.all([
      q.run('r1', true, send),
      q.run('r1', false, send),
      q.run('r1', true, send),
    ]);
    expect(maxInFlight).toBe(1);
    expect(results).toEqual(['confirmed', 'confirmed', 'confirmed']);
  });

  it('skips a send whose desired state the server already confirmed', async () => {
    const q = createToggleQueue();
    let sends = 0;
    const send = async () => { sends++; return true; };
    await q.run('r1', true, send);
    const second = await q.run('r1', true, send); // double-tap settling on same state
    expect(second).toBe('skipped');
    expect(sends).toBe(1);
  });

  it('a failed send reports failed, does not poison the chain, and does not update confirmed state', async () => {
    const q = createToggleQueue();
    const first = await q.run('r1', true, async () => false);
    expect(first).toBe('failed');
    // Same desired state again — NOT skipped, because the server never confirmed it.
    let sent = false;
    const retry = await q.run('r1', true, async () => { sent = true; return true; });
    expect(retry).toBe('confirmed');
    expect(sent).toBe(true);
  });

  it('a throwing send is treated as failed, not an unhandled rejection', async () => {
    const q = createToggleQueue();
    const out = await q.run('r1', true, async () => { throw new Error('network'); });
    expect(out).toBe('failed');
  });

  it('keys are independent — different reels toggle concurrently', async () => {
    const q = createToggleQueue();
    let inFlight = 0;
    let maxInFlight = 0;
    const send = async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await tick();
      inFlight--;
      return true;
    };
    await Promise.all([q.run('a', true, send), q.run('b', true, send)]);
    expect(maxInFlight).toBe(2);
  });

  it('rapid alternating taps converge the server to the last desired state', async () => {
    const q = createToggleQueue();
    const serverWrites: boolean[] = [];
    const send = (v: boolean) => async () => { serverWrites.push(v); await tick(); return true; };
    await Promise.all([
      q.run('r1', true, send(true)),
      q.run('r1', false, send(false)),
    ]);
    expect(serverWrites).toEqual([true, false]); // ordered, last write = final UI state
  });
});
