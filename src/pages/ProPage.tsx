/**
 * /pro — GoodEats Pro at page scale, for people who read before they buy,
 * and the web's landing and return route. On a Pro account the same route
 * shows the plan's status and where to manage it.
 *
 * /pro/welcome — where Stripe Checkout sends people back. It asks the
 * server to sync the plan and watches the row for up to ten seconds so the
 * page can say "Welcome to Pro" without a reload.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, Check, Loader2, ExternalLink } from 'lucide-react';
import { cn } from '../lib/utils';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { usePlan } from '../contexts/PlanContext';
import { useSignInModal } from '../contexts/SignInModalContext';
import { usePaywall } from '../contexts/PaywallContext';
import { isNativeRuntime } from '../lib/native-oauth';
import { openExternalUrl, TERMS_URL, PRIVACY_URL } from '../lib/external-links';
import { billingAvailable, getNativeOffers, purchaseNative, restoreNative, syncPlanWithServer, startWebCheckout, webOffers, openManage, type NativeOffer } from '../lib/billing';
import { logBillingEvent } from '../lib/billing-events';
import { BENEFITS, FEATURES, ctaFor, finePrintFor, DEFAULT_PLAN, type PlanOffer, type PlanKey } from '../lib/entitlements';
import { PlanPicker } from '../components/pro/ProSheet';
import { ProTag } from '../components/pro/ProMark';

const FAQ: Array<{ q: string; a: string }> = [
  { q: 'Can I cancel?', a: 'Any time. On iPhone, from Settings → Manage subscription, which opens the App Store. On the web, from the same place, which opens your billing portal. Pro stays on until the paid period ends.' },
  { q: 'I bought Pro on the web. Does the app know?', a: 'Yes. Pro is tied to your GoodEats account, not the device, so it’s on wherever you sign in.' },
  { q: 'What happens to my things if I stop?', a: 'Nothing is deleted or hidden. Allowances apply again going forward; anything you made stays.' },
  { q: 'Does the free trial charge me?', a: 'Not during the trial. You’re charged when it ends unless you cancel before, and the App Store reminds you.' },
];

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

export const ProPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { phoneMode } = useSettings();
  const { user, isSignedIn } = useAuth();
  const { requireSignIn } = useSignInModal();
  const { openPaywall } = usePaywall();
  const { showToast } = useToast();
  const plan = usePlan();
  const native = isNativeRuntime();
  const welcome = location.pathname.endsWith('/welcome');
  const [nativeOffers, setNativeOffers] = useState<NativeOffer[] | null>(null);
  const [selected, setSelected] = useState<PlanKey>(DEFAULT_PLAN);
  const [busy, setBusy] = useState(false);
  const [welcomeState, setWelcomeState] = useState<'waiting' | 'done' | 'timeout'>('waiting');

  useEffect(() => {
    if (native) void getNativeOffers().then(setNativeOffers);
    logBillingEvent('paywall_shown', user?.id ?? null, { source: welcome ? 'welcome' : 'pro-page' });
    // /pro?sheet=1 opens the paywall sheet itself — the way to see it
    // before the gates are on, when no feature would open it.
    if (new URLSearchParams(location.search).get('sheet') === '1') openPaywall('pro-page');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native]);

  // Back from Stripe: sync, then watch for the row to flip.
  useEffect(() => {
    if (!welcome) return;
    let alive = true;
    const started = Date.now();
    (async () => {
      await syncPlanWithServer();
      while (alive && Date.now() - started < 10000) {
        await plan.refresh();
        if (plan.subscribed) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [welcome]);
  useEffect(() => {
    if (!welcome) return;
    if (plan.subscribed) setWelcomeState('done');
    else { const t = setTimeout(() => setWelcomeState((s) => (s === 'waiting' ? 'timeout' : s)), 11000); return () => clearTimeout(t); }
  }, [welcome, plan.subscribed]);

  const offers: PlanOffer[] = useMemo(() => (native ? (nativeOffers ?? []) : webOffers()), [native, nativeOffers]);
  const offer = offers.find((o) => o.key === selected) ?? offers[0];
  const available = billingAvailable() && offers.length > 0;

  const buy = async () => {
    if (!offer || busy) return;
    if (!isSignedIn) { requireSignIn('Sign in to subscribe'); return; }
    setBusy(true);
    logBillingEvent('purchase_started', user?.id ?? null, { source: 'pro-page', plan: offer.key });
    if (native) {
      const res = await purchaseNative((offer as NativeOffer).pkg);
      setBusy(false);
      if (!res.ok) { if (!res.cancelled) showToast('The purchase didn’t go through', { subtitle: 'Nothing was charged.' }); return; }
      await syncPlanWithServer(); await plan.refresh();
      logBillingEvent('purchased', user?.id ?? null, { source: 'pro-page', plan: offer.key });
      showToast('Welcome to Pro');
      return;
    }
    const res = await startWebCheckout(offer.key);
    setBusy(false);
    if (!res.ok) showToast("Couldn't start checkout", { subtitle: res.message });
  };

  const restore = async () => {
    if (busy) return;
    setBusy(true);
    const res = await restoreNative();
    if (res.ok) { await syncPlanWithServer(); await plan.refresh(); }
    setBusy(false);
    if (!res.ok) { if (!res.cancelled) showToast("Couldn't restore", { subtitle: res.message }); return; }
    showToast(res.entitlement.active ? 'Welcome back to Pro' : 'No purchases to restore');
  };

  const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="min-h-screen bg-surface text-on-surface">
      <div className={cn('mx-auto w-full', phoneMode ? 'px-5 pt-safe-4 pb-[calc(env(safe-area-inset-bottom)+96px)]' : 'max-w-[680px] px-6 py-10')}>
        <div className="flex items-center gap-2 mb-6">
          <button type="button" onClick={() => navigate(-1)} aria-label="Back" className="hit-44 w-10 h-10 rounded-full flex items-center justify-center text-on-surface active:scale-95 transition-transform border border-on-surface/[0.12]"><ChevronLeft size={18} /></button>
          <span className="text-on-surface/45" style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase' }}>GoodEats Pro</span>
        </div>
        {children}
      </div>
    </div>
  );

  if (welcome) {
    return (
      <Shell>
        <div className="py-16 flex flex-col items-center text-center">
          {welcomeState === 'done' ? (
            <>
              <span className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--color-accent) 22%, transparent)', color: 'var(--color-accent-ink, #7a6534)' }}><Check size={28} /></span>
              <h1 className="mt-5 font-serif font-bold" style={{ fontSize: '30px', letterSpacing: '-0.015em' }}>Welcome to Pro</h1>
              <p className="mt-2 text-on-surface/55" style={{ fontSize: '14px' }}>Your taste, deeper. Everything’s unlocked.</p>
              <button type="button" onClick={() => navigate('/')} className="mt-8 rounded-full bg-primary text-on-primary px-6 h-12" style={{ fontSize: '14px', fontWeight: 700 }}>Start exploring</button>
            </>
          ) : welcomeState === 'waiting' ? (
            <>
              <Loader2 size={22} className="animate-spin text-on-surface/40" />
              <p className="mt-4 text-on-surface/60" style={{ fontSize: '14px' }}>Finishing up…</p>
            </>
          ) : (
            <>
              <h1 className="font-serif font-bold" style={{ fontSize: '24px' }}>Almost there</h1>
              <p className="mt-2 text-on-surface/55 max-w-[34ch]" style={{ fontSize: '14px', lineHeight: 1.5 }}>Your purchase is going through. Pro turns on by itself within a minute or two; you don’t need to do anything.</p>
              <button type="button" onClick={() => { void plan.refresh(); }} className="mt-6 rounded-full border border-on-surface/15 px-5 h-11" style={{ fontSize: '13.5px', fontWeight: 700 }}>Check again</button>
            </>
          )}
        </div>
      </Shell>
    );
  }

  if (plan.checked && plan.subscribed) {
    return (
      <Shell>
        <h1 className="font-serif font-bold" style={{ fontSize: '34px', lineHeight: 1.05, letterSpacing: '-0.015em' }}>You’re on Pro.</h1>
        <p className="mt-3 text-on-surface/60" style={{ fontSize: '14.5px', lineHeight: 1.5 }}>
          {plan.source === 'grant'
            ? (plan.grantUntil ? `On the house until ${fmtDate(plan.grantUntil)}.` : 'On the house.')
            : plan.proUntil
              ? `${plan.willRenew === false ? 'Ends' : 'Renews'} ${fmtDate(plan.proUntil)}${plan.source ? ` · ${plan.source.startsWith('app_store') ? 'App Store' : plan.source.startsWith('stripe') ? 'Web' : plan.source}` : ''}.`
              : 'Yours for good.'}
        </p>
        {plan.source !== 'grant' && (
          <button type="button" onClick={() => { void openManage(plan.source); }} className="mt-6 inline-flex items-center gap-2 rounded-full border border-on-surface/15 px-5 h-11" style={{ fontSize: '13.5px', fontWeight: 700 }}>
            Manage subscription <ExternalLink size={14} />
          </button>
        )}
        <section className="mt-10">
          <p className="text-on-surface/45 mb-3" style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase' }}>What’s included</p>
          <ul className="space-y-3">
            {BENEFITS.map((b) => (
              <li key={b.key}><p style={{ fontSize: '15px', fontWeight: 700 }}>{b.title}</p><p className="text-on-surface/50" style={{ fontSize: '13px' }}>{b.sub}</p></li>
            ))}
          </ul>
        </section>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="font-serif font-bold" style={{ fontSize: phoneMode ? '38px' : '46px', lineHeight: 1.0, letterSpacing: '-0.02em' }}>Your taste, deeper.</h1>
      <p className="mt-4 text-on-surface/60 max-w-[44ch]" style={{ fontSize: '15px', lineHeight: 1.55 }}>
        GoodEats is a complete app for free. Pro is the AI layer and the insight layer: the things that cost real money per use, and the things that read your taste back to you.
      </p>

      <section className="mt-9 space-y-6">
        {BENEFITS.map((b) => (
          <div key={b.key}>
            <p style={{ fontSize: '17px', fontWeight: 700, letterSpacing: '-0.01em' }}>{b.title}</p>
            <p className="mt-1 text-on-surface/55" style={{ fontSize: '13.5px', lineHeight: 1.5 }}>{b.sub}</p>
            <p className="mt-1.5 text-on-surface/40" style={{ fontSize: '12.5px' }}>
              {Object.values(FEATURES).filter((f) => f.benefit === b.key).map((f) => f.label).join(' · ')}
            </p>
          </div>
        ))}
      </section>

      <section className="mt-10">
        <p className="text-on-surface/45 mb-3" style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase' }}>Plans</p>
        {native && nativeOffers === null ? (
          <div className="flex items-center gap-2 text-on-surface/45 py-3" style={{ fontSize: '13px' }}><Loader2 size={14} className="animate-spin" /> Loading plans…</div>
        ) : offers.length === 0 ? (
          <p className="rounded-2xl bg-on-surface/[0.05] px-4 py-3 text-on-surface/60" style={{ fontSize: '13px', lineHeight: 1.45 }}>Purchases aren’t set up in this build yet. Everything stays free until they are.</p>
        ) : (
          <>
            <PlanPicker offers={offers} value={offer?.key ?? DEFAULT_PLAN} onChange={setSelected} disabled={busy} />
            <button type="button" onClick={() => { void buy(); }} disabled={!available || busy} className="mt-4 w-full h-12 rounded-full bg-primary text-on-primary flex items-center justify-center gap-2 disabled:opacity-40" style={{ fontSize: '14.5px', fontWeight: 700 }}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : offer ? ctaFor(offer) : 'Continue'}
            </button>
            {offer && <p className="mt-2 text-center text-on-surface/45" style={{ fontSize: '11.5px' }}>{finePrintFor(offer)}</p>}
          </>
        )}
        <p className="mt-3 flex items-center justify-center gap-3 text-on-surface/45" style={{ fontSize: '11.5px', fontWeight: 600 }}>
          {native && <><button type="button" onClick={() => { void restore(); }} className="underline-offset-2 hover:underline">Restore purchases</button><span aria-hidden>·</span></>}
          <button type="button" onClick={() => { void openExternalUrl(TERMS_URL); }} className="underline-offset-2 hover:underline">Terms</button>
          <span aria-hidden>·</span>
          <button type="button" onClick={() => { void openExternalUrl(PRIVACY_URL); }} className="underline-offset-2 hover:underline">Privacy</button>
        </p>
      </section>

      <section className="mt-10">
        <p className="text-on-surface/45 mb-3" style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase' }}>Questions</p>
        <dl className="divide-y divide-on-surface/[0.08]">
          {FAQ.map((f) => (
            <div key={f.q} className="py-3">
              <dt style={{ fontSize: '14px', fontWeight: 700 }}>{f.q}</dt>
              <dd className="mt-1 text-on-surface/55" style={{ fontSize: '13px', lineHeight: 1.5 }}>{f.a}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 inline-flex items-center gap-2 text-on-surface/45" style={{ fontSize: '12px' }}><ProTag /> One plan, every device.</p>
      </section>
    </Shell>
  );
};
