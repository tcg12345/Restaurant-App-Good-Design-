/**
 * The paywall sheet — GoodEats Pro, in one screen.
 *
 * Top to bottom (the plan, section 8): a context line when a feature opened
 * it, the eyebrow and "Your taste, deeper.", five benefits with the
 * triggering one first, the plan selector (annual first, "Best value"),
 * the CTA, the fine print, and the footer Apple requires — Restore, Terms,
 * Privacy. No gradient, no confetti; the one warm note is the champagne
 * tag. Dark mode inverts through the tokens.
 *
 * States: the CTA becomes a spinner and the sheet locks dismissal while
 * StoreKit is up; success cross-fades to "Welcome to Pro" and closes; a
 * cancel says nothing; an error says nothing was charged and offers Retry.
 * On the web the CTA opens Stripe Checkout in a new tab and the sheet
 * turns into "Finish in your browser".
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Check, Loader2, MessageSquare, ChefHat, Fingerprint, Users, UserRound } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { usePlan } from '../../contexts/PlanContext';
import { useBottomSheet } from '../../lib/useBottomSheet';
import { isNativeRuntime } from '../../lib/native-oauth';
import { openExternalUrl, TERMS_URL, PRIVACY_URL } from '../../lib/external-links';
import { billingAvailable, getNativeOffers, purchaseNative, restoreNative, syncPlanWithServer, startWebCheckout, webOffers, type NativeOffer } from '../../lib/billing';
import { logBillingEvent } from '../../lib/billing-events';
import { benefitsFor, ctaFor, finePrintFor, DEFAULT_PLAN, type FeatureKey, type PlanOffer, type PlanKey, type BenefitKey } from '../../lib/entitlements';

const BENEFIT_ICON: Record<BenefitKey, React.FC<{ size?: number }>> = {
  assistant: MessageSquare, recipes: ChefHat, taste: Fingerprint, together: Users, account: UserRound,
};

/** The plan radio rows — shared with the Pro page. */
export const PlanPicker: React.FC<{ offers: PlanOffer[]; value: PlanKey; onChange: (k: PlanKey) => void; disabled?: boolean }> = ({ offers, value, onChange, disabled }) => (
  <div className="space-y-2" role="radiogroup" aria-label="Plan">
    {offers.map((o) => {
      const on = o.key === value;
      return (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={on}
          disabled={disabled}
          onClick={() => onChange(o.key)}
          className={cn('w-full flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors disabled:opacity-60', on ? 'border-primary ring-1 ring-primary' : 'border-on-surface/[0.12]')}
        >
          <span className={cn('flex-none w-4 h-4 rounded-full border-2 flex items-center justify-center', on ? 'border-primary' : 'border-on-surface/30')}>
            {on && <span className="w-2 h-2 rounded-full bg-primary" />}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-on-surface" style={{ fontSize: '14.5px', fontWeight: 700 }}>{o.title}</span>
            <span className="block text-on-surface/55 mt-0.5" style={{ fontSize: '12.5px' }}>{o.priceLine}{o.perMonthLine ? ` · ${o.perMonthLine}` : ''}</span>
          </span>
          {o.tag && (
            <span className="flex-none rounded-full px-2 py-1" style={{ fontSize: '9.5px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-accent-ink, #7a6534)', background: 'color-mix(in srgb, var(--color-accent) 22%, transparent)' }}>
              {o.tag}
            </span>
          )}
        </button>
      );
    })}
  </div>
);

export const ProSheet: React.FC<{
  open: boolean;
  source: string;
  feature: FeatureKey | null;
  reason: string | null;
  onClose: () => void;
  onUnlocked: () => void;
}> = ({ open, source, feature, reason, onClose, onUnlocked }) => {
  const { phoneMode } = useSettings();
  const { user, isSignedIn } = useAuth();
  const { showToast } = useToast();
  const plan = usePlan();
  const native = isNativeRuntime();
  const [nativeOffers, setNativeOffers] = useState<NativeOffer[] | null>(null);
  const [selected, setSelected] = useState<PlanKey>(DEFAULT_PLAN);
  const [phase, setPhase] = useState<'pick' | 'busy' | 'success' | 'web-sent' | 'error'>('pick');
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const locked = phase === 'busy';
  const { dragProps, sheetRef } = useBottomSheet(open && !locked, onClose, scrollRef);

  useEffect(() => {
    if (!open) return;
    setPhase('pick'); setError(''); setSelected(DEFAULT_PLAN);
    if (native) { setNativeOffers(null); void getNativeOffers().then(setNativeOffers); }
  }, [open, native]);

  const offers: PlanOffer[] = useMemo(() => {
    if (native) return nativeOffers && nativeOffers.length ? nativeOffers : [];
    return webOffers();
  }, [native, nativeOffers]);
  const offer = offers.find((o) => o.key === selected) ?? offers[0];
  const available = billingAvailable() && (!native || (nativeOffers !== null && nativeOffers.length > 0));
  const benefits = useMemo(() => benefitsFor(feature), [feature]);

  const buy = async () => {
    if (!offer || locked) return;
    if (!isSignedIn) { showToast('Sign in to subscribe'); return; }
    logBillingEvent('purchase_started', user?.id ?? null, { source, feature, plan: offer.key });
    if (native) {
      const pkg = (offer as NativeOffer).pkg;
      setPhase('busy');
      const res = await purchaseNative(pkg);
      if (!res.ok) {
        if (res.cancelled) { setPhase('pick'); return; }
        setError(res.message); setPhase('error');
        logBillingEvent('purchase_failed', user?.id ?? null, { source, feature, plan: offer.key, meta: { message: res.message } });
        return;
      }
      await syncPlanWithServer();
      await plan.refresh();
      logBillingEvent('purchased', user?.id ?? null, { source, feature, plan: offer.key });
      setPhase('success');
      window.setTimeout(() => { onUnlocked(); showToast('Welcome to Pro'); }, 900);
      return;
    }
    setPhase('busy');
    const res = await startWebCheckout(offer.key);
    if (!res.ok) { setError(res.message); setPhase('error'); return; }
    setPhase('web-sent');
  };

  const restore = async () => {
    if (locked) return;
    setPhase('busy');
    const res = await restoreNative();
    if (!res.ok) { setPhase('pick'); if (!res.cancelled) showToast("Couldn't restore", { subtitle: res.message }); return; }
    await syncPlanWithServer();
    await plan.refresh();
    if (res.entitlement.active) {
      logBillingEvent('restored', user?.id ?? null, { source, feature });
      setPhase('success');
      window.setTimeout(() => { onUnlocked(); showToast('Welcome back to Pro'); }, 900);
    } else {
      setPhase('pick');
      showToast('No purchases to restore', { subtitle: 'Nothing on this Apple ID unlocks Pro.' });
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className={cn('fixed inset-0 z-[120]', phoneMode ? 'bg-black/45 backdrop-blur-sm' : 'bg-black/55 backdrop-blur-md flex items-start justify-center pt-[8vh] px-4')}
          onClick={() => { if (!locked) onClose(); }}
        >
          <motion.div
            ref={sheetRef}
            {...(phoneMode
              ? { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' }, transition: { duration: 0.42, ease: [0.32, 0.72, 0, 1] as const }, ...dragProps }
              : { initial: { opacity: 0, scale: 0.94, y: -12 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: 0.96, y: -8 }, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const } })}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className={cn('bg-surface flex flex-col overflow-hidden', phoneMode ? 'fixed bottom-0 left-0 right-0 rounded-t-[28px] max-h-[92vh]' : 'w-full max-w-md rounded-[28px] max-h-[84vh] shadow-[0_30px_80px_-16px_rgba(0,0,0,0.42)] ring-1 ring-on-surface/[0.06]')}
            role="dialog"
            aria-modal="true"
            aria-label="GoodEats Pro"
          >
            {phoneMode && <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>}
            <button type="button" onClick={onClose} disabled={locked} aria-label="Close" className="absolute top-3 right-3 h-9 w-9 rounded-full flex items-center justify-center text-on-surface/45 hover:bg-on-surface/[0.06] hover:text-on-surface disabled:opacity-30">
              <X size={17} />
            </button>

            <div ref={scrollRef} className={cn('flex-1 overflow-y-auto', phoneMode ? 'px-5 pt-3 pb-4' : 'px-7 pt-6 pb-5')}>
              {phase === 'success' ? (
                <div className="py-14 flex flex-col items-center text-center">
                  <span className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--color-accent) 22%, transparent)', color: 'var(--color-accent-ink, #7a6534)' }}><Check size={24} /></span>
                  <p className="mt-4 font-serif font-bold text-on-surface" style={{ fontSize: '24px', letterSpacing: '-0.01em' }}>Welcome to Pro</p>
                  <p className="mt-1 text-on-surface/55" style={{ fontSize: '13.5px' }}>Your taste, deeper. Everything's unlocked.</p>
                </div>
              ) : phase === 'web-sent' ? (
                <div className="py-14 flex flex-col items-center text-center">
                  <p className="font-serif font-bold text-on-surface" style={{ fontSize: '22px', letterSpacing: '-0.01em' }}>Finish in your browser</p>
                  <p className="mt-2 text-on-surface/55 max-w-[30ch]" style={{ fontSize: '13.5px', lineHeight: 1.5 }}>Checkout opened in a new tab. Pro turns on here the moment it’s done.</p>
                  <button type="button" onClick={onClose} className="mt-6 rounded-full border border-on-surface/15 px-5 h-11 text-on-surface" style={{ fontSize: '13.5px', fontWeight: 700 }}>Done</button>
                </div>
              ) : (
                <>
                  {reason && (
                    <p className="inline-block max-w-full truncate rounded-full bg-on-surface/[0.06] px-3 py-1.5 text-on-surface/60 mb-3" style={{ fontSize: '12px', fontWeight: 600 }}>{reason}</p>
                  )}
                  <p className="text-on-surface/45" style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase' }}>GoodEats Pro</p>
                  <h2 className="font-serif font-bold text-on-surface mt-1.5" style={{ fontSize: phoneMode ? '28px' : '30px', lineHeight: 1.05, letterSpacing: '-0.015em' }}>Your taste, deeper.</h2>

                  <ul className="mt-5 space-y-2.5">
                    {benefits.map((b) => {
                      const Icon = BENEFIT_ICON[b.key];
                      return (
                        <li key={b.key} className="flex items-center gap-3">
                          <span className="flex-none w-9 h-9 rounded-[13px] flex items-center justify-center text-primary" style={{ background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)' }}><Icon size={16} /></span>
                          <span className="min-w-0">
                            <span className="block text-on-surface" style={{ fontSize: '14px', fontWeight: 700 }}>{b.title}</span>
                            <span className="block text-on-surface/50" style={{ fontSize: '12px' }}>{b.sub}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <a href="/pro" className="inline-block mt-2.5 text-on-surface/55 underline-offset-2 hover:underline" style={{ fontSize: '12.5px', fontWeight: 600 }} onClick={onClose}>See everything in Pro</a>

                  <div className="mt-5">
                    {native && nativeOffers === null ? (
                      <div className="flex items-center gap-2 text-on-surface/45 py-3" style={{ fontSize: '13px' }}><Loader2 size={14} className="animate-spin" /> Loading plans…</div>
                    ) : offers.length === 0 ? (
                      <p className="rounded-2xl bg-on-surface/[0.05] px-4 py-3 text-on-surface/60" style={{ fontSize: '13px', lineHeight: 1.45 }}>
                        Purchases aren’t set up in this build yet. Everything stays free until they are.
                      </p>
                    ) : (
                      <PlanPicker offers={offers} value={offer?.key ?? DEFAULT_PLAN} onChange={(k) => { setSelected(k); logBillingEvent('plan_selected', user?.id ?? null, { source, feature, plan: k }); }} disabled={locked} />
                    )}
                  </div>

                  {phase === 'error' && (
                    <p className="mt-3 text-score-low-ink" style={{ fontSize: '12.5px', fontWeight: 600 }}>{error || 'The purchase didn’t go through. Nothing was charged.'}</p>
                  )}
                </>
              )}
            </div>

            {phase !== 'success' && phase !== 'web-sent' && (
              <div className={cn('flex-shrink-0 border-t border-on-surface/[0.06]', phoneMode ? 'px-5 pt-3 pb-[max(14px,env(safe-area-inset-bottom))]' : 'px-7 py-4')}>
                <button
                  type="button"
                  onClick={() => { void buy(); }}
                  disabled={!offer || !available || locked}
                  className="w-full h-12 rounded-full bg-primary text-on-primary flex items-center justify-center gap-2 active:opacity-85 disabled:opacity-40 transition-opacity"
                  style={{ fontSize: '14.5px', fontWeight: 700 }}
                >
                  {locked ? <Loader2 size={16} className="animate-spin" /> : phase === 'error' ? 'Try again' : offer ? ctaFor(offer) : 'Continue'}
                </button>
                {offer && <p className="mt-2 text-center text-on-surface/45" style={{ fontSize: '11.5px' }}>{finePrintFor(offer)}</p>}
                <p className="mt-2.5 flex items-center justify-center gap-3 text-on-surface/45" style={{ fontSize: '11.5px', fontWeight: 600 }}>
                  {native ? (
                    <button type="button" onClick={() => { void restore(); }} disabled={locked} className="underline-offset-2 hover:underline">Restore purchases</button>
                  ) : (
                    <span>Manage any time after checkout</span>
                  )}
                  <span aria-hidden>·</span>
                  <button type="button" onClick={() => { void openExternalUrl(TERMS_URL); }} className="underline-offset-2 hover:underline">Terms</button>
                  <span aria-hidden>·</span>
                  <button type="button" onClick={() => { void openExternalUrl(PRIVACY_URL); }} className="underline-offset-2 hover:underline">Privacy</button>
                </p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
