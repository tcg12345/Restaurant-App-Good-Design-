import type { CSSProperties } from 'react';

/**
 * Inline style for a bottom sheet that should RISE with the iOS keyboard
 * rather than be squashed by it — the comment popups, where the whole point
 * of opening the keyboard is to keep reading the thread you're replying to.
 *
 * Two halves, and the second is the one that was missing:
 *
 *  - `padding-bottom: --kb-height` keeps the composer above the keys. With
 *    Capacitor's `resize: "none"` the WebView is never resized, so without
 *    it the field sits behind the keyboard and you type blind.
 *  - the height GROWS by that same amount. Padding alone can't lift a sheet:
 *    under `box-sizing: border-box` it comes out of the sheet's own content,
 *    so the panel stayed exactly where it was and just got shorter — the
 *    keyboard ate the comment list. Growing the box by the keyboard's height
 *    moves the top edge up instead and hands the list its space back.
 *
 * Capped so the top edge always clears the notch, and eased on the same
 * curve (and roughly the same duration) as the iOS keyboard's own slide so
 * the two move together.
 *
 * `--kb-height` is only ever non-zero inside the native shell (see
 * lib/native-keyboard.ts), so on the web every value below collapses to the
 * plain resting height.
 */
export function keyboardLiftSheetStyle(restHeight: string): CSSProperties {
  return {
    height: `min(calc(${restHeight} + var(--kb-height, 0px)), calc(100% - max(10px, env(safe-area-inset-top, 0px))))`,
    paddingBottom: 'var(--kb-height, 0px)',
    transition: 'height 260ms cubic-bezier(0.32, 0.72, 0, 1)',
  };
}
