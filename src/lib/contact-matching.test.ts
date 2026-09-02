import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { normalizeContacts, batchHashes, sha256Hex, buildContactEntries, MATCH_BATCH_SIZE } from './contact-matching';

/* Web Crypto exists in Node 22's global scope, so sha256Hex runs as-is.
   These digests are cross-checked against node:crypto rather than
   hard-coded, since the whole point is agreeing with an independent
   SHA-256 implementation — the one in Postgres. */
const nodeSha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('normalizeContacts', () => {
  it('normalizes phones to E.164 and emails to lowercase', () => {
    const out = normalizeContacts([
      { name: 'Maya Chen', phones: ['(512) 555-0134'], emails: ['  Maya@Example.COM '] },
    ], 'US');
    expect(out).toEqual([
      { value: '+15125550134', name: 'Maya Chen', kind: 'phone' },
      { value: 'maya@example.com', name: 'Maya Chen', kind: 'email' },
    ]);
  });

  it('dedupes the same number written different ways', () => {
    // The realistic case: one card lists it under "mobile" and "iPhone",
    // and a duplicate card lists it again. All one hash.
    const out = normalizeContacts([
      { name: 'Maya', phones: ['(512) 555-0134', '512-555-0134', '+1 512 555 0134'] },
      { name: 'Maya Chen (work)', phones: ['5125550134'] },
    ], 'US');
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe('+15125550134');
  });

  it('keeps a phone and an email from the same person as separate entries', () => {
    const out = normalizeContacts([
      { name: 'Sam', phones: ['5125550134'], emails: ['sam@example.com'] },
    ], 'US');
    expect(out.map((e) => e.kind)).toEqual(['phone', 'email']);
  });

  it('drops numbers that cannot be dialed rather than sending them', () => {
    // They can never match, and the request is capped at 2000 — an
    // unparseable number is spent budget.
    const out = normalizeContacts([
      { name: 'Junk', phones: ['123', 'n/a', '', 'not a phone'] },
    ], 'US');
    expect(out).toHaveLength(0);
  });

  it('drops obvious non-emails', () => {
    const out = normalizeContacts([
      { name: 'Junk', emails: ['home', 'n/a', '', 'nodomain@'] },
    ], 'US');
    expect(out).toHaveLength(0);
  });

  it('survives contacts with no name and no fields', () => {
    expect(() => normalizeContacts([{}, { name: null }, { phones: [] }], 'US')).not.toThrow();
    expect(normalizeContacts([{}, { name: null }], 'US')).toEqual([]);
  });

  it('does NOT strip gmail dots or +tags', () => {
    // Provider-specific folklore. Guessing wrong would hash one person's
    // address into another's, which is worse than a missed match.
    const out = normalizeContacts([
      { name: 'A', emails: ['first.last+food@gmail.com'] },
    ], 'US');
    expect(out[0].value).toBe('first.last+food@gmail.com');
  });
});

describe('sha256Hex', () => {
  it('matches an independent SHA-256 implementation', async () => {
    // This is the contract with Postgres' digest(): if these ever
    // disagree, matching silently returns nothing.
    for (const s of ['+15125550134', 'maya@example.com', '']) {
      expect(await sha256Hex(s)).toBe(nodeSha(s));
    }
  });
});

describe('buildContactEntries', () => {
  it('returns hashes and names, never the raw identifiers', async () => {
    const entries = await buildContactEntries([
      { name: 'Maya Chen', phones: ['(512) 555-0134'] },
    ], 'US');
    expect(entries).toEqual([
      { hash: nodeSha('+15125550134'), name: 'Maya Chen', kind: 'phone' },
    ]);
    // Nothing in the payload should resemble the input.
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain('5125550134');
    expect(serialized).not.toContain('512');
  });
});

describe('batchHashes', () => {
  it('splits at the server cap', () => {
    const hashes = Array.from({ length: MATCH_BATCH_SIZE * 2 + 5 }, (_, i) => String(i));
    const batches = batchHashes(hashes);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(MATCH_BATCH_SIZE);
    expect(batches[2]).toHaveLength(5);
    // No hash lost or duplicated.
    expect(batches.flat()).toEqual(hashes);
  });

  it('handles an empty address book', () => {
    expect(batchHashes([])).toEqual([]);
  });
});
