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
import { Purchases, LOG_LEVEL, INTRO_ELIGIBILITY_STATUS, type PurchasesPackage, type CustomerInfo, type PurchasesStoreProduct } from '@revenuecat/purchases-capacitor';
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
let configuration: Promise<void> = Promise.resolve();

/** Configure once, then keep the SDK's user in step with ours. Safe to call
 *  on every auth change; a no-op on the web or without a key. */
export function configureBilling(userId: string | null): Promise<void> {
  configuration = configuration.then(() => configureForUser(userId));
  return configuration;
}

async function configureForUser(userId: string | null): Promise<void> {
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
  let disposed = false;
  void Purchases.addCustomerInfoUpdateListener((info) => { if (!disposed) cb(info); }).then((handle) => {
    if (disposed) void Purchases.removeCustomerInfoUpdateListener({ listenerToRemove: handle }).catch(() => {});
    else id = handle;
  }).catch(() => {});
  return () => { disposed = true; if (id) void Purchases.removeCustomerInfoUpdateListener({ listenerToRemove: id }).catch(() => {}); };
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

export const billingReadyFor = (userId: string): boolean => configured && configuredFor === userId;

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
  await configuration;
  if (!isNativeRuntime() || !REVENUECAT_IOS_KEY || !configured) return [];
  try {
    const offerings = await Purchases.getOfferings();
    const cur = offerings.current;
    if (!cur) return [];
    const products = [cur.annual, cur.monthly, cur.lifetime].filter(Boolean).map(pkg => pkg!.product.identifier);
    const eligibility = await Purchases.checkTrialOrIntroductoryPriceEligibility({ productIdentifiers: products }).catch(() => ({}));
    const out: NativeOffer[] = [];
    const add = (key: PlanKey, pkg: PurchasesPackage | null, title: string, tag: string | null) => {
      if (!pkg) return;
      const p = pkg.product;
      const period = key === 'annual' ? 'year' : key === 'monthly' ? 'month' : null;
      out.push({
        key, title, pkg, tag,
        priceLine: period ? `${p.priceString} / ${period}` : `${p.priceString} once`,
        perMonthLine: key === 'annual' && p.price > 0 ? `${money(p.price / 12, p.currencyCode)} a month` : null,
        trialDays: eligibility[p.identifier]?.status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE ? trialDaysOf(p) : 0,
      });
    };
    add('annual', cur.annual, 'Annual', cur.annual && cur.monthly && cur.annual.product.price < cur.monthly.product.price * 12 ? 'Best value' : null);
    add('monthly', cur.monthly, 'Monthly', null);
    add('lifetime', cur.lifetime, 'Lifetime', null);
    return out;
  } catch (err) {
    console.warn('[billing] offerings failed:', err);
    return [];
  }
}

// Web checkout confirms trial eligibility; never promise one from static defaults.
export const webOffers = (): PlanOffer[] => DEFAULT_OFFERS.map(offer => ({ ...offer, trialDays: 0 }));

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
  return { ok: false, cancelled, message: cancelled ? '' : (e?.message || 'We couldn’t complete the purchase. Please try again.'), entitlement: NO_ENTITLEMENT };
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
  // Reserve the tab during the click, before awaiting the checkout URL.
  const checkout = window.open('about:blank', '_blank');
  if (!checkout) return { ok: false, message: 'Allow pop-ups to open secure checkout, then try again.' };
  checkout.opener = null;
  try {
    const origin = window.location.origin;
    const res = await fetch(apiUrl('billing-checkout'), {
      method: 'POST',
      headers: await apiHeaders(),
      body: JSON.stringify({ plan, successUrl: `${origin}/pro/welcome`, cancelUrl: `${origin}/pro` }),
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !data.url) { checkout.close(); return { ok: false, message: data.error || 'Checkout isn’t available right now.' }; }
    const url = new URL(data.url);
    if (url.protocol !== 'https:') throw new Error('Invalid checkout URL');
    checkout.location.replace(url.href);
    return { ok: true, message: '' };
  } catch {
    checkout.close();
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
