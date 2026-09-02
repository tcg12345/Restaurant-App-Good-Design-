import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Contact as ContactIcon, Loader2, Settings, Send, ShieldCheck } from 'lucide-react';
import { cn } from '../lib/utils';
import { PermissionPrimer } from './PermissionPrimer';
import {
  canUseNativeContacts, checkContactsPermission, requestContactsPermission,
  type ContactsPermissionStatus,
} from '../lib/native-contacts';
import {
  findFriendsFromContacts, getContactDiscoverability, setContactDiscoverability,
  type ContactMatch, type DiscoverabilityState,
} from '../lib/supabase-contacts';
import { shareExternally, canonicalShareUrl } from '../lib/native-share';
import { useToast } from '../contexts/ToastContext';
import type { UserProfile } from '../lib/supabase-community';

/**
 * "Find friends from your contacts".
 *
 * Four permission states, the same machine PhotoLibraryGrid runs:
 *   loading → spinner
 *   prompt  → explainer, then the system dialog on a deliberate tap
 *   denied  → explainer with "Open Settings" (iOS won't re-prompt)
 *   granted / limited → read, hash, match
 *
 * The explainer is not decoration. iOS asks once, and there is no second
 * chance from inside the app, so the reasons have to land before the
 * dialog appears — including what we DON'T do, which is the part people
 * actually worry about.
 *
 * Rendering is delegated: matched people go through the host's own row
 * renderer (CirclePanel's `personRow`) so they inherit the real
 * follow-state machine — following / requested / incoming / follow-back —
 * instead of this file growing a second, subtly different copy of it.
 */

export interface ContactsSyncProps {
  /** Per-row renderer — CirclePanel's personRow(profile, meta, index).
   *  Exactly one of renderPerson / renderPeople must be provided. */
  renderPerson?: (profile: UserProfile, meta: string, index: number) => React.ReactNode;
  /** List-level renderer for hosts that already have a people-list
   *  component with its own follow machinery (onboarding hands the
   *  matches to SuggestedPeople). Takes precedence over renderPerson. */
  renderPeople?: (matches: ContactMatch[]) => React.ReactNode;
  /** True when the account has no phone number on file — drives the soft
   *  prompt to add one, since an email-only account is findable by far
   *  fewer people. */
  lacksPhone?: boolean;
  /** Send the user to Settings → Account to add a phone number. */
  onAddPhone?: () => void;
  /** Native "open app settings", for the denied state. */
  onOpenSettings?: () => void;
  /**
   * How this host handles the one-shot iOS permission dialog.
   *
   * - `primer` (default) — show the explainer and let the user tap to
   *   ask. The safe default: iOS grants exactly one dialog and a denial
   *   is unrecoverable in-app, so the reasons land first.
   * - `auto` — ask on arrival, because arriving IS the invitation (the
   *   onboarding "Find some friends" step, whose header supplies the
   *   context). Denied → renders nothing; a wizard is no place to nag.
   * - `passive` — never ask. Sync only if permission was ALREADY
   *   granted, otherwise render nothing. For browse surfaces where an
   *   unprompted system dialog would be an ambush.
   */
  mode?: 'primer' | 'auto' | 'passive';
  /** Show the "Let friends find you" discoverability card. Off for
   *  surfaces that are a LIST — a settings card wedged between two
   *  people-lists reads as clutter. It stays on the Add friends page,
   *  which is where someone goes to manage this deliberately. */
  showDiscoverability?: boolean;
}

type Phase = 'loading' | 'idle' | 'syncing' | 'done' | 'error';

/**
 * Database internals are not something a user can act on — same rule as
 * ProfileSetup's `friendlyError`. "Could not find the function
 * public.match_contacts(p_hashes) in the schema cache" means a migration
 * hasn't been run, which is a deploy problem, not a user problem; the
 * real message still goes to the console for whoever is debugging.
 */
function friendlyContactError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  console.warn('[contacts] sync failed:', raw);
  if (/schema cache|does not exist|match_contacts/i.test(raw)) {
    return 'Contact matching isn’t available right now.';
  }
  if (/rate limit/i.test(raw)) {
    return 'You’ve checked your contacts a few times just now — try again in a little while.';
  }
  if (/not signed in/i.test(raw)) return 'Sign in to find friends from your contacts.';
  return 'Something went wrong reading your contacts.';
}

/**
 * What to call the identifiers someone could find you by. Prefers what the
 * server actually stored; falls back to what the account has when that read
 * isn't available (migration 082 not applied), so the sentence is never a
 * guess in the user's favour.
 */
function identifierWords(kinds: string[], lacksPhone?: boolean): string {
  const hasEmail = kinds.includes('email');
  const hasPhone = kinds.includes('phone');
  if (hasEmail && hasPhone) return 'number or email';
  if (hasPhone) return 'number';
  if (hasEmail) return 'email';
  return lacksPhone ? 'email' : 'number or email';
}

export const ContactsSync: React.FC<ContactsSyncProps> = ({
  renderPerson, renderPeople, lacksPhone, onAddPhone, onOpenSettings, mode = 'primer',
  showDiscoverability = true,
}) => {
  const { showToast } = useToast();
  const [permission, setPermission] = useState<ContactsPermissionStatus | 'unsupported'>('prompt');
  const [phase, setPhase] = useState<Phase>('loading');
  const [matches, setMatches] = useState<ContactMatch[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [checked, setChecked] = useState(0);
  const [error, setError] = useState('');
  /* Being findable is a SEPARATE consent from finding people, so it has
     its own control and is never implied by running a sync. Read back from
     the server rather than assumed off: this used to start false on every
     mount, so the card offered "Turn on" to people who were already on. */
  const [discover, setDiscover] = useState<DiscoverabilityState>({ enabled: false, kinds: [], known: false });
  const [discoverBusy, setDiscoverBusy] = useState(false);

  useEffect(() => {
    if (!showDiscoverability) return;
    let cancelled = false;
    void getContactDiscoverability().then((state) => { if (!cancelled) setDiscover(state); });
    return () => { cancelled = true; };
  }, [showDiscoverability]);

  useEffect(() => {
    if (!canUseNativeContacts()) { setPermission('unsupported'); setPhase('idle'); return; }
    let cancelled = false;
    void checkContactsPermission().then((p) => {
      if (cancelled) return;
      setPermission(p);
      setPhase('idle');
    });
    return () => { cancelled = true; };
  }, []);

  const runSync = useCallback(async () => {
    setPhase('syncing');
    setError('');
    try {
      const result = await findFriendsFromContacts();
      setMatches(result.matches);
      setUnmatched(result.unmatchedNames);
      setChecked(result.checked);
      setPhase('done');
    } catch (err) {
      setError(friendlyContactError(err));
      setPhase('error');
    }
  }, []);

  const handleGrant = useCallback(async () => {
    const next = await requestContactsPermission();
    setPermission(next);
    if (next === 'granted' || next === 'limited') void runSync();
  }, [runSync]);

  /* One shot per mount, guarded by a ref: this effect re-runs when the
     permission state lands, and firing the OS dialog twice would be a
     bug even if iOS ignored the second ask. */
  const autoFiredRef = useRef(false);
  useEffect(() => {
    if (phase !== 'idle' || autoFiredRef.current) return;
    if (permission === 'granted' || permission === 'limited') {
      // Access already exists in EVERY mode, primer included: there is
      // nothing to ask and nothing to explain, so making someone tap
      // "Check my contacts" first is a step that buys nothing.
      autoFiredRef.current = true;
      void runSync();
    } else if (mode === 'auto' && (permission === 'prompt' || permission === 'prompt-with-rationale')) {
      autoFiredRef.current = true;
      void handleGrant();
    }
  }, [mode, phase, permission, handleGrant, runSync]);

  const handleToggleDiscoverable = useCallback(async () => {
    const next = !discover.enabled;
    setDiscoverBusy(true);
    const { ok, identifiers, error: err } = await setContactDiscoverability(next);
    // Re-read rather than assume: the server decides what it could
    // actually store (a private-relay address yields nothing), and the
    // kinds it kept are what the copy below is written from. If the read
    // isn't available, fall back to what this write just did.
    const fresh = ok ? await getContactDiscoverability() : null;
    setDiscoverBusy(false);
    if (!ok) { showToast(err || "Couldn't update that"); return; }
    setDiscover(fresh?.known ? fresh : { enabled: next && identifiers > 0, kinds: [], known: true });
    if (next && identifiers === 0) {
      // Opted in but nothing to store — an Apple private-relay address
      // with no phone. Saying "done" here would be a lie.
      showToast('Nothing to match on yet', {
        subtitle: 'Add a phone number so friends can find you.',
        ...(onAddPhone ? { action: { label: 'Add', onClick: onAddPhone } } : {}),
      });
      return;
    }
    showToast(next ? 'Friends can find you' : 'You are no longer findable');
  }, [discover.enabled, showToast, onAddPhone]);

  const handleInvite = useCallback((name: string) => {
    // The user picks the app and sends it themselves — nothing is ever
    // sent on their behalf, and we never touch their SMS.
    void shareExternally({
      title: 'GoodEats',
      text: `${name ? `Hey ${name.split(' ')[0]} — ` : ''}I'm keeping my restaurant ratings on GoodEats. Join me?`,
      // canonicalShareUrl, not window.location: inside the native shell
      // the origin is capacitor://localhost, which is meaningless to
      // whoever receives this.
      url: canonicalShareUrl('/'),
    });
  }, []);

  // ── Permission gates ──
  if (permission === 'unsupported') {
    return (
      <p className="px-1 py-8 text-center text-[12.5px] text-on-surface/45">
        Finding friends from contacts is available in the GoodEats app.
      </p>
    );
  }

  if (phase === 'loading') {
    if (mode === 'passive') return null;
    return (
      <div className="flex justify-center py-10">
        <Loader2 size={18} className="animate-spin text-on-surface/30" />
      </div>
    );
  }

  if (permission === 'denied') {
    // Only the primer surface offers the Settings recovery route; the
    // others collapse rather than nag somewhere it doesn't belong.
    if (mode !== 'primer') return null;
    return (
      <PermissionPrimer
        icon={<Settings size={22} />}
        title="Find friends from your contacts"
        body="Contacts access is off. Turn it on in Settings and we'll show which of your contacts are already on GoodEats — your address book is never uploaded or stored."
        cta="Open Settings"
        onAction={() => onOpenSettings?.()}
      />
    );
  }

  if (permission === 'prompt' || permission === 'prompt-with-rationale') {
    // Passive: never asked, never will here — show nothing at all.
    if (mode === 'passive') return null;
    // Auto: the system dialog is (about to be) on screen — showing the
    // tap-to-ask primer underneath it would be a second, stale ask.
    if (mode === 'auto') {
      return (
        <div className="flex justify-center py-6">
          <Loader2 size={16} className="animate-spin text-on-surface/25" />
        </div>
      );
    }
    return (
      <PermissionPrimer
        icon={<ContactIcon size={22} />}
        title="Find friends you already know"
        body="We check which of your contacts are on GoodEats. Your address book is never uploaded or stored, and we never message anyone."
        cta="Find friends"
        onAction={() => { void handleGrant(); }}
        footer={
          <p className="flex items-center justify-center gap-1.5 text-[11.5px] text-on-surface/40">
            <ShieldCheck size={12} /> Scrambled on your device before it leaves
          </p>
        }
      />
    );
  }

  // ── Granted ──
  return (
    <div>
      {permission === 'limited' && (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-xl bg-amber-50 px-3 py-2 text-[11.5px] font-medium leading-snug text-amber-900">
          <span>Only the contacts you allowed are being checked.</span>
          <button type="button" onClick={() => onOpenSettings?.()} className="flex-shrink-0 font-semibold underline">
            Open Settings
          </button>
        </div>
      )}

      {phase === 'idle' && mode === 'primer' && (
        <div className="py-4">
          <button
            type="button"
            onClick={() => { void runSync(); }}
            className="w-full rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-bold text-on-primary active:opacity-80 transition-opacity"
          >
            Check my contacts
          </button>
        </div>
      )}

      {phase === 'syncing' && (
        <p className="flex items-center justify-center gap-2 py-8 text-[12.5px] font-medium text-on-surface/45">
          <Loader2 size={14} className="animate-spin text-primary/50" />
          Checking your contacts…
        </p>
      )}

      {phase === 'error' && (
        <div className="py-8 text-center">
          <p className="text-[13px] font-semibold text-on-surface">Couldn&rsquo;t check your contacts</p>
          <p className="mt-1 text-[12px] text-on-surface/50">{error}</p>
          <button
            type="button"
            onClick={() => { void runSync(); }}
            className="mt-3 rounded-full bg-on-surface px-4 py-2 text-[12.5px] font-bold text-surface"
          >
            Try again
          </button>
        </div>
      )}

      {phase === 'done' && (
        <>
          {matches.length > 0 ? (
            <>
              <h4 className="pt-3 pb-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/45">
                On GoodEats · {matches.length}
              </h4>
              {renderPeople ? renderPeople(matches) : (
                <ul>
                  {matches.map((m, i) => renderPerson?.(
                    m.profile,
                    m.contactName ? `${m.contactName} · in your contacts` : 'In your contacts',
                    i,
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="pt-2 pb-1 text-center text-[12.5px] text-on-surface/45">
              {checked > 0
                ? `None of your ${checked} contacts are on GoodEats yet.`
                : 'No contacts to check.'}
            </p>
          )}

          {/* Being findable yourself — the other half, and a separate
              decision. Placed after the results because it answers the
              question the results raise ("can they find me?").

              The toggle is ALWAYS the control here. It used to be replaced
              by "Add" whenever the account had no phone, which made a
              nudge into a gate: an email-only account could never opt in,
              even though the server stores an email hash just as happily
              and email is a real match key. The phone prompt survives as
              what it was meant to be — a second line about REACH, since
              address books hold numbers far more reliably than addresses. */}
          {showDiscoverability && (
          <div className="mt-4 rounded-2xl bg-on-surface/[0.04] px-3.5 py-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-on-surface">Let friends find you</p>
                <p className="mt-0.5 text-[11.5px] leading-snug text-on-surface/50">
                  {discover.enabled
                    ? `People who have your ${identifierWords(discover.kinds, lacksPhone)} can find your profile.`
                    : `Turn this on so people who have your ${identifierWords(discover.kinds, lacksPhone)} can find you.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { void handleToggleDiscoverable(); }}
                disabled={discoverBusy}
                className={cn(
                  'flex-shrink-0 rounded-full px-3.5 py-2 text-[12px] font-bold transition-opacity disabled:opacity-50',
                  discover.enabled ? 'bg-on-surface/[0.08] text-on-surface/60' : 'bg-on-surface text-surface',
                )}
              >
                {discoverBusy ? '…' : discover.enabled ? 'On' : 'Turn on'}
              </button>
            </div>
            {lacksPhone && onAddPhone && (
              <div className="mt-2.5 flex items-center gap-3 border-t border-on-surface/[0.07] pt-2.5">
                <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-on-surface/50">
                  Most people have your number, not your email — add it so more friends can find you.
                </p>
                <button
                  type="button"
                  onClick={onAddPhone}
                  className="flex-none rounded-full bg-on-surface/[0.08] px-3.5 py-2 text-[12px] font-bold text-on-surface active:opacity-70 transition-opacity"
                >
                  Add phone
                </button>
              </div>
            )}
          </div>
          )}

          {unmatched.length > 0 && (
            <>
              <h4 className="pt-4 pb-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/45">
                Invite
              </h4>
              <ul>
                {unmatched.slice(0, 25).map((name, i) => (
                  <li
                    key={`${name}-${i}`}
                    className={cn('flex items-center gap-3 py-2.5', i > 0 && 'border-t border-on-surface/[0.07]')}
                  >
                    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-on-surface/[0.06] font-serif text-[13px] font-bold text-on-surface/50">
                      {(name.trim()[0] || '?').toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-on-surface">{name}</span>
                    <button
                      type="button"
                      onClick={() => handleInvite(name)}
                      className="flex-none inline-flex items-center gap-1.5 rounded-full bg-on-surface/[0.06] px-3.5 py-2 text-[12px] font-bold text-on-surface/70 active:opacity-70 transition-opacity"
                    >
                      <Send size={12} /> Invite
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
};
