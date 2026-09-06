import React, { useEffect, useRef, useState } from 'react';
import { Check, Sparkles, Circle, X, ArrowLeft } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { PRO_WALKTHROUGH } from './ProWalkthroughVisuals';
import * as OB from './OnboardingKit';
import { usePurchase } from '../pro/usePurchase';
import { ctaFor, finePrintFor } from '../../lib/entitlements';
import { openExternalUrl, TERMS_URL, PRIVACY_URL } from '../../lib/external-links';
import { useSettings } from '../../contexts/SettingsContext';
import { logBillingEvent } from '../../lib/billing-events';
import { useAuth } from '../../contexts/AuthContext';

/** Visual benefit pages followed by a clear, optional plan choice. */
export const ProIntroStep: React.FC<{ onDone: () => void; finishing?: boolean; error?: string }> = ({ onDone, finishing, error }) => {
  const { user } = useAuth();
  const { setHideBottomNav } = useSettings();
  const p = usePurchase('onboarding');
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState(1);
  const reduce = useReducedMotion();
  const touch = useRef<{ x:number; y:number } | null>(null);
  const story = PRO_WALKTHROUGH[page];
  const onPlan = page === PRO_WALKTHROUGH.length;
  const move = (next: number) => {
    if (p.busy || finishing || p.phase === 'success' || p.phase === 'pending' || p.phase === 'web-sent') return;
    const target = Math.max(0, Math.min(PRO_WALKTHROUGH.length, next));
    setDirection(target > page ? 1 : -1);
    setPage(target);
  };
  const swipeProps: React.HTMLAttributes<HTMLDivElement> = {
    onTouchStart: e => { touch.current = e.touches.length === 1 ? { x:e.touches[0].clientX, y:e.touches[0].clientY } : null; },
    onTouchCancel: () => { touch.current = null; },
    onTouchEnd: e => {
      const start = touch.current; touch.current = null;
      if (!start || !e.changedTouches[0]) return;
      const dx=e.changedTouches[0].clientX-start.x, dy=e.changedTouches[0].clientY-start.y;
      if (Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.5) move(page + (dx<0?1:-1));
    },
  };
  useEffect(() => { setHideBottomNav(true); return () => setHideBottomNav(false); }, [setHideBottomNav]);
  useEffect(() => { logBillingEvent('paywall_shown', user?.id ?? null, { source: 'onboarding' }); }, [user?.id]);
  const done = () => {
    if (p.busy || finishing) return;
    logBillingEvent('paywall_dismissed', user?.id ?? null, { source: 'onboarding' });
    onDone();
  };
  const waiting = p.phase === 'web-sent' || p.phase === 'pending';
  const success = p.phase === 'success';
  const footer = <>
    {!success && !waiting && <div className="pro-walkthrough-progress" role="group" aria-label="Pro walkthrough pages">{[...PRO_WALKTHROUGH.map(s => s.label), 'Plans'].map((label, i) => <button key={label} aria-label={`Page ${i + 1}: ${label}`} aria-current={page === i ? 'step' : undefined} disabled={p.busy || finishing} onClick={() => move(i)}><span /></button>)}</div>}
    {(error || p.error) && <OB.ErrorRow>{error || p.error}</OB.ErrorRow>}
    {success ? <OB.PrimaryButton onClick={onDone} loading={finishing} trailing="check">Start exploring</OB.PrimaryButton>
      : waiting ? <>
        <OB.PrimaryButton onClick={() => { void p.checkStatus(); }} loading={p.busy}>Check upgrade status</OB.PrimaryButton>
        <OB.GhostButton onClick={done}>Continue to GoodEats</OB.GhostButton>
        {p.phase === 'web-sent' && <OB.GhostButton onClick={p.reset}>Choose a different plan</OB.GhostButton>}
      </> : !onPlan ? <>
        <OB.PrimaryButton onClick={() => move(page + 1)} disabled={finishing}>{page === PRO_WALKTHROUGH.length - 1 ? 'See plans' : 'Continue'}</OB.PrimaryButton>
        <OB.GhostButton onClick={done}>{finishing ? 'Finishing setup…' : 'Continue free'}</OB.GhostButton>
      </> : <>
        {p.offer && <p className="onboarding-pro-disclosure">{finePrintFor(p.offer)}</p>}
        <OB.PrimaryButton onClick={() => { void p.buy(); }} loading={p.busy} disabled={!p.available || p.loadingOffers} trailing="none">
          {p.offer ? p.offer.trialDays ? ctaFor(p.offer) : 'Upgrade to Pro' : 'Upgrade to Pro'}
        </OB.PrimaryButton>
        <OB.GhostButton onClick={done}>{finishing ? 'Finishing setup…' : 'Continue free'}</OB.GhostButton>
      </>}
    {(onPlan || waiting || success) && <div className="onboarding-pro-legal">
      {p.native && <button disabled={p.busy || finishing} onClick={() => { void p.restore(); }}>Restore purchases</button>}
      <button onClick={() => { void openExternalUrl(TERMS_URL); }}>Terms</button>
      <button onClick={() => { void openExternalUrl(PRIVACY_URL); }}>Privacy</button>
    </div>}
  </>;
  return <OB.OnboardingScreen header={<div className="pro-walkthrough-header">
    <div>{page > 0 && !waiting && !success ? <button aria-label="Previous Pro page" disabled={p.busy || finishing} onClick={() => move(page - 1)} className="glass-control"><ArrowLeft size={19} /></button> : <span className="pro-walkthrough-brand">GoodEats <span>Pro</span></span>}</div>
    {page > 0 && !waiting && !success && <span className="pro-walkthrough-brand">GoodEats <span>Pro</span></span>}
    <button aria-label="Continue without upgrading" disabled={p.busy || finishing} onClick={done} className="glass-control"><X size={20} /></button>
  </div>} footer={footer}>
    {!success && !waiting && story ? <motion.div key={story.id} className="pro-walkthrough-story"
      initial={reduce ? false : {opacity:0, x:24 * direction}} animate={{opacity:1,x:0}} transition={{duration:.35,ease:[.22,1,.36,1]}}
      {...swipeProps}>
      <story.Visual />
      <div className="pro-walkthrough-copy" aria-live="polite"><span className="pro-walkthrough-label">{story.label}</span><OB.Title>{story.title}</OB.Title><OB.Subtitle>{story.description}</OB.Subtitle></div>
    </motion.div> : <div className="pro-plan-content" {...swipeProps}>
    <OB.Reveal><div className="onboarding-pro-hero">
      <div className="onboarding-pro-mark">{success ? <Check size={28} /> : <Sparkles size={28} />}</div>
      <OB.Title>{success ? 'Welcome to Pro.' : waiting ? 'Your upgrade is on its way.' : 'Make it Pro.'}</OB.Title>
      <OB.Subtitle>{success ? 'You’re ready to explore.' : waiting ? p.phase === 'web-sent' ? 'Finish checkout in the tab that opened. We’ll update your plan here.' : 'We’re confirming your access. You can keep exploring while it updates.' : 'All your favorites, with more possibilities.'}</OB.Subtitle>
    </div></OB.Reveal>
    {!success && !waiting && <>
      {p.loadingOffers ? <p role="status">Loading plans…</p> : !p.available ? <div><OB.Subtitle>Plans couldn’t load. Try again or continue free.</OB.Subtitle><OB.GhostButton onClick={() => { void p.reloadOffers(); }}>Reload plans</OB.GhostButton></div> :
        <div className="onboarding-pro-plans" role="radiogroup" aria-label="Subscription plan">
          {p.offers.map(o => <button key={o.key} role="radio" aria-checked={p.offer?.key === o.key} disabled={p.busy} onClick={() => p.pick(o.key)} className="onboarding-pro-plan">
            {p.offer?.key === o.key ? <Check size={20} /> : <Circle size={20} />}
            <span><strong>{o.title}</strong>{o.trialDays > 0 && <small>{o.trialDays} days free</small>}</span>
            <span className="onboarding-pro-price"><strong>{o.priceLine}</strong>{o.perMonthLine && <small>{o.perMonthLine}, billed yearly</small>}</span>
          </button>)}
        </div>}
    </>}
    </div>}
  </OB.OnboardingScreen>;
};
