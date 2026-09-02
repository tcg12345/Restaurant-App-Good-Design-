/**
 * Reading the device address book, for "find friends you already know".
 *
 * Shaped like lib/native-photos.ts: the platform branch lives in the
 * plugin's own web fallback rather than in `if (isNativePlatform())` at
 * every call site, and UI code branches on the exported
 * `canUseNativeContacts()` predicate instead. There is no web Contacts
 * API worth using (the Contact Picker is Chrome-on-Android only and asks
 * the user to hand-pick entries), so on the web this feature simply
 * isn't offered.
 *
 * ── The one rule this module exists to enforce ───────────────────────
 * Raw contacts are read, converted to hashes, and dropped. They are
 * never stored, never put in React state, never logged. `readContacts`
 * returns the minimum projection needed for that — names, numbers,
 * emails — and nothing else: no photos, no addresses, no birthdays,
 * no notes.
 *
 * iOS shows the contacts prompt exactly once and a denial cannot be
 * re-prompted in-app, so callers MUST show an explainer before calling
 * `requestPermission` (see PermissionPrimer). That is also why
 * `checkPermission` is separate from requesting.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { RawContact } from './contact-matching';
import { PhotoLibrary } from './native-photos';

/** iOS 18 added a partial-access state where the user grants only some
 *  cards; `limited` is a working state, not a failure — it just means
 *  fewer matches than the user probably expects. */
export type ContactsPermissionStatus =
  | 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' | 'limited';

interface ContactsPluginShape {
  checkPermissions(): Promise<{ contacts: ContactsPermissionStatus }>;
  requestPermissions(): Promise<{ contacts: ContactsPermissionStatus }>;
  getContacts(options: { projection: Record<string, boolean> }): Promise<{
    contacts: Array<{
      contactId: string;
      name?: { display: string | null } | null;
      phones?: Array<{ number: string | null }> | null;
      emails?: Array<{ address: string | null }> | null;
    }>;
  }>;
}

const Contacts = registerPlugin<ContactsPluginShape>('Contacts', {
  // Web fallback, same convention as native-photos: permission getters
  // resolve to a benign 'denied' so callers can render a state, and the
  // data getter throws so nothing silently believes it read an empty
  // address book.
  web: {
    async checkPermissions() { return { contacts: 'denied' as ContactsPermissionStatus }; },
    async requestPermissions() { return { contacts: 'denied' as ContactsPermissionStatus }; },
    async getContacts(): Promise<never> {
      throw new Error('Contacts are only available in the app.');
    },
  },
});

/** Whether to offer the feature at all. */
export function canUseNativeContacts(): boolean {
  return Capacitor.isNativePlatform();
}

export async function checkContactsPermission(): Promise<ContactsPermissionStatus> {
  try {
    const { contacts } = await Contacts.checkPermissions();
    return contacts;
  } catch {
    return 'denied';
  }
}

/** Triggers the system prompt. Only call this from an explicit user
 *  action taken after the explainer — iOS gives exactly one shot. */
export async function requestContactsPermission(): Promise<ContactsPermissionStatus> {
  try {
    const { contacts } = await Contacts.requestPermissions();
    return contacts;
  } catch {
    return 'denied';
  }
}

/**
 * The address book, reduced to what matching needs. The projection is
 * deliberately minimal: asking for less is both faster on a large book
 * and the honest thing to request from someone who just granted access
 * to their entire contact list.
 */
export async function readContacts(): Promise<RawContact[]> {
  const { contacts } = await Contacts.getContacts({
    projection: { name: true, phones: true, emails: true },
  });
  return contacts.map((c) => ({
    name: c.name?.display ?? null,
    phones: (c.phones ?? []).map((p) => p.number ?? '').filter(Boolean),
    emails: (c.emails ?? []).map((e) => e.address ?? '').filter(Boolean),
  }));
}
