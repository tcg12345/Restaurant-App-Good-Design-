import { useEffect, useRef } from 'react';

/**
 * Focus a field AFTER its sheet's entrance animation settles, instead of
 * `autoFocus` (which fires on mount, mid-animation). On the native shell
 * that popped the iOS keyboard while the sheet was still transforming —
 * the two animations fight, the sheet stutters, and with
 * Keyboard.resize:"none" the keyboard could land before the --kb-height
 * padding did, briefly burying the very field being focused.
 *
 * Returns a ref to attach to the input/textarea. The default 300ms clears
 * the app's sheet entrances (0.25s tweens, ~0.3s springs).
 */
export function useDeferredFocus<T extends HTMLElement>(
  enabled = true,
  delayMs = 300,
) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => ref.current?.focus(), delayMs);
    return () => clearTimeout(t);
  }, [enabled, delayMs]);
  return ref;
}
