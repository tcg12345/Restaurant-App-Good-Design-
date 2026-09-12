// Storage migration must run before any app module reads the stored data.
import './lib/storage-migration';
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { resolveEntry } from './landing/entry';
import { LaunchScreen } from './components/LaunchScreen';

let webAppChosen = false;
try { webAppChosen = sessionStorage.getItem('goodeats-web-app') === '1'; } catch { /* private browsing */ }
const entry = resolveEntry(
  new URL(window.location.href),
  Capacitor.isNativePlatform(),
  window.matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone,
  webAppChosen,
);
if (entry.remember) {
  try { sessionStorage.setItem('goodeats-web-app', '1'); } catch { /* navigation still works */ }
}
if ('replace' in entry && entry.replace) window.history.replaceState(window.history.state, '', entry.replace);
const Surface = entry.surface === 'landing'
  ? lazy(() => import('./landing/LandingPage'))
  : lazy(() => import('./AppRuntime'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<LaunchScreen />}>
      <Surface />
    </Suspense>
  </StrictMode>,
);
