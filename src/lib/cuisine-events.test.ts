/**
 * The signal that says a cuisine changed.
 *
 * Small enough to look untestable, and load-bearing enough that it isn't:
 * without it an approved cuisine sat invisible behind a persisted meta
 * blob until the next time somebody opened the restaurant's detail page.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { announceCuisineChange, onCuisineChange, resetCuisineListeners } from './cuisine-events';

beforeEach(() => resetCuisineListeners());

describe('cuisine change events', () => {
  it('delivers the restaurant id to every listener', () => {
    const a = vi.fn();
    const b = vi.fn();
    onCuisineChange(a);
    onCuisineChange(b);
    announceCuisineChange('ChIJabc');
    expect(a).toHaveBeenCalledWith('ChIJabc');
    expect(b).toHaveBeenCalledWith('ChIJabc');
  });

  it('stops delivering once unsubscribed', () => {
    const fn = vi.fn();
    const off = onCuisineChange(fn);
    announceCuisineChange('a');
    off();
    announceCuisineChange('b');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('ignores an empty id rather than waking everything up', () => {
    const fn = vi.fn();
    onCuisineChange(fn);
    announceCuisineChange('');
    expect(fn).not.toHaveBeenCalled();
  });

  it('one listener throwing does not rob the others', () => {
    // The listeners are a context effect and a detail-page setState. If a
    // remounting component's handler throws, the card refresh must still
    // happen — otherwise one bad screen freezes the whole app's data.
    const boom = vi.fn(() => { throw new Error('nope'); });
    const after = vi.fn();
    onCuisineChange(boom as unknown as (id: string) => void);
    onCuisineChange(after);
    expect(() => announceCuisineChange('a')).not.toThrow();
    expect(after).toHaveBeenCalledWith('a');
  });

  it('survives a listener that unsubscribes during delivery', () => {
    // React effect cleanups can run inside a setState triggered by the
    // announce itself; iterating the live Set would skip a listener.
    const seen: string[] = [];
    const off = onCuisineChange(() => { seen.push('first'); off(); });
    onCuisineChange(() => seen.push('second'));
    announceCuisineChange('a');
    expect(seen).toEqual(['first', 'second']);
  });
});
