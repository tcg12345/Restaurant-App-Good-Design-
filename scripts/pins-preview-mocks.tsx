/** Local preview state only; never writes to an account. */
import { useState } from 'react';
import { togglePin, type PinnedItem } from '../src/lib/pins';
export const useSettings = () => ({ phoneMode: true });
export function usePins() {
 const [pins, setPins] = useState<PinnedItem[]>([]);
 return { pins, toggle: async (pin: PinnedItem) => { setPins(previous => togglePin(previous, pin) ?? previous); return 'pinned'; }, replace: async (next: PinnedItem[]) => { setPins(next); return true; } };
}
