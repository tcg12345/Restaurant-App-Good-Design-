import { useEffect, useState } from 'react';

/**
 * Live layout-viewport size. Re-renders on window resize, orientation
 * change, and visualViewport resize — the triggers a bottom sheet's
 * geometry actually cares about.
 *
 * The VALUE is window.innerWidth/Height (the layout viewport), not the
 * visualViewport rect: with Capacitor's Keyboard.resize:"none" the web
 * view is never resized for the keyboard, so innerHeight stays stable
 * while typing — sheet snap points must not jump when the keyboard
 * opens. visualViewport is only used as an extra *trigger* (it fires
 * reliably on iPad rotation where a plain resize can lag); if it fires
 * for a keyboard-only change, innerHeight is unchanged and the state
 * update below bails without a re-render.
 */
export function useViewportSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 400,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));
  useEffect(() => {
    const update = () => {
      setSize((prev) => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        return prev.width === width && prev.height === height ? prev : { width, height };
      });
    };
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      vv?.removeEventListener('resize', update);
    };
  }, []);
  return size;
}
