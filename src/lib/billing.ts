/**
 * Billing — the two purchase rails behind one entitlement.
 *
 *   iOS   RevenueCat's Capacitor SDK over StoreKit. The app user id IS the
 *         Supabase user id, so a purchase made here and one made on the web
 *         land on the same customer. After a purchase or restore we call
 *         billing-sync so the plan is written now, not when the webhook
 *         lands.
 *   web   Stripe Checkout, minted by billing-checkout and opened in a new
 *         tab; the purchase reaches us through RevenueCat's Stripe
 *         integration and billing-webhook. Managing lives in Stripe's
 *         portal (billing-portal).
 *
 * Everything here tolerates a build without billing: no RevenueCat key,
 * no native runtime, or a database that hasn't run 087 — the callers get a
 * clear "not available" instead of a crash, and the gates stay off anyway.
 */
import { Purchases, LOG_LEVEL, type PurchasesPackage, type CustomerInfo, type PurchasesStoreProduct } from '@revenuecat/purchases-capacitor';
import { isNativeRuntime } from './native-oauth';
import { openExternalUrl } from './external-links';
import { apiUrl, apiHeaders } from './api-base';
import { DEFAULT_OFFERS, type PlanKey, type PlanOffer } from './entitlements';

export const REVENUECAT_IOS_KEY: string = import.meta.env.VITE_REVENUECAT_IOS_KEY || '';
export const ENTITLEMENT_ID = 'pro';
export const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

/** Purchases can happen in this build at all. */
export const billingAvailable = (): boolean => isNativeRuntime() ? !!REVENUECAT_IOS_KEY : true;

/* ── SDK lifecycle ────────────────────────────────────────────────── */
let configured = false;
let configuredFor: string | null = null;

/** Configure once, then keep the SDK's user in step with ours. Safe to call
 *  on every auth change; a no-op on the web or without a key. */
export async function configureBilling(userId: string | null): Promise<void> {
  if (!isNativeRuntime() || !REVENUECAT_IOS_KEY) return;
  try {
    if (!configured) {
      await Purchases.setLogLevel({ level: import.meta.env.DEV ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN });
      await Purchases.configure({ apiKey: REVENUECAT_IOS_KEY, appUserID: userId ?? undefined });
      configured = true;
      configuredFor = userId;
      return;
    }
    if (userId && configuredFor !== userId) {
      await Purchases.logIn({ appUserID: userId });
      configuredFor = userId;
    } else if (!userId && configuredFor) {
      await Purchases.logOut();
      configuredFor = null;
    }
  } catch (err) {
    console.warn('[billing] configure failed:', err);
  }
}

/** Fires whenever RevenueCat learns something new about the customer
 *  (a renewal, a purchase on another device). Returns an unsubscribe. */
export function onCustomerInfo(cb: (info: CustomerInfo) => void): () => void {
  if (!isNativeRuntime() || !REVENUECAT_IOS_KEY) return () => {};
  let id: string | null = null;
  void Purchases.addCustomerInfoUpdateListener((info) => cb(info)).then((handle) => { id = handle; }).catch(() => {});
  return () => { if (id) void Purchases.removeCustomerInfoUpdateListener({ listenerToRemove: id }).catch(() => {}); };
}

export interface EntitlementState {
  active: boolean;
  expirationDate: string | null;
  willRenew: boolean;
  store: string | null;
  productIdentifier: string | null;
}

export function entitlementOf(info: CustomerInfo | null | undefined): EntitlementState {
  const e = info?.entitlements?.active?.[ENTITLEMENT_ID];
  if (!e) return { active: false, expirationDate: null, willRenew: false, store: null, productIdentifier: null };
  return { active: !!e.isActive, expirationDate: e.expirationDate ?? null, willRenew: !!e.willRenew, store: String(e.store ?? ''), productIdentifier: e.productIdentifier ?? null };
}

/* ── Offers ───────────────────────────────────────────────────────── */
export interface NativeOffer extends PlanOffer { pkg: PurchasesPackage }

function money(amount: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount); }
  catch { return `${amount.toFixed(2)} ${currency}`; }
}

function trialDaysOf(p: PurchasesStoreProduct): number {
  const intro = p.introPrice;
  if (!intro || intro.price !== 0) return 0;
  const n = intro.periodNumberOfUnits || 0;
  const unit = String(intro.periodUnit || '').toUpperCase();
  const per = unit === 'DAY' ? 1 : unit === 'WEEK' ? 7 : unit === 'MONTH' ? 30 : unit === 'YEAR' ? 365 : 0;
  return n * per;
}

/** The store's own prices for the plans the RevenueCat offering carries. */
export async function getNativeOffers(): Promise<NativeOffer[]> {
  if (!isNativeRuntime() || !REVENUECAT_IOS_KEY || !configured) return [];
  try {
    const offerings = await Purchases.getOfferings();
    const cur = offerings.current;
    if (!cur) return [];
    const out: NativeOffer[] = [];
    const add = (key: PlanKey, pkg: PurchasesPackage | null, title: string, tag: string | null) => {
      if (!pkg) return;
      const p = pkg.product;
      const period = key === 'annual' ? 'year' : key === 'monthly' ? 'month' : null;
      out.push({
        key, title, pkg, tag,
        priceLine: period ? `${p.priceString} / ${period}` : `${p.priceString} once`,
        perMonthLine: key === 'annual' && p.price > 0 ? `${money(p.price / 12, p.currencyCode)} a month` : null,
        trialDays: trialDaysOf(p),
      });
    };
    add('annual', cur.annual, 'Annual', 'Best value');
    add('monthly', cur.monthly, 'Monthly', null);
    add('lifetime', cur.lifetime, 'Lifetime', null);
    return out;
  } catch (err) {
    console.warn('[billing] offerings failed:', err);
    return [];
  }
}

export const webOffers = (): PlanOffer[] => DEFAULT_OFFERS;

/* ── Purchase / restore ───────────────────────────────────────────── */
/** One flat shape for both rails, so callers never have to narrow. */
export interface PurchaseOutcome {
  ok: boolean;
  /** The person backed out of the store sheet: say nothing. */
  cancelled: boolean;
  /** Human message when !ok and not cancelled. */
  message: string;
  entitlement: EntitlementState;
}

const NO_ENTITLEMENT: EntitlementState = { active: false, expirationDate: null, willRenew: false, store: null, productIdentifier: null };

function failed(err: unknown): PurchaseOutcome {
  const e = err as { userCancelled?: boolean | null; code?: unknown; message?: string } | null;
  const cancelled = !!e?.userCancelled || String(e?.code ?? '') === '1' || /cancel/i.test(e?.message ?? '');
  return { ok: false, cancelled, message: cancelled ? '' : (e?.message || 'The purchase didn’t go through. Nothing was charged.'), entitlement: NO_ENTITLEMENT };
}

export async function purchaseNative(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  try {
    const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
    return { ok: true, cancelled: false, message: '', entitlement: entitlementOf(customerInfo) };
  } catch (err) {
    return failed(err);
  }
}

export async function restoreNative(): Promise<PurchaseOutcome> {
  try {
    const { customerInfo } = await Purchases.restorePurchases();
    return { ok: true, cancelled: false, message: '', entitlement: entitlementOf(customerInfo) };
  } catch (err) {
    return failed(err);
  }
}

/** Ask the server to pull the subscriber from RevenueCat and write the plan
 *  now. Returns what it wrote, or null when billing isn't configured yet. */
export async function syncPlanWithServer(): Promise<{ plan: 'free' | 'pro'; proUntil: string | null } | null> {
  try {
    const res = await fetch(apiUrl('billing-sync'), { method: 'POST', headers: await apiHeaders() });
    if (!res.ok) return null;
    const data = (await res.json()) as { plan?: string; proUntil?: string | null };
    return { plan: data.plan === 'pro' ? 'pro' : 'free', proUntil: data.proUntil ?? null };
  } catch {
    return null;
  }
}

/* ── Web ──────────────────────────────────────────────────────────── */
export async function startWebCheckout(plan: PlanKey): Promise<{ ok: boolean; message: string }> {
  try {
    const origin = window.location.origin;
    const res = await fetch(apiUrl('billing-checkout'), {
      method: 'POST',
      headers: await apiHeaders(),
      body: JSON.stringify({ plan, successUrl: `${origin}/pro/welcome`, cancelUrl: `${origin}/pro` }),
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !data.url) return { ok: false, message: data.error || 'Checkout isn’t available right now.' };
    await openExternalUrl(data.url);
    return { ok: true, message: '' };
  } catch {
    return { ok: false, message: 'Checkout isn’t available right now.' };
  }
}

export async function openWebPortal(): Promise<{ ok: boolean; message: string; code?: string }> {
  try {
    const res = await fetch(apiUrl('billing-portal'), { method: 'POST', headers: await apiHeaders() });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; code?: string };
    if (!res.ok || !data.url) return { ok: false, message: data.error || 'Billing isn’t available right now.', code: data.code };
    await openExternalUrl(data.url);
    return { ok: true, message: '' };
  } catch {
    return { ok: false, message: 'Billing isn’t available right now.' };
  }
}

/** Where "Manage subscription" goes: the App Store on iOS, Stripe's portal
 *  on the web. */
export async function openManage(source: string | null): Promise<void> {
  if (isNativeRuntime() || (source && source.startsWith('app_store'))) {
    await openExternalUrl(APPLE_SUBSCRIPTIONS_URL);
    return;
  }
  const res = await openWebPortal();
  if (!res.ok && res.code === 'no_customer') await openExternalUrl(APPLE_SUBSCRIPTIONS_URL);
}
