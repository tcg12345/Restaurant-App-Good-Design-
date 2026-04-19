// Great-circle distance in miles between two lat/lng points (Haversine).
export function haversineDistanceMi(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8; // Earth radius, miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Render a mile distance as a compact label (e.g. "0.4 mi", "12 mi").
// Returns '' for non-positive or non-finite values so call sites can
// conditionally render with `&&`.
export function formatDistance(miles: number): string {
  if (!Number.isFinite(miles) || miles <= 0) return '';
  if (miles < 0.1) return '< 0.1 mi';
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}
