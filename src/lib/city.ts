/**
 * City parsing + normalization helpers.
 *
 * Used to tag guide entries with the city of their restaurant (so a guide
 * surfaces on a city's Location page when it includes a spot there) and to
 * compare a guide's declared / derived city against the city being explored.
 *
 * The matching is deliberately forgiving on case / accents / punctuation but
 * does NOT try to reconcile boroughs or adjacent municipalities with their
 * parent metro (e.g. "Brooklyn" ≠ "New York"). For those, the guide author
 * can set the explicit city tag in the creator.
 */

/** Google Places v1 address component. */
export interface AddressComponent {
  longText: string;
  shortText: string;
  types: string[];
}

/**
 * Pull the city ("locality") out of Google Places v1 address components.
 * Falls back through postal_town (UK) / sublocality / county so we still
 * get a sensible label when a place lacks a clean locality component.
 */
export function cityFromAddressComponents(
  components?: AddressComponent[] | null,
): string {
  if (!components || components.length === 0) return '';
  const find = (type: string) =>
    components.find((c) => Array.isArray(c.types) && c.types.includes(type));
  const c =
    find('locality') ||
    find('postal_town') ||
    find('sublocality') ||
    find('administrative_area_level_3') ||
    find('administrative_area_level_2');
  return (c?.longText || '').trim();
}

const COUNTRY_RE =
  /^(usa|u\.?s\.?a?\.?|united states( of america)?|canada|mexico|uk|u\.?k\.?|united kingdom|england|scotland|wales|ireland|australia|new zealand|france|italy|spain|germany|japan)$/i;
// "NY 10001", "CA 94110-1234", "ON M5V 2T6" — a state/province token glued to
// a postal code. The token after the state must contain a digit, so real city
// names ("Mexico City") aren't mistaken for "state + zip".
const STATE_ZIP_RE = /^[A-Za-z]{2,}\.?\s+[A-Za-z]?\d[\dA-Za-z\- ]*$/;
// A bare postal code on its own segment: US/EU numeric ("10001", "75004") or a
// UK postcode ("SW1A 1AA", "M5V 2T6"). Strict on purpose so a "postcode city"
// segment ("75004 Paris") is kept and its leading postcode stripped later.
const ZIP_ONLY_RE = /^\d[\d\- ]*$|^[A-Za-z]{1,2}\d[\dA-Za-z]?\s*\d[A-Za-z]{2}$/;
// A bare two-letter state/province abbreviation ("NY", "CA").
const STATE_ABBR_RE = /^[A-Za-z]{2}$/;

/**
 * Best-effort city extraction from a formatted address string.
 *
 *   "1397 W 6th St, Cleveland, OH 44113, USA" → "Cleveland"
 *   "New York, NY, USA"                       → "New York"
 *   "12 Rue de Rivoli, 75004 Paris, France"   → "Paris"
 *
 * Strategy: split on commas, drop a trailing country token, then drop a
 * trailing "state + zip" / zip / state token. Whatever city-ish token is
 * then last is the city (the part before it, when present, is the street).
 */
export function cityFromAddress(address?: string | null): string {
  if (!address) return '';
  const parts = address
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';

  // Drop a trailing country.
  if (COUNTRY_RE.test(parts[parts.length - 1])) parts.pop();
  if (parts.length === 0) return '';

  // Drop a trailing "STATE ZIP" / zip / state token, leaving the city last.
  const last = parts[parts.length - 1];
  if (
    parts.length > 1 &&
    (STATE_ZIP_RE.test(last) || ZIP_ONLY_RE.test(last) || STATE_ABBR_RE.test(last))
  ) {
    parts.pop();
  }

  let city = (parts[parts.length - 1] || '').trim();
  // Some European addresses prefix the city with its postal code in the same
  // comma segment ("75004 Paris" → "Paris").
  city = city.replace(/^\d[\dA-Za-z\- ]*\s+/, '').trim();
  // …and some glue the postcode onto the END ("London NW1 6XE" → "London",
  // "Boston 02115" → "Boston"). Strip a trailing UK / Canadian / numeric
  // postcode.
  city = city
    .replace(/\s+(?:[A-Za-z]{1,2}\d[\dA-Za-z]?\s*\d[A-Za-z]{2}|\d{4,}(?:-\d{4})?)$/, '')
    .trim();
  return city;
}

/** Lowercase, strip accents + punctuation, collapse whitespace — for
 *  case/diacritic-insensitive city equality. */
export function normalizeCity(s?: string | null): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** True when two city strings refer to the same city (both non-empty). */
export function sameCity(a?: string | null, b?: string | null): boolean {
  const na = normalizeCity(a);
  const nb = normalizeCity(b);
  return na.length > 0 && na === nb;
}
