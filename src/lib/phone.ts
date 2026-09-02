/**
 * Phone numbers, in exactly one format: E.164 (`+15125550134`).
 *
 * Two features depend on this module agreeing with itself. Supabase Auth
 * requires E.164 for `signInWithOtp({ phone })` / `verifyOtp`, and contact
 * matching compares a hash of the number against a hash of what someone
 * else typed into their address book. The second one is why hand-rolled
 * digit-stripping is not good enough: "(512) 555-0134", "512-555-0134" and
 * "+1 512 555 0134" are the same person, but three different strings hash
 * three different ways, and a near-miss is indistinguishable from a
 * stranger. Both sides of a match MUST normalize through here.
 *
 * `libphonenumber-js/min` (not the full build) — the metadata for national
 * formatting of every region is far more than this app needs, and `min`
 * still parses and validates every country.
 */
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

/**
 * The country to assume when someone types a national number with no `+`.
 *
 * Read from the browser/WebView locale, which on iOS follows the device
 * region. This is a guess and is allowed to be wrong — every surface that
 * calls `toE164` pairs it with a visible country selector, because a
 * silently-wrong country turns "555-0134" into a valid number belonging to
 * a stranger in another country rather than into an error.
 */
export function deviceRegion(): CountryCode {
  try {
    const tag = typeof navigator !== 'undefined' ? navigator.language : '';
    // `new Intl.Locale('en-US').region` → 'US'. Not every runtime has
    // Intl.Locale, and a language-only tag ('en') has no region at all.
    const region = tag ? new Intl.Locale(tag).region : undefined;
    if (region && /^[A-Z]{2}$/.test(region)) return region as CountryCode;
  } catch { /* no Intl.Locale, or a malformed tag */ }
  return 'US';
}

/**
 * Anything a human might type → E.164, or null when it isn't a real number.
 *
 * Null rather than a best-effort string on purpose: a number that doesn't
 * parse must not reach Supabase (it would burn an SMS send against the
 * project's rate limit for a number that cannot receive it) and must not
 * reach the contact matcher (it would hash to a value nothing can match,
 * which looks identical to "no friends found"). Callers decide what to do
 * with the null; nobody gets a plausible-looking wrong answer.
 *
 * A leading `+` wins over `region` — an international number is already
 * unambiguous, and honouring the caller's region hint over the user's own
 * country code would corrupt it.
 */
export function toE164(raw: string, region: CountryCode = deviceRegion()): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = parsePhoneNumberFromString(trimmed, trimmed.startsWith('+') ? undefined : region);
    if (!parsed || !parsed.isValid()) return null;
    return parsed.number;
  } catch {
    // libphonenumber throws on some malformed input rather than returning
    // undefined; an unparseable number is just an invalid one.
    return null;
  }
}

/** True when `raw` is a real, dialable number in `region`. */
export function isValidPhone(raw: string, region?: CountryCode): boolean {
  return toE164(raw, region) !== null;
}

/**
 * E.164 → something readable ("+1 512 555 0134"), for confirmation screens
 * and the Settings row. Falls back to the input unchanged: this is display
 * only, and a number we somehow can't format is still better shown than
 * hidden.
 */
export function formatPhoneForDisplay(e164: string): string {
  try {
    const parsed = parsePhoneNumberFromString(e164);
    return parsed ? parsed.formatInternational() : e164;
  } catch {
    return e164;
  }
}

export type { CountryCode };
