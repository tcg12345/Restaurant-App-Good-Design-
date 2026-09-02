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

// A trailing segment that names a country is dropped before the city is
// read. Names only — an earlier "shape" rule (drop any digit-free final
// segment) turned "Osteria, Via Roma 5, Bologna" into "Via Roma 5" and
// "…, Marylebone, London" into "Marylebone". If a country is missing here
// its addresses read the country as the city, which is wrong but
// harmless; a shape rule that eats real cities is not.
const COUNTRY_RE = new RegExp(
  `^(?:afghanistan|albania|algeria|andorra|angola|antigua and barbuda|argentina|armenia|aruba|australia|austria|azerbaijan|bahamas|bahrain|bangladesh|barbados|belarus|belgium|belize|benin|bermuda|bhutan|bolivia|bosnia and herzegovina|botswana|brazil|brunei|bulgaria|burkina faso|burundi|cambodia|cameroon|canada|cape verde|cabo verde|cayman islands|central african republic|chad|chile|china|colombia|comoros|congo|costa rica|croatia|cuba|curaçao|curacao|cyprus|czechia|czech republic|denmark|djibouti|dominica|dominican republic|ecuador|egypt|el salvador|england|equatorial guinea|eritrea|estonia|eswatini|ethiopia|fiji|finland|france|french polynesia|gabon|gambia|georgia|germany|ghana|gibraltar|greece|greenland|grenada|guam|guatemala|guernsey|guinea|guinea-bissau|guyana|haiti|honduras|hong kong|hungary|iceland|india|indonesia|iran|iraq|ireland|republic of ireland|isle of man|israel|italy|ivory coast|côte d'ivoire|cote d'ivoire|jamaica|japan|jersey|jordan|kazakhstan|kenya|kiribati|kosovo|kuwait|kyrgyzstan|laos|latvia|lebanon|lesotho|liberia|libya|liechtenstein|lithuania|luxembourg|macau|macao|madagascar|malawi|malaysia|maldives|mali|malta|marshall islands|mauritania|mauritius|mexico|micronesia|moldova|monaco|mongolia|montenegro|morocco|mozambique|myanmar|burma|namibia|nauru|nepal|netherlands|the netherlands|new caledonia|new zealand|nicaragua|niger|nigeria|north korea|north macedonia|northern ireland|norway|oman|pakistan|palau|palestine|panama|papua new guinea|paraguay|peru|philippines|poland|portugal|puerto rico|qatar|romania|russia|russian federation|rwanda|saint kitts and nevis|saint lucia|saint vincent and the grenadines|st\.? lucia|samoa|san marino|sao tome and principe|saudi arabia|scotland|senegal|serbia|seychelles|sierra leone|singapore|slovakia|slovenia|solomon islands|somalia|south africa|south korea|korea|south sudan|spain|sri lanka|sudan|suriname|sweden|switzerland|syria|taiwan|tajikistan|tanzania|thailand|timor-leste|east timor|togo|tonga|trinidad and tobago|tunisia|turkey|türkiye|turkmenistan|turks and caicos islands|tuvalu|uganda|ukraine|united arab emirates|uae|united kingdom|uk|u\.?k\.?|great britain|britain|united states|united states of america|usa|u\.?s\.?a?\.?|us virgin islands|u\.s\. virgin islands|british virgin islands|uruguay|uzbekistan|vanuatu|vatican city|venezuela|vietnam|viet nam|wales|yemen|zambia|zimbabwe)$`,
  'i',
);
// "NY 10001", "CA 94110-1234", "ON M5V 2T6" — a state/province token glued to
// a postal code. The token after the state must contain a digit, so real city
// names ("Mexico City") aren't mistaken for "state + zip".
// The abbreviation is 2–3 letters; a longer word is a city with its
// postcode glued on ("London N1 1AB", "Tokyo 104-0061") UNLESS it is a
// spelled-out state ("Ohio 43215", "Queensland 4000") — see STATE_NAME_RE.
const STATE_ZIP_RE = /^[A-Za-z]{2,3}\.?\s+[A-Za-z]?\d[\dA-Za-z\- ]*$/;
// "<spelled-out state> <postcode>" — US states, Canadian provinces and
// Australian states, the places whose addresses are written that way.
const STATE_NAME_ZIP_RE = new RegExp(
  '^(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia|puerto rico|alberta|british columbia|manitoba|new brunswick|newfoundland and labrador|nova scotia|ontario|prince edward island|quebec|québec|saskatchewan|yukon|northwest territories|nunavut|new south wales|victoria|queensland|south australia|western australia|tasmania|northern territory|australian capital territory)\\s+[A-Za-z]?\\d[\\dA-Za-z\\- ]*$',
  'i',
);
// A bare postal code on its own segment: US/EU numeric ("10001", "75004") or a
// UK postcode ("SW1A 1AA", "M5V 2T6"). Strict on purpose so a "postcode city"
// segment ("75004 Paris") is kept and its leading postcode stripped later.
const ZIP_ONLY_RE = /^\d[\d\- ]*$|^[A-Za-z]{1,2}\d[\dA-Za-z]?\s*\d[A-Za-z]{2}$/;
// A bare two-letter state/province abbreviation ("NY", "CA").
const STATE_ABBR_RE = /^[A-Za-z]{2}$/;
// A postcode at the FRONT of the city segment: "75004 Paris", "1016 GV
// Amsterdam" (Dutch: digits + two capitals), "110 00 Praha" (Czech: two
// digit groups). Written without spaces inside the character class so the
// SQL mirror (POSIX, longest-match) and JavaScript (leftmost-greedy) agree.
const LEADING_POSTCODE_RE = /^\d[\dA-Za-z\-]*(?:\s+(?:[A-Z]{1,2}|\d{2,3}))?\s+/;
// A postcode glued to the END: "London NW1 6XE", "Boston 02115", "Tokyo 104-0061".
const TRAILING_POSTCODE_RE = /\s+(?:[A-Za-z]{1,2}\d[\dA-Za-z]?\s*\d[A-Za-z]{2}|\d[\d-]{3,})$/;

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
    (STATE_ZIP_RE.test(last) || STATE_NAME_ZIP_RE.test(last) || ZIP_ONLY_RE.test(last) || STATE_ABBR_RE.test(last))
  ) {
    parts.pop();
  }

  let city = (parts[parts.length - 1] || '').trim();
  // Some European addresses prefix the city with its postal code in the same
  // comma segment ("75004 Paris" → "Paris").
  city = city.replace(LEADING_POSTCODE_RE, '').trim();
  // …and some glue the postcode onto the END ("London NW1 6XE" → "London",
  // "Boston 02115" → "Boston", "Tokyo 104-0061" → "Tokyo"). Strip a
  // trailing UK / Canadian / numeric postcode.
  city = city.replace(TRAILING_POSTCODE_RE, '').trim();
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
