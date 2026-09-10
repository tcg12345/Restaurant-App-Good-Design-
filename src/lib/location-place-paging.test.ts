import { describe, expect, it, vi } from 'vitest';
import { fetchPlaceCursorBatch } from './location-place-paging';
import type { PlaceResult, SearchPageResult } from './places';
const page = (id: string, nextPageToken: string | null = null): SearchPageResult => ({ places: [{ id } as PlaceResult], nextPageToken });

describe('location pagination checkpoints', () => {
  it('preserves a failed cursor while publishing successful pages; retries only unfinished queries', async () => {
    const original = [{ query: 'ramen', pageToken: 'ramen-2' }, { query: 'sushi' }];
    const load = vi.fn().mockResolvedValueOnce(page('ramen-result')).mockRejectedValueOnce(new Error('offline'));
    const first = await fetchPlaceCursorBatch(original, 3, load, new AbortController().signal);
    expect(original).toEqual([{ query: 'ramen', pageToken: 'ramen-2' }, { query: 'sushi' }]);
    expect(first.pages.flat().map(p => p.id)).toEqual(['ramen-result']);
    expect(first.failed).toBe(true);
    expect(first.exhausted).toBe(false);
    expect(first.cursors[1]).toEqual({ query: 'sushi' });
    load.mockResolvedValueOnce(page('sushi-result', 'sushi-2'));
    const retry = await fetchPlaceCursorBatch(first.cursors, 3, load, new AbortController().signal);
    expect(load.mock.calls[2][0]).toEqual({ query: 'sushi' });
    expect(retry.pages.flat().map(p => p.id)).toEqual(['sushi-result']);
    expect(retry.failed).toBe(false);
    expect(retry.cursors[1].pageToken).toBe('sushi-2');
  });

  it('does not record an outage as end of results', async () => {
    const original = [{ query: 'restaurants', pageToken: 'page-2' }];
    const result = await fetchPlaceCursorBatch(original, 3, async () => { throw new Error('429'); }, new AbortController().signal);
    expect(result.cursors).toEqual(original);
    expect(result.exhausted).toBe(false);
    expect(result.failed).toBe(true);
  });

  it('recognizes successful empty last pages and skips already exhausted queries', async () => {
    const load = vi.fn().mockResolvedValue({ places: [], nextPageToken: null });
    const result = await fetchPlaceCursorBatch([{ query: 'done', drained: true }, { query: 'remaining' }], 3, load, new AbortController().signal);
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.exhausted).toBe(true);
    expect(result.failed).toBe(false);
  });

  it('cannot publish old-city results after the user switches location, even if the transport ignores abort', async () => {
    const controller = new AbortController();
    let finish!: (value: SearchPageResult) => void;
    const cursors = [{ query: 'old city' }];
    const pending = fetchPlaceCursorBatch(cursors, 1, () => new Promise(resolve => { finish = resolve; }), controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    finish(page('old-result', 'old-page-2'));
    await assertion;
    expect(cursors).toEqual([{ query: 'old city' }]);
  });

  it('does not fetch after cancellation', async () => {
    const controller = new AbortController(); controller.abort();
    const load = vi.fn();
    await expect(fetchPlaceCursorBatch([{ query: 'cancelled' }], 1, load, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(load).not.toHaveBeenCalled();
  });

  it('returns page rows with each successful checkpoint before a later batch fails', async () => {
    const load = vi.fn().mockResolvedValueOnce(page('retained-row', 'next')).mockRejectedValueOnce(new Error('network'));
    const first = await fetchPlaceCursorBatch([{ query: 'city' }], 1, load, new AbortController().signal);
    const second = await fetchPlaceCursorBatch(first.cursors, 1, load, new AbortController().signal);
    expect(first.pages.flat().map(p => p.id)).toEqual(['retained-row']);
    expect(second.cursors).toEqual(first.cursors);
    expect(second.failed).toBe(true);
    expect(second.exhausted).toBe(false);
  });
});
