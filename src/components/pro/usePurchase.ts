import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePlan } from '../../contexts/PlanContext';
import { useToast } from '../../contexts/ToastContext';
import { isNativeRuntime } from '../../lib/native-oauth';
import { billingAvailable, billingReadyFor, configureBilling, getNativeOffers, purchaseNative, restoreNative, syncPlanWithServer, startWebCheckout, webOffers, type NativeOffer } from '../../lib/billing';
import { logBillingEvent } from '../../lib/billing-events';
import { DEFAULT_PLAN, type FeatureKey, type PlanKey, type PlanOffer } from '../../lib/entitlements';

export type PurchasePhase = 'pick' | 'busy' | 'success' | 'web-sent' | 'pending' | 'error';

export function usePurchase(source: string, opts?: { enabled?: boolean; feature?: FeatureKey | null; onSuccess?: () => void; requireSignIn?: () => void }) {
  const { user, isSignedIn } = useAuth();
  const plan = usePlan();
  const { showToast } = useToast();
  const native = isNativeRuntime();
  const [nativeOffers, setNativeOffers] = useState<NativeOffer[] | null>(null);
  const [selected, setSelected] = useState<PlanKey>(DEFAULT_PLAN);
  const [phase, setPhase] = useState<PurchasePhase>('pick');
  const [error, setError] = useState('');
  const locked = useRef(false);
  const offerRequest = useRef(0);
  const alive = useRef(true);
  const latest = useRef({ opts, plan, showToast });
  latest.current = { opts, plan, showToast };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const reloadOffers = useCallback(async () => {
    if (!native) return;
    const request = ++offerRequest.current;
    setNativeOffers(null);
    await configureBilling(user?.id ?? null);
    const offers = await getNativeOffers();
    if (alive.current && request === offerRequest.current) setNativeOffers(offers);
  }, [native, user?.id]);
  useEffect(() => { if (opts?.enabled !== false) void reloadOffers(); return () => { offerRequest.current++; }; }, [reloadOffers, opts?.enabled]);
  const offers: PlanOffer[] = useMemo(() => native ? (nativeOffers ?? []) : webOffers(), [native, nativeOffers]);
  const offer = offers.find(o => o.key === selected) ?? offers[0];
  const loadingOffers = native && nativeOffers === null;
  const available = billingAvailable() && offers.length > 0;
  const busy = phase === 'busy';

  const success = useCallback(() => { if (alive.current) { setError(''); setPhase('success'); } }, []);
  // Completion is confirmed by the server, including checkout in another tab.
  useEffect(() => {
    if (plan.subscribed && phase !== 'success' && phase !== 'busy') success();
  }, [plan.subscribed, phase, success]);
  useEffect(() => {
    if (phase !== 'success') return;
    const timer = window.setTimeout(() => { latest.current.opts?.onSuccess?.(); }, 900);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const checkStatus = useCallback(async (manual = true) => {
    if (locked.current) return;
    locked.current = true;
    try {
      const synced = await syncPlanWithServer();
      await latest.current.plan.refresh();
      if (synced?.plan === 'pro' || latest.current.plan.subscribed) success();
      else if (alive.current && manual) setError('Your upgrade hasn’t been confirmed yet. You can continue and check again later.');
    } finally { locked.current = false; }
  }, [success]);
  useEffect(() => {
    if (opts?.enabled === false || (phase !== 'pending' && phase !== 'web-sent')) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      if (++attempts >= 24) window.clearInterval(timer);
      if (document.visibilityState === 'visible') void checkStatus(false);
    }, 5000);
    const visible = () => { if (document.visibilityState === 'visible') void checkStatus(false); };
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [phase, checkStatus, opts?.enabled]);

  const pick = useCallback((key: PlanKey) => {
    if (locked.current) return;
    setSelected(key); setError('');
    logBillingEvent('plan_selected', user?.id ?? null, { source, feature: opts?.feature ?? null, plan: key });
  }, [source, opts?.feature, user?.id]);

  const run = useCallback(async (restoring: boolean) => {
    if (locked.current || (!restoring && (!offer || !available)) || (restoring && !native)) return;
    if (!isSignedIn) { if (latest.current.opts?.requireSignIn) latest.current.opts.requireSignIn(); else showToast('Sign in to subscribe'); return; }
    locked.current = true;
    setError(''); setPhase('busy');
    if (!restoring) logBillingEvent('purchase_started', user?.id ?? null, { source, feature: latest.current.opts?.feature, plan: offer?.key });
    try {
      if (!native) {
        const res = await startWebCheckout(offer!.key);
        if (alive.current) { setPhase(res.ok ? 'web-sent' : 'error'); if (!res.ok) setError(res.message); }
        return;
      }
      await configureBilling(user!.id);
      if (!billingReadyFor(user!.id)) {
        setPhase('error'); setError('Couldn’t connect your account to the store. Please try again.'); return;
      }
      const res = restoring ? await restoreNative() : await purchaseNative((offer as NativeOffer).pkg);
      if (!alive.current) return;
      if (!res.ok) {
        setPhase(res.cancelled ? 'pick' : 'error'); setError(res.message);
        return;
      }
      if (restoring && !res.entitlement.active) {
        setPhase('pick'); showToast('No purchases to restore', { subtitle: 'No active Pro purchase was found on this Apple ID.' }); return;
      }
      // A successful StoreKit call can still be pending approval. Never
      // show unlocked or invite another charge before server confirmation.
      const synced = await syncPlanWithServer();
      await latest.current.plan.refresh();
      if (!alive.current) return;
      if (synced?.plan === 'pro' || latest.current.plan.subscribed) {
        logBillingEvent(restoring ? 'restored' : 'purchased', user?.id ?? null, { source, plan: offer?.key });
        success();
      } else setPhase('pending');
    } catch {
      if (alive.current) { setPhase('error'); setError('We couldn’t complete that request. Please try again.'); }
    } finally { locked.current = false; }
  }, [offer, available, native, isSignedIn, showToast, user?.id, source, success]);
  const buy = useCallback(() => run(false), [run]);
  const restore = useCallback(() => run(true), [run]);
  const reset = useCallback(() => { if (!locked.current && phase !== 'pending') { setPhase('pick'); setError(''); } }, [phase]);
  return { native, offers, offer, loadingOffers, available, selected, pick, phase, busy, error, buy, restore, reset, reloadOffers, checkStatus };
}
