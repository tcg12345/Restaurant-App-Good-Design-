/**
 * Plan context — is this person on Pro, and what's left of their allowance.
 *
 * The truth is the server's get_plan_context() (migration 087): the plan
 * on the profile row, live grants, and whether the billing gates are even
 * on. While they're off, `isPro` is true for everyone — the app shows no
 * gates and behaves exactly as before. `checked` is a tri-state discipline
 * borrowed from AuthContext's adminChecked: nothing that could show a
 * paywall renders until the answer has actually arrived, so a paying
 * customer never sees a flash of "upgrade".
 *
 * On iOS the RevenueCat SDK is kept logged in as the same user, and a
 * customer-info update (a renewal, a purchase on another device) triggers
 * a server sync so the row catches up without waiting for the webhook.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { useSettings } from './SettingsContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { configureBilling, onCustomerInfo, entitlementOf, syncPlanWithServer } from '../lib/billing';

export interface QuotaEntry {
  remaining: number;
  max: number;
  window: 'hour' | 'day' | 'week' | 'month';
  resetsAt: string | null;
  proOnly: boolean;
}

export interface PlanValue {
  /** false until the server has answered once for this user. */
  checked: boolean;
  /** What the person is on: the profile row's plan (a live grant counts). */
  subscribed: boolean;
  /** What the app should enforce right now: Pro for everyone while the
   *  gates are off. Gate UI on THIS. */
  isPro: boolean;
  gatesEnabled: boolean;
  proUntil: string | null;
  willRenew: boolean | null;
  /** 'app_store' | 'stripe' | 'grant' | 'app_store:sandbox' … */
  source: string | null;
  grantUntil: string | null;
  /** New features land for Pro first (entitlements 'early-access'). One
   *  flag; a surface that ships early checks this and nothing else. */
  earlyAccess: boolean;
  /** Per-endpoint headroom for the effective plan, loaded on demand. */
  quota: Record<string, QuotaEntry> | null;
  refresh: () => Promise<void>;
  refreshQuota: () => Promise<void>;
}

const Ctx = createContext<PlanValue | null>(null);

/** Development only: `VITE_PLAN_PREVIEW=free` in .env.local shows every
 *  gate as a free user would see it, whatever the server says. Ignored in
 *  production builds. */
const PREVIEW_FREE = import.meta.env.DEV && import.meta.env.VITE_PLAN_PREVIEW === 'free';

const FREE: Omit<PlanValue, 'refresh' | 'refreshQuota' | 'checked' | 'earlyAccess'> = {
  subscribed: false, isPro: true, gatesEnabled: false, proUntil: null, willRenew: null, source: null, grantUntil: null, quota: null,
};

export const PlanProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile } = useAuth();
  const userId = user?.id ?? null;
  const [state, setState] = useState<Omit<PlanValue, 'refresh' | 'refreshQuota' | 'earlyAccess'>>({ ...FREE, checked: false });
  const userRef = useRef(userId);
  userRef.current = userId;

  const refresh = useCallback(async () => {
    const uid = userRef.current;
    if (!uid || !supabaseConfigured) {
      // A guest: nothing to gate on, and nothing to wait for.
      setState({ ...FREE, isPro: !PREVIEW_FREE, gatesEnabled: PREVIEW_FREE, checked: true });
      return;
    }
    try {
      const [{ data: ctx, error }, { data: row }] = await Promise.all([
        supabase.rpc('get_plan_context'),
        supabase.from('user_profiles').select('plan, pro_until, pro_source, pro_will_renew').eq('user_id', uid).maybeSingle(),
      ]);
      if (userRef.current !== uid) return;
      if (error) {
        // The database hasn't run 087: behave as before the plan existed.
        console.warn('[plan] get_plan_context failed:', error.message);
        setState({ ...FREE, checked: true });
        return;
      }
      const c = (ctx ?? {}) as { is_pro?: boolean; effective_plan?: string; gates_enabled?: boolean; grant_until?: string | null };
      const grantActive = !!c.grant_until;
      setState((prev) => ({
        checked: true,
        subscribed: !!c.is_pro,
        isPro: PREVIEW_FREE ? false : c.effective_plan !== 'free',
        gatesEnabled: PREVIEW_FREE || !!c.gates_enabled,
        proUntil: row?.pro_until ?? null,
        willRenew: row?.pro_will_renew ?? null,
        source: row?.plan === 'pro' ? (row?.pro_source ?? null) : grantActive ? 'grant' : null,
        grantUntil: c.grant_until === 'infinity' ? null : (c.grant_until ?? null),
        quota: prev.quota,
      }));
    } catch (err) {
      console.warn('[plan] refresh failed:', err);
      setState((prev) => ({ ...prev, checked: true }));
    }
  }, []);

  const refreshQuota = useCallback(async () => {
    if (!userRef.current || !supabaseConfigured) return;
    const { data, error } = await supabase.rpc('get_ai_quota_status');
    if (error || !data) return;
    const d = data as { endpoints?: Record<string, { remaining: number; max: number; window: QuotaEntry['window']; resets_at: string | null; pro_only: boolean }> };
    const out: Record<string, QuotaEntry> = {};
    for (const [k, v] of Object.entries(d.endpoints ?? {})) out[k] = { remaining: v.remaining, max: v.max, window: v.window, resetsAt: v.resets_at, proOnly: v.pro_only };
    setState((prev) => ({ ...prev, quota: out }));
  }, []);

  // Sign-in / sign-out: reset, then ask. Profile changes (a refreshProfile
  // after a save) re-ask cheaply too.
  useEffect(() => {
    setState({ ...FREE, checked: false });
    void refresh();
  }, [userId, refresh]);
  useEffect(() => {
    if (userId && profile) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.updated_at ?? null]);

  // The row can change under us (a web purchase, a webhook): watch it.
  useEffect(() => {
    if (!userId || !supabaseConfigured) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase.channel(`plan-${userId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_profiles', filter: `user_id=eq.${userId}` }, () => { void refresh(); })
        .subscribe();
    } catch { /* realtime unavailable — foreground refetch below covers it */ }
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  // iOS: keep the store SDK on the same user, and let a store-side change
  // pull the server row forward.
  useEffect(() => {
    void configureBilling(userId);
    if (!userId) return;
    const off = onCustomerInfo((info) => {
      const ent = entitlementOf(info);
      if (ent.active) void syncPlanWithServer().then(() => refresh());
    });
    return off;
  }, [userId, refresh]);

  // Precise scores are a Pro display setting; a lapsed plan turns the
  // stored preference back off so every score reads at one decimal again.
  const { twoDecimalScores, toggleTwoDecimalScores } = useSettings();
  useEffect(() => {
    if (state.checked && !state.isPro && twoDecimalScores) toggleTwoDecimalScores();
  }, [state.checked, state.isPro, twoDecimalScores, toggleTwoDecimalScores]);

  const value = useMemo<PlanValue>(() => ({ ...state, earlyAccess: state.checked && state.isPro, refresh, refreshQuota }), [state, refresh, refreshQuota]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export function usePlan(): PlanValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlan must be used within PlanProvider');
  return v;
}
