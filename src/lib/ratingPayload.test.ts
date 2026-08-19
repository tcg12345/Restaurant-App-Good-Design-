import { describe, it, expect } from 'vitest';
import { buildRatingPayload, type RatingPayloadData } from './ratingPayload';

const data = (over: Partial<RatingPayloadData> = {}): RatingPayloadData => ({
  name: 'Carbone', score: 9.1, notes: '', cuisine: 'Italian', price: '$$$',
  address: '181 Thompson St', visitDate: '2026-07-01', tags: [], wouldReturn: true,
  ...over,
});

const FIXED = 1_700_000_000_000;
const build = (activityAt: Parameters<typeof buildRatingPayload>[3], d = data()) =>
  buildRatingPayload('u1', 'rest1', d, activityAt, () => FIXED);

describe('buildRatingPayload', () => {
  // The whole point: an omitted key is left alone by the upsert, so a
  // housekeeping write can't move a rating in anyone's feed.
  it('omits updated_at entirely when the write is not activity', () => {
    expect('updated_at' in build(undefined)).toBe(false);
  });

  it("stamps now when the write IS activity", () => {
    expect(build('now').updated_at).toBe(new Date(FIXED).toISOString());
  });

  it('accepts an explicit moment for backfills', () => {
    expect(build(1_600_000_000_000).updated_at).toBe(new Date(1_600_000_000_000).toISOString());
  });

  it('treats a NaN stamp as not-activity rather than writing "Invalid Date"', () => {
    expect('updated_at' in build(Number.NaN)).toBe(false);
  });

  it('always writes the rating itself, activity or not', () => {
    for (const stamp of [undefined, 'now' as const]) {
      const p = build(stamp);
      expect(p.user_id).toBe('u1');
      expect(p.restaurant_id).toBe('rest1');
      expect(p.restaurant_name).toBe('Carbone');
      expect(p.score).toBe(9.1);
      expect(p.would_return).toBe(true);
      expect(p.friend_ids).toEqual([]);
    }
  });

  // Absent optional keys must stay absent: present-but-empty would
  // overwrite a good stored value with nothing.
  it('leaves unknown optional columns out of the payload', () => {
    const p = build(undefined);
    for (const k of ['lat', 'lng', 'photo_url', 'rating_method']) {
      expect(k in p).toBe(false);
    }
  });

  it('includes optional columns once they are known', () => {
    const p = build(undefined, data({ lat: 40.7, lng: -74, photoUrl: 'https://cdn/a.jpg', ratingMethod: 'h2h' }));
    expect(p.lat).toBe(40.7);
    expect(p.lng).toBe(-74);
    expect(p.photo_url).toBe('https://cdn/a.jpg');
    expect(p.rating_method).toBe('h2h');
  });

  it('keeps lat 0 / lng 0 (a real place on the equator), drops only null', () => {
    const p = build(undefined, data({ lat: 0, lng: 0 }));
    expect(p.lat).toBe(0);
    expect(p.lng).toBe(0);
  });
});
