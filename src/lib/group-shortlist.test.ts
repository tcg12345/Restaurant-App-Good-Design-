import { describe, expect, it } from 'vitest';
import { fillShortlist } from '../../supabase/functions/group-swipe/shortlist';

describe('group shortlist coverage', () => {
  it('fills seven filtered places to ten unique places using additional pages', async () => {
    const pool = new Set(Array.from({ length: 7 }, (_, i) => i));
    const pages = [[4, 5, 7, 8], [8, 9]];
    const result = await fillShortlist({ count: 10, candidates: () => [...pool], deadline: Date.now() + 10000,
      next: () => { const page = pages.shift(); return page ? async () => { page.forEach(p => pool.add(p)); } : undefined; } });
    expect(result).toHaveLength(10);
    expect(new Set(result).size).toBe(10);
  });
  it('does not broaden a deck that already meets the count', async () => {
    let requests = 0;
    await fillShortlist({ count: 5, candidates: () => [1,2,3,4,5], deadline: Date.now() + 10000, next: () => { requests++; return async () => {}; } });
    expect(requests).toBe(0);
  });
  it('never silently publishes an undersized deck or retries without bounds', async () => {
    let requests = 0;
    await expect(fillShortlist({ count: 10, candidates: () => [1,2,3,4,5,6,7], deadline: Date.now() + 10000,
      next: () => async () => { requests++; } })).rejects.toThrow('Found 7 of 10');
    expect(requests).toBe(8);
  });
  it('keeps successful searches if another page fails', async () => {
    const pool = [1,2,3]; let request = 0;
    await expect(fillShortlist({ count: 5, candidates: () => pool, deadline: Date.now() + 10000,
      next: () => ++request === 1 ? async () => { throw Error('Unavailable'); } : request === 2 ? async () => { pool.push(4,5); } : undefined,
    })).resolves.toHaveLength(5);
  });
  it('stops at the generation deadline', async () => {
    let requests = 0;
    await expect(fillShortlist({ count: 5, candidates: () => [], deadline: Date.now() - 1,
      next: () => { requests++; return async () => {}; },
    })).rejects.toThrow('Found 0 of 5');
    expect(requests).toBe(0);
  });
});
