/**
 * The accent colour as a literal hex, for the places CSS variables can't
 * reach: Mapbox markers and paint properties. Read from the live token so
 * it follows the theme (graphite by day, bone by night) instead of being
 * a third copy of the palette. Falls back to the light value before the
 * stylesheet has applied.
 */
export function primaryHex(): string {
  if (typeof document === 'undefined') return '#1c1a19';
  const v = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim();
  return v || '#1c1a19';
}
