/**
 * Turning an address book into something safe to send.
 *
 * The contract with migration 079: the client sends `sha256(normalized)`
 * hex digests and nothing else, the server re-hashes each with a secret
 * pepper before comparing, and the raw address book never leaves the
 * device. This module is the "normalized" half of that, and it has to
 * agree byte-for-byte with what `set_my_contact_discoverability` computes
 * for the account's own identifiers — a near-miss hashes to something
 * completely different and is indistinguishable from "no friends found".
 *
 * Normalization rules, both mirrored in the migration:
 *   phone → E.164 with a leading '+'  (lib/phone.ts#toE164)
 *   email → lowercase, trimmed
 *
 * Email is normalized conservatively on purpose: no gmail dot-stripping
 * or +tag removal. Those are provider-specific conventions, and guessing
 * wrong would silently match one person's hash to another's address.
 *
 * Pure and DOM-free apart from Web Crypto, so the risky part — the
 * normalization everything else depends on — is unit-testable.
 */
import { toE164, type CountryCode } from './phone';

/** One address-book entry, as the native plugin hands it over. */
export interface RawContact {
  name?: string | null;
  phones?: string[];
  emails?: string[];
}

/** A single hashable identifier, with enough context to render a row. */
export interface ContactEntry {
  /** sha256 hex of the normalized identifier — the only thing sent. */
  hash: string;
  /** The contact's display name, kept on-device to label a match. */
  name: string;
  kind: 'phone' | 'email';
}

/** sha256 hex, via Web Crypto (available in the WKWebView and every
 *  browser this app runs in). */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Every normalized identifier in an address book, deduped.
 *
 * Deduping matters for more than tidiness: the same number typically
 * appears under "mobile" and "iPhone" on one card and again on a
 * duplicate card, and the request is capped at 2000 hashes server-side,
 * so duplicates are spent budget. Keyed by `kind:value` so a person with
 * both an email and a phone contributes both.
 *
 * Unparseable numbers are dropped rather than sent: they can never match
 * anything, and dropping them buys back room under the cap.
 */
export function normalizeContacts(
  contacts: RawContact[],
  region?: CountryCode,
): Array<{ value: string; name: string; kind: 'phone' | 'email' }> {
  const seen = new Set<string>();
  const out: Array<{ value: string; name: string; kind: 'phone' | 'email' }> = [];

  for (const contact of contacts) {
    const name = (contact.name || '').trim();
    for (const raw of contact.phones ?? []) {
      const e164 = toE164(raw, region);
      if (!e164) continue;
      const key = `phone:${e164}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ value: e164, name, kind: 'phone' });
    }
    for (const raw of contact.emails ?? []) {
      const email = (raw || '').trim().toLowerCase();
      // Cheap sanity check only — this is not validation, just a guard
      // against hashing obvious junk ("home", "n/a") into the budget.
      if (!email || !email.includes('@') || !email.includes('.')) continue;
      const key = `email:${email}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ value: email, name, kind: 'email' });
    }
  }
  return out;
}

/** Normalize + hash, ready to send. The raw values are dropped here and
 *  never returned, so nothing upstream can accidentally transmit them. */
export async function buildContactEntries(
  contacts: RawContact[],
  region?: CountryCode,
): Promise<ContactEntry[]> {
  const normalized = normalizeContacts(contacts, region);
  return Promise.all(
    normalized.map(async ({ value, name, kind }) => ({
      hash: await sha256Hex(value),
      name,
      kind,
    })),
  );
}

/** Server-side cap from migration 079. Kept here so the batcher and the
 *  function can't drift. */
export const MATCH_BATCH_SIZE = 2000;

/** Split into request-sized batches. */
export function batchHashes(hashes: string[], size = MATCH_BATCH_SIZE): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < hashes.length; i += size) batches.push(hashes.slice(i, i + size));
  return batches;
}
