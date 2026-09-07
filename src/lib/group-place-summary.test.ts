import { expect, it, vi } from 'vitest';
import { conciseSummary, generateSummary, selectSummaryPlace } from '../../supabase/functions/group-place-summary/summary';
it('only selects facts from the authorized room deck', () => {
  const place = { id: 'one', name: 'Room restaurant' };
  expect(selectSummaryPlace({ deck: [place] }, 'one')).toBe(place);
  expect(selectSummaryPlace({ deck: [place] }, 'outside')).toBeNull();
  expect(selectSummaryPlace({ error: 'Not a member', deck: [place] }, 'one')).toBeNull();
});
it('limits overviews to two complete sentences and rejects incomplete or empty text', () => {
  expect(conciseSummary('Italian cooking. A relaxed setting. Extra sentence.')).toBe('Italian cooking. A relaxed setting.');
  expect(conciseSummary('A restaurant on W. 23rd St. serves Italian food. Another sentence. Third sentence.')).not.toContain('Third sentence');
  expect(() => conciseSummary('')).toThrow();
  expect(() => conciseSummary('An unfinished description')).toThrow();
  expect(() => conciseSummary('word '.repeat(66) + '.')).toThrow();
});
it('uses a small bounded AI request grounded in server facts and provider editorial text', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ editorialSummary: { text: 'A small Italian dining room.' } }))).mockResolvedValueOnce(new Response(JSON.stringify({ content: [{ type: 'text', text: 'Italian cooking in a small dining room.' }] })));
  await expect(generateSummary({ id: 'place', name: 'Test restaurant', cuisine: 'Italian', address: '1 Main St' }, { anthropic: 'test', places: 'test' }, fetcher)).resolves.toBe('Italian cooking in a small dining room.');
  const request = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(request.max_tokens).toBe(150);
  expect(request.system).toContain('Use ONLY the supplied facts');
  expect(JSON.parse(request.messages[0].content).editorial).toBe('A small Italian dining room.');
  expect(fetcher.mock.calls[0][1].headers['X-Goog-FieldMask']).toBe('editorialSummary');
});
it('uses known room facts if Places is unavailable, but never disguises an AI failure as generated prose', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(Error('Timeout')).mockResolvedValueOnce(new Response(JSON.stringify({ content: [{ type: 'text', text: 'A restaurant serving Italian food.' }] })));
  await expect(generateSummary({ id: 'place', name: 'Test', cuisine: 'Italian' }, { anthropic: 'test', places: 'test' }, fetcher)).resolves.toBe('A restaurant serving Italian food.');
  await expect(generateSummary({ id: 'place', name: 'Test' }, { anthropic: 'test' }, vi.fn().mockResolvedValue(new Response('', { status: 503 })))).rejects.toThrow('unavailable');
});
