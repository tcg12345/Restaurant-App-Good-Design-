import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { finishAiConsent, subscribeAiConsent } from '../lib/ai-consent';
import { PRIVACY_URL, openExternalUrl } from '../lib/external-links';
import { useGlassOccluder } from '../lib/glass-buttons';
import './Safety.css';

export function AiConsentDialog() {
  const { user } = useAuth();
  const [account, setAccount] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const occluder = useGlassOccluder();
  useEffect(() => subscribeAiConsent(setAccount), []);
  const close = (allowed: boolean) => { finishAiConsent(allowed && account === user?.id); setAccount(null); };
  useEffect(() => { if (account && account !== user?.id) { finishAiConsent(false); setAccount(null); } }, [account, user?.id]);
  useEffect(() => { if (account) dialog.current?.showModal(); }, [account]);
  if (!account) return null;
  return <dialog className="safety-dialog" ref={node => { dialog.current = node; occluder(node); }} aria-labelledby="ai-consent-title" onCancel={event => { event.preventDefault(); close(false); }} data-analytics-private>
    <h2 id="ai-consent-title">Before you use AI</h2>
    <p>GoodEats uses <strong>Anthropic and OpenAI</strong> to answer questions and create or import recipes.</p>
    <p>When you use these features, we send your messages and any photos, screenshots or recipe details you choose to use. For personalized answers, we may also send your profile details (display name, username and bio), dining or search area, food preferences, ratings and saved places or recipes.</p>
    <p>Only use content you have permission to share. You can decline and keep using the rest of GoodEats, or turn off AI sharing in Settings → Privacy & permissions.</p>
    <button className="safety-link" onClick={() => void openExternalUrl(PRIVACY_URL)}>Read the privacy policy</button>
    <div className="safety-actions"><button onClick={() => close(false)}>Not now</button><button className="safety-primary" onClick={() => close(true)}>Allow AI sharing</button></div>
  </dialog>;
}
