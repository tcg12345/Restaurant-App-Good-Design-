/**
 * Contact syncing, client side — the thin layer over migration 079.
 *
 * Two independent consents, kept independent here too:
 *   findFriendsFromContacts()      — upload hashes, get matches back
 *   setContactDiscoverability()    — store (or delete) MY own hashes
 * Neither calls the other. Being findable is never a precondition for
 * finding people; making it one would be coercion dressed as a setting.
 *
 * What is uploaded is `sha256(normalized)` and nothing else. The raw
 * address book is read into a local variable in `findFriendsFromContacts`
 * and never leaves it — see lib/contact-matching.ts for the hashing and
 * lib/native-contacts.ts for the minimal projection that is read at all.
 */
import { supabase, supabaseConfigured } from './supabase';
import { readContacts } from './native-contacts';
import { buildContactEntries, batchHashes, type ContactEntry } from './contact-matching';
import { getProfilesByIds, type UserProfile } from './supabase-community';
import type { CountryCode } from './phone';

/** A person from the address book who turned out to have an account. */
export interface ContactMatch {
  profile: UserProfile;
  /** Their name as it appears in YOUR contacts — which is often the name
   *  you'd recognise, when their GoodEats display name isn't. */
  contactName: string;
}

export interface ContactSyncResult {
  matches: ContactMatch[];
  /** Contacts with no account, for the invite list. Names only — no
   *  numbers or addresses, because the invite goes out through the
   *  system share sheet where the user picks the recipient themselves. */
  unmatchedNames: string[];
  /** How many normalized identifiers were checked. Lets the UI say
   *  "we checked 812 contacts" rather than implying it read nothing. */
  checked: number;
}

/**
 * Read the address book, match it, and resolve the hits to profiles.
 *
 * Assumes permission has already been granted — call
 * `requestContactsPermission` behind an explainer first.
 */
export async function findFriendsFromContacts(region?: CountryCode): Promise<ContactSyncResult> {
  const empty: ContactSyncResult = { matches: [], unmatchedNames: [], checked: 0 };
  if (!supabaseConfigured) return empty;

  // The only place raw contacts exist. `entries` holds hashes from here on.
  const entries: ContactEntry[] = await buildContactEntries(await readContacts(), region);
  if (entries.length === 0) return empty;

  // hash → the contact it came from, so a match can be labelled. The
  // server echoes the matched hash back for exactly this.
  const byHash = new Map<string, ContactEntry>();
  for (const e of entries) if (!byHash.has(e.hash)) byHash.set(e.hash, e);

  /* userId → the hash that found them. Keyed per user, not globally: a
     person can match on both their phone and their email, and someone
     else entirely can match on a different hash in the same batch. */
  const hashByUser = new Map<string, string>();
  const matchedHashes = new Set<string>();
  for (const batch of batchHashes([...byHash.keys()])) {
    const { data, error } = await supabase.rpc('match_contacts', { p_hashes: batch });
    if (error) {
      // A rate-limit or missing-migration failure must not look like
      // "you know nobody here" — let the caller show a real error.
      throw new Error(error.message);
    }
    for (const row of (data ?? []) as Array<{ user_id: string; contact_hash: string }>) {
      if (!hashByUser.has(row.user_id)) hashByUser.set(row.user_id, row.contact_hash);
      matchedHashes.add(row.contact_hash);
    }
  }

  const profiles = await getProfilesByIds([...hashByUser.keys()]);

  // One row per matched person — matching on both phone and email is
  // still one person — labelled with the contact that found them.
  const matches: ContactMatch[] = [];
  for (const [userId, hash] of hashByUser) {
    const profile = profiles[userId];
    if (!profile) continue; // deleted between match and resolve
    matches.push({ profile, contactName: byHash.get(hash)?.name || '' });
  }

  // Names of contacts that matched nobody, deduped, for the invite list.
  const unmatchedNames = [...new Set(
    entries.filter((e) => !matchedHashes.has(e.hash) && e.name).map((e) => e.name),
  )];

  return { matches, unmatchedNames, checked: byHash.size };
}

/**
 * Opt in or out of being discoverable. Returns how many identifier rows
 * the account now has — 0 after opting out, and 0 after opting IN means
 * the account has nothing findable (an Apple private-relay address with
 * no phone number), which the UI should say out loud rather than leave
 * looking successful.
 */
/** What the server has stored for you, i.e. who can find you. */
export interface DiscoverabilityState {
  /** At least one identifier is stored — people who have it can find you. */
  enabled: boolean;
  /** Which ones: 'email', 'phone'. Drives honest copy — findable by email
   *  alone is a real, weaker state than findable by both. */
  kinds: string[];
  /** False when the read itself is unavailable (migration 082 not applied).
   *  The UI must not render "not findable" from an answer it never got —
   *  the same graceful-degradation rule getFollowListIds follows. */
  known: boolean;
}

/**
 * Read the caller's own discoverability. The table is RLS-locked with no
 * policies, so this has to come from a definer function (migration 082);
 * without it the card had no way to know it was already on, and offered
 * "Turn on" every time it mounted.
 */
export async function getContactDiscoverability(): Promise<DiscoverabilityState> {
  if (!supabaseConfigured) return { enabled: false, kinds: [], known: false };
  const { data, error } = await supabase.rpc('my_contact_discoverability');
  if (error) {
    console.warn('[contacts] discoverability read failed:', error.message);
    return { enabled: false, kinds: [], known: false };
  }
  const kinds = Array.isArray(data) ? data.filter((k): k is string => typeof k === 'string') : [];
  return { enabled: kinds.length > 0, kinds, known: true };
}

export async function setContactDiscoverability(enable: boolean): Promise<{ ok: boolean; identifiers: number; error?: string }> {
  if (!supabaseConfigured) return { ok: false, identifiers: 0, error: 'Not configured' };
  const { data, error } = await supabase.rpc('set_my_contact_discoverability', { enable });
  if (error) return { ok: false, identifiers: 0, error: error.message };
  return { ok: true, identifiers: typeof data === 'number' ? data : 0 };
}
