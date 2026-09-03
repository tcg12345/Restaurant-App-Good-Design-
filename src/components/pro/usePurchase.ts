/**
 * One purchase flow for every Pro surface — the sheet, the page, the
 * onboarding intro. Loads the offers (the store's on iOS, the web's
 * defaults elsewhere), tracks the pick, runs the purchase or the web
 * checkout, restores, and tells the plan context to catch up.
 *
 * Phases: 'pick' → 'busy' → 'success' (native) | 'web-sent' (a Stripe tab
 * opened) | 'error'. A cancel goes quietly back to 'pick'.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePlan } from '../../contexts/PlanContext';
import { useToast } from '../../contexts/ToastContext';
import { isNativeRuntime } from '../../lib/native-oauth';
import { billingAvailable, getNativeOffers, purchaseNative, restoreNative, syncPlanWithServer, startWebCheckout, webOffers, type NativeOffer } from '../../lib/billing';
import { logBillingEvent } from '../../lib/billing-events';
import { DEFAULT_PLAN, type FeatureKey, type PlanKey, type PlanOffer } from '../../lib/entitlements';

export type PurchasePhase = 'pick' | 'busy' | 'success' | 'web-sent' | 'error';

export function usePurchase(source: string, opts?: { feature?: FeatureKey | null; onSuccess?: () => void; requireSignIn?: () => void }) {
  const { user, isSignedIn } = useAuth();
  const plan = usePlan();
  const { showToast } = useToast();
  const native = isNativeRuntime();
  const [nativeOffers, setNativeOffers] = useState<NativeOffer[] | null>(null);
  const [selected, setSelected] = useState<PlanKey>(DEFAULT_PLAN);
  const [phase, setPhase] = useState<PurchasePhase>('pick');
  const [error, setError] = useState('');

  useEffect(() => {
    if (native) { setNativeOffers(null); void getNativeOffers().then(setNativeOffers); }
  }, [native]);

  const offers: PlanOffer[] = useMemo(() => (native ? (nativeOffers ?? []) : webOffers()), [native, nativeOffers]);
  const offer = offers.find((o) => o.key === selected) ?? offers[0];
  const loadingOffers = native && nativeOffers === null;
  const available = billingAvailable() && offers.length > 0;
  const busy = phase === 'busy';

  const pick = useCallback((k: PlanKey) => {
    setSelected(k);
    logBillingEvent('plan_selected', user?.id ?? null, { source, feature: opts?.feature ?? null, plan: k });
  }, [source, opts?.feature, user?.id]);

  const buy = useCallback(async () => {
    if (!offer || busy) return;
    if (!isSignedIn) { if (opts?.requireSignIn) opts.requireSignIn(); else showToast('Sign in to subscribe'); return; }
    logBillingEvent('purchase_started', user?.id ?? null, { source, feature: opts?.feature ?? null, plan: offer.key });
    setError('');
    setPhase('busy');
    if (native) {
      const res = await purchaseNative((offer as NativeOffer).pkg);
      if (!res.ok) {
        if (res.cancelled) { setPhase('pick'); return; }
        setError(res.message); setPhase('error');
        logBillingEvent('purchase_failed', user?.id ?? null, { source, feature: opts?.feature ?? null, plan: offer.key, meta: { message: res.message } });
        return;
      }
      await syncPlanWithServer();
      await plan.refresh();
      logBillingEvent('purchased', user?.id ?? null, { source, feature: opts?.feature ?? null, plan: offer.key });
      setPhase('success');
      window.setTimeout(() => { opts?.onSuccess?.(); showToast('Welcome to Pro'); }, 900);
      return;
    }
    const res = await startWebCheckout(offer.key);
    if (!res.ok) { setError(res.message); setPhase('error'); return; }
    setPhase('web-sent');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer, busy, isSignedIn, native, source, user?.id, plan.refresh, showToast]);

  const restore = useCallback(async () => {
    if (busy || !native) return;
    setPhase('busy');
    const res = await restoreNative();
    if (!res.ok) { setPhase('pick'); if (!res.cancelled) showToast("Couldn't restore", { subtitle: res.message }); return; }
    await syncPlanWithServer();
    await plan.refresh();
    if (res.entitlement.active) {
      logBillingEvent('restored', user?.id ?? null, { source, feature: opts?.feature ?? null });
      setPhase('success');
      window.setTimeout(() => { opts?.onSuccess?.(); showToast('Welcome back to Pro'); }, 900);
    } else {
      setPhase('pick');
      showToast('No purchases to restore', { subtitle: 'Nothing on this Apple ID unlocks Pro.' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, native, source, user?.id, plan.refresh, showToast]);

  const reset = useCallback(() => { setPhase('pick'); setError(''); }, []);

  return { native, offers, offer, loadingOffers, available, selected, pick, phase, busy, error, buy, restore, reset };
}
