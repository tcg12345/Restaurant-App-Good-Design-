import React, { useEffect, useRef, useState } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Star, Utensils } from 'lucide-react';
import { useCalendar } from '../../contexts/CalendarContext';
import { useAuth } from '../../contexts/AuthContext';
import { useLists } from '../../contexts/ListsContext';
import { isOverlayOpen, subscribeOverlay } from '../../lib/overlay-registry';
import { dayKey, needsPlanReview, type CalendarPlan } from '../../lib/calendar';
import { CalendarDialog } from './CalendarDialog';
import '../../pages/CalendarPage.css';

/** One invitation per app opening, never on top of another composer or dialog. */
export function VisitReviewPrompt() {
  const { user } = useAuth();
  const { plans, loading, save, refresh } = useCalendar();
  const { ratings, openAddRestaurantModal } = useLists();
  const [prompt, setPrompt] = useState<CalendarPlan | null>(null);
  const [cycle, setCycle] = useState(0);
  const [overlay, setOverlay] = useState(isOverlayOpen());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const handled = useRef(false);
  const lock = useRef(false);
  useEffect(() => subscribeOverlay(setOverlay), []);
  useEffect(() => { setPrompt(null); handled.current = false; }, [user?.id]);
  useEffect(() => {
    const awaken = () => { handled.current = false; setCycle(c => c + 1); };
    const visible = () => { if (document.visibilityState === 'visible') awaken(); };
    document.addEventListener('visibilitychange', visible);
    let disposed = false;
    let off: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) void NativeApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) { void refresh(); awaken(); }
    }).then(listener => { if (disposed) void listener.remove(); else off = () => { void listener.remove(); }; }).catch(() => {});
    return () => { disposed = true; off?.(); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  useEffect(() => {
    if (!user || loading || overlay || prompt || handled.current || document.visibilityState === 'hidden') return;
    const candidate = plans.filter(p => needsPlanReview(p, Date.now(), ratings)).sort((a, b) => +new Date(b.ends_at) - +new Date(a.ends_at))[0];
    if (!candidate) return;
    const timer = setTimeout(() => {
      if (isOverlayOpen() || document.visibilityState === 'hidden' || handled.current) return;
      handled.current = true; setError(''); setPrompt(candidate);
    }, 1200);
    return () => clearTimeout(timer);
  }, [plans, ratings, loading, user, overlay, prompt, cycle]);
  async function respond(change: Partial<CalendarPlan>) {
    if (!prompt || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await save({ ...prompt, ...change }); setPrompt(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'Couldn’t save your choice. Please try again.'); }
    finally { lock.current = false; setBusy(false); }
  }
  const later = () => { if (!lock.current) void respond({ snoozed_until: new Date(Date.now() + 86_400_000).toISOString() }); };
  // A fresh server read can cancel/delete a plan while the prompt is open.
  const current = prompt && plans.find(p => p.id === prompt.id);
  useEffect(() => {
    if (prompt && (!current || !needsPlanReview(current, Date.now(), ratings))) setPrompt(null);
  }, [prompt, current, ratings]);
  if (!prompt || !current || !user || !needsPlanReview(current, Date.now(), ratings)) return null;
  return <CalendarDialog title={`How was ${prompt.title}?`} subtitle="A little reflection on a meal you planned." onClose={later}>
    <div className="meal-review-prompt"><span className="meal-review-icon"><Utensils size={30} /><Star size={19} /></span><p>You had a visit planned for {new Date(prompt.starts_at).toLocaleDateString([], { month: 'long', day: 'numeric' })}. If you made it, save what you thought.</p>
      <button className="meal-button primary full" disabled={busy} onClick={() => {
        setPrompt(null);
        openAddRestaurantModal(prompt.details.restaurant ?? { id: `calendar-${prompt.id}`, name: prompt.title, image: '', cuisine: '', price: '', address: prompt.details.location }, 'new-visit', dayKey(prompt));
      }}><Star size={17} /> Rate my visit</button>
      <button className="meal-button secondary full" disabled={busy} onClick={later}>Remind me tomorrow</button>
      <div className="meal-review-skip"><button disabled={busy} onClick={() => void respond({ status: 'cancelled' })}>I didn’t go</button><button disabled={busy} onClick={() => void respond({ review_state: 'dismissed' })}>Skip this review</button></div>
      {error && <p className="meal-error" role="alert">{error}</p>}
    </div>
  </CalendarDialog>;
}
