import type mapboxgl from 'mapbox-gl';

/**
 * Quiet "Map unavailable" fallback for Mapbox containers.
 *
 * Mapbox fires 'error' for plenty of recoverable noise (a single missing
 * tile, an aborted request mid-pan), so only errors *before the style has
 * ever loaded* — no token, offline, style CDN unreachable — swap in the
 * fallback; those are the cases that otherwise leave a silent grey box.
 * Later errors are logged and ignored.
 *
 * Inline styles on theme CSS variables (not Tailwind classes) so the
 * overlay can't miss the utility scan and adapts to dark mode for free.
 */
export function attachMapErrorFallback(map: mapboxgl.Map, container: HTMLElement | null) {
  let loaded = false;
  let shown = false;
  map.on('load', () => { loaded = true; });
  map.on('error', (e) => {
    const message = (e as { error?: { message?: string } })?.error?.message ?? 'unknown';
    console.warn('[map] error:', message);
    if (loaded || shown || !container) return;
    shown = true;
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:absolute', 'inset:0', 'z-index:10',
      'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
      'gap:4px', 'text-align:center', 'padding:0 24px',
      'background:var(--color-muted)', 'color:var(--color-on-surface)',
    ].join(';');
    const title = document.createElement('span');
    title.textContent = 'Map unavailable';
    title.style.cssText = 'font-size:14px;font-weight:600;';
    const hint = document.createElement('span');
    hint.textContent = 'Check your connection and try again.';
    hint.style.cssText = 'font-size:12px;opacity:0.55;';
    overlay.append(title, hint);
    container.appendChild(overlay);
  });
}
