/** Development-only visual review. This entry is not part of the production build.
 * It deliberately has no AuthProvider, so it cannot create or change an account. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PreAuthFlow } from '../src/components/onboarding/PreAuthFlow';
import { Auth } from '../src/pages/Auth';
import { ProfileSetup } from '../src/pages/ProfileSetup';
import { NotificationsOnboardingPage } from '../src/components/onboarding/NotificationsStep';
import '../src/index.css';

function NotificationPreview({ onDone }: { onDone: () => void }) {
  const [enabled, setEnabled] = useState(false);
  return <NotificationsOnboardingPage step={7} total={7} onBack={onDone} onDone={onDone}
    notifications={{ native: true, permission: enabled ? 'granted' : 'prompt', preferences: { enabled }, loading: false, busy: false, error: '', enable: async () => setEnabled(true) }} />;
}

function Preview() {
  const [screen, setScreen] = useState('Taste');
  const [dark, setDark] = useState(document.documentElement.classList.contains('dark'));
  const [revision, setRevision] = useState(0);
  return <>
    <nav aria-label="Preview controls" style={{ height: 44, display: 'flex', alignItems: 'center', gap: 16, padding: '0 16px', font: '12px system-ui', background: 'var(--color-surface)', color: 'var(--color-ink)', borderBottom: '1px solid var(--color-line)' }}>
      {['Taste', 'Account', 'Profile', 'Notifications'].map(s => <button key={s} onClick={() => setScreen(s)} aria-pressed={screen === s}>{s}</button>)}
      <button onClick={() => { document.documentElement.classList.toggle('dark', !dark); setDark(!dark); }}>{dark ? 'Light' : 'Dark'}</button>
      <button onClick={() => { setScreen('Taste'); setRevision(n => n + 1); }}>Restart</button>
    </nav>
    <div style={{ '--app-vh': 'calc(100dvh - 44px)' } as React.CSSProperties}>
      {screen === 'Taste' ? <PreAuthFlow key={revision} onExit={() => setScreen('Account')} onBrowseAsGuest={() => setScreen('Account')} />
        : screen === 'Account' ? <Auth saveTasteFraming /> : screen === 'Notifications' ? <NotificationPreview onDone={() => setScreen('Taste')} /> : <ProfileSetup />}
    </div>
  </>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
