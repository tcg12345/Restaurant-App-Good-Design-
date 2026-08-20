// React hook for resolving a restaurant's Michelin record on card/list/row
// render paths (which can't await the dataset's dynamic import).
//
// It kicks off the dataset load on first use and returns the match
// synchronously once the index is in memory, re-rendering subscribers when the
// data lands. Until then it returns null, so cards render normally with their
// Google-derived cuisine/price and upgrade in place when Michelin data arrives.

import { useEffect, useState } from 'react';
import { displayCuisine } from './cuisine';
import {
  findMichelinMatchSync,
  isMichelinIndexReady,
  michelinPriceDisplay,
  preloadMichelinIndex,
  type MichelinInfo,
} from './michelin';

// Module-level readiness fan-out: the dataset loads once, and every mounted
// hook instance flips from "not ready" to "ready" together via these
// subscribers — no per-card polling.
let ready = isMichelinIndexReady();
let polling = false;
const subscribers = new Set<() => void>();

function ensureLoading() {
  if (ready || polling) return;
  polling = true;
  preloadMichelinIndex();
  // Poll the module flag until the (in-flight) import resolves, then notify all
  // mounted hooks once. Single-flight via `polling`, so N cards don't each
  // start a loop. Stops forever once ready.
  const tick = () => {
    if (isMichelinIndexReady()) {
      ready = true;
      polling = false;
      subscribers.forEach((fn) => fn());
      return;
    }
    setTimeout(tick, 50);
  };
  setTimeout(tick, 50);
}

/**
 * Subscribe to dataset readiness without resolving a specific restaurant. Use
 * in list/search screens that match many rows in a useMemo (hooks can't run
 * per-row): gate the memo on this flag, and call findMichelinMatchSync for each
 * row. Triggers the dataset load and re-renders once it's ready.
 */
export function useMichelinIndexReady(): boolean {
  const [, force] = useState(0);
  useEffect(() => {
    if (ready) return;
    const sub = () => force((n) => n + 1);
    subscribers.add(sub);
    ensureLoading();
    return () => { subscribers.delete(sub); };
  }, []);
  return ready;
}

export interface MichelinMatchResult {
  michelin: MichelinInfo | null;
  /** Cuisine to display: Michelin's when matched, else the provided fallback. */
  cuisine: string;
  /** Price to display: Michelin's $-tier when matched, else the fallback. */
  price: string;
}

/**
 * Resolve Michelin overrides for a restaurant card/row.
 *
 * @param name           Restaurant name.
 * @param lat            Latitude (optional — matching is far better with it).
 * @param lng            Longitude.
 * @param address        Address (used for the name-only fallback).
 * @param fallbackCuisine Cuisine to show when there's no Michelin match.
 * @param fallbackPrice   Price to show when there's no Michelin match.
 */
export function useMichelinMatch(
  name: string,
  lat: number | undefined,
  lng: number | undefined,
  address: string | undefined,
  fallbackCuisine: string,
  fallbackPrice: string,
): MichelinMatchResult {
  const [, force] = useState(0);

  useEffect(() => {
    if (ready) return;
    const sub = () => force((n) => n + 1);
    subscribers.add(sub);
    ensureLoading();
    return () => { subscribers.delete(sub); };
  }, []);

  const michelin = ready && name ? findMichelinMatchSync(name, lat, lng, address) : null;
  return {
    michelin,
    // The fallback is a SAVED cuisine, and saved cuisines still carry the
    // word "Restaurant" from the years the resolver answered that when it
    // didn't know. Every card in the app reads its cuisine through here, so
    // this is the one place that has to refuse to repeat it.
    cuisine: michelin ? michelin.cuisine : displayCuisine(fallbackCuisine),
    price: michelin ? michelinPriceDisplay(michelin) : fallbackPrice,
  };
}
