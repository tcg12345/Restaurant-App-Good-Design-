export type DiscoverSheetSnap = 'peek' | 'half' | 'full';
export function discoverSheetStops(height: number, chromeBottom: number) {
  const peek = Math.max(0, height - 71 - 78);
  const full = Math.min(chromeBottom, Math.max(0, peek - 120));
  const half = Math.max(full + 60, Math.min(peek - 60, Math.round(height * .48)));
  return { full, half, peek };
}
export function nearestDiscoverSnap(position: number, velocity: number, stops: Record<DiscoverSheetSnap, number>): DiscoverSheetSnap {
  const projected = position + Math.max(-2.4, Math.min(2.4, velocity)) * 180;
  return (['full', 'half', 'peek'] as const).reduce((best, snap) => Math.abs(stops[snap] - projected) < Math.abs(stops[best] - projected) ? snap : best, 'full');
}
