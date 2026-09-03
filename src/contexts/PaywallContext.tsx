/**
 * Paywall context — the one way any surface asks for Pro.
 *
 *   requirePro('recipe-image', { onUnlocked })   → true if allowed; else
 *                                                  opens the sheet and
 *                                                  returns false
 *   openPaywall('settings')                       → the sheet, no feature
 *
 * Sits just inside SignInModalProvider (like ListsProvider asks for
 * sign-in) so domain contexts can call it. The sheet itself lives in
 * components/pro/ProSheet. Continuation: the action that opened the sheet
 * is remembered and run once the purchase lands, so nobody re-taps.
 *
 * While the billing gates are off `isPro` is true for everyone and
 * requirePro always returns true — the sheet only opens from explicit
 * places (Settings, the Pro page).
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { usePlan } from './PlanContext';
import { useAuth } from './AuthContext';
import { logBillingEvent } from '../lib/billing-events';
import type { FeatureKey } from '../lib/entitlements';
import { ProSheet } from '../components/pro/ProSheet';

export interface PaywallOpenOptions {
  /** One line of context: "You've used 3 of 3 recipe generations this week." */
  reason?: string;
  /** Runs after a successful purchase (continuation). */
  onUnlocked?: () => void;
}

interface PaywallValue {
  isOpen: boolean;
  requirePro: (feature: FeatureKey, opts?: PaywallOpenOptions) => boolean;
  openPaywall: (source: string, feature?: FeatureKey | null, opts?: PaywallOpenOptions) => void;
  closePaywall: () => void;
  /** Route a server refusal to the sheet: a Pro-only feature (402) opens
   *  it plainly, a used-up allowance (429) opens it with the reset line as
   *  context. Returns true when the sheet opened, so the caller can skip
   *  its own error text. Anything else is the caller's to show. */
  handleAiError: (feature: FeatureKey, err: { code?: string; error?: string; message?: string; resetsAt?: string | null }) => boolean;
}

const Ctx = createContext<PaywallValue | null>(null);

export const PaywallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const plan = usePlan();
  const { user } = useAuth();
  const [sheet, setSheet] = useState<{ open: boolean; source: string; feature: FeatureKey | null; reason: string | null }>({ open: false, source: '', feature: null, reason: null });
  const pendingRef = useRef<(() => void) | null>(null);

  const openPaywall = useCallback<PaywallValue['openPaywall']>((source, feature = null, opts) => {
    pendingRef.current = opts?.onUnlocked ?? null;
    setSheet({ open: true, source, feature, reason: opts?.reason ?? null });
    logBillingEvent('paywall_shown', user?.id ?? null, { source, feature: feature ?? null, plan: plan.subscribed ? 'pro' : 'free' });
  }, [user?.id, plan.subscribed]);

  const closePaywall = useCallback(() => {
    setSheet((s) => {
      if (s.open) logBillingEvent('paywall_dismissed', user?.id ?? null, { source: s.source, feature: s.feature });
      return { ...s, open: false };
    });
    pendingRef.current = null;
  }, [user?.id]);

  const requirePro = useCallback<PaywallValue['requirePro']>((feature, opts) => {
    if (!plan.checked) return false; // never gate on an unknown answer
    if (plan.isPro) return true;
    openPaywall(`gate:${feature}`, feature, opts);
    return false;
  }, [plan.checked, plan.isPro, openPaywall]);

  const onUnlocked = useCallback(() => {
    const run = pendingRef.current;
    pendingRef.current = null;
    setSheet((s) => ({ ...s, open: false }));
    if (run) setTimeout(run, 50);
  }, []);

  const handleAiError = useCallback<PaywallValue['handleAiError']>((feature, err) => {
    if (err.code === 'pro_required') { openPaywall(`gate:${feature}`, feature); return true; }
    if (err.code === 'quota') { openPaywall(`cap:${feature}`, feature, { reason: err.error ?? err.message ?? undefined }); return true; }
    return false;
  }, [openPaywall]);

  const value = useMemo<PaywallValue>(() => ({ isOpen: sheet.open, requirePro, openPaywall, closePaywall, handleAiError }), [sheet.open, requirePro, openPaywall, closePaywall, handleAiError]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <ProSheet open={sheet.open} source={sheet.source} feature={sheet.feature} reason={sheet.reason} onClose={closePaywall} onUnlocked={onUnlocked} />
    </Ctx.Provider>
  );
};

export function usePaywall(): PaywallValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePaywall must be used within PaywallProvider');
  return v;
}
