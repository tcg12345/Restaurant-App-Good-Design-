/**
 * /pro — GoodEats Pro at page scale, in glass night: a swipeable card
 * per story at the top, the plans beneath, one page, no sheet. On a Pro
 * account the same page shows the plan's status and where to manage it.
 *
 * /pro/welcome — where Stripe Checkout sends people back. It asks the
 * server to sync the plan and watches the row for up to ten seconds so the
 * page can say "Welcome to Pro" without a reload.
 *
 * Always dark, whatever the theme (components/pro/night.ts). The bottom
 * nav steps aside while the page is up; the status bar goes light.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronLeft, Check, Loader2, ExternalLink } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';
import { usePlan } from '../contexts/PlanContext';
import { useSignInModal } from '../contexts/SignInModalContext';
import { usePaywall } from '../contexts/PaywallContext';
import { syncPlanWithServer, openManage } from '../lib/billing';
import { logBillingEvent } from '../lib/billing-events';
import { useNightStatusBar } from '../lib/night-status-bar';
import { PRO_STORIES } from '../components/pro/ProStories';
import { usePurchase } from '../components/pro/usePurchase';
import { NightPlanCards, NightPurchaseFooter, NightLegal, NightOutcome } from '../components/pro/NightPlan';
import { NIGHT_BG, NIGHT_INK, NIGHT_INK_SOFT, NIGHT_INK_FAINT, PALE, glass, eyebrow, headline, EASE } from '../components/pro/night';

const FAQ: Array<{ q: string; a: string }> = [
  { q: 'Can I cancel?', a: 'Any time. On iPhone, from Settings → Manage subscription, which opens the App Store. On the web, from the same place, which opens your billing portal. Pro stays on until the paid period ends.' },
  { q: 'I bought Pro on the web. Does the app know?', a: 'Yes. Pro is tied to your GoodEats account, not the device, so it’s on wherever you sign in.' },
  { q: 'What happens to my things if I stop?', a: 'Nothing is deleted or hidden. Allowances apply again going forward; anything you made stays.' },
  { q: 'Does the free trial charge me?', a: 'Not during the trial. You’re charged when it ends unless you cancel before, and the App Store reminds you.' },
];

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

/** The stories, one glass card each, swiped. Dots follow the scroll. */
const StoryCarousel: React.FC = () => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = el.clientWidth;
        if (w > 0) setIndex(Math.round(el.scrollLeft / w));
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);
  const go = (i: number) => { const el = ref.current; if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' }); };
  return (
    <div>
      <div ref={ref} className="flex overflow-x-auto no-scrollbar snap-x snap-mandatory" style={{ scrollbarWidth: 'none', gap: 0, margin: '0 -22px', padding: '0 22px', scrollPaddingLeft: 22, scrollPaddingRight: 22 }}>
        {PRO_STORIES.map((s, i) => (
          <div key={s.key} className="snap-center flex-none" style={{ width: '100%', paddingRight: i === PRO_STORIES.length - 1 ? 0 : 10, boxSizing: 'border-box' }}>
            <div style={{ ...glass, borderRadius: 24, padding: 16, minHeight: 340, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div style={{ ...glass, borderRadius: 18, padding: 12, background: 'rgba(0,0,0,0.18)', boxShadow: 'none' }}>
                {index === i ? <s.Visual key={`${s.key}-${index}`} /> : <s.Visual />}
              </div>
              <div style={{ marginTop: 16 }}>
                <span style={eyebrow}>{s.eyebrow}</span>
                <h2 style={{ ...headline, fontSize: '26px', margin: '10px 0 6px' }}>{s.line1}<br /><em style={{ fontStyle: 'italic' }}>{s.line2}</em></h2>
                <p style={{ fontSize: '13px', lineHeight: 1.45, color: NIGHT_INK_SOFT, margin: 0 }}>{s.sub}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-center gap-[5px]" style={{ marginTop: 12 }} role="tablist" aria-label="Stories">
        {PRO_STORIES.map((s, i) => (
          <button key={s.key} type="button" role="tab" aria-selected={index === i} aria-label={s.eyebrow} onClick={() => go(i)} className="hit-44-y" style={{ padding: 4 }}>
            <motion.i className="block rounded-full" style={{ height: 6, background: NIGHT_INK }} animate={{ width: index === i ? 18 : 6, opacity: index === i ? 1 : 0.3 }} transition={{ duration: 0.3, ease: EASE }} />
          </button>
        ))}
      </div>
    </div>
  );
};

export const ProPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { phoneMode, setHideBottomNav } = useSettings();
  const { user } = useAuth();
  const { requireSignIn } = useSignInModal();
  const { openPaywall } = usePaywall();
  const plan = usePlan();
  const welcome = location.pathname.endsWith('/welcome');
  const p = usePurchase(welcome ? 'welcome' : 'pro-page', { requireSignIn: () => requireSignIn('Sign in to subscribe') });
  const [welcomeState, setWelcomeState] = useState<'waiting' | 'done' | 'timeout'>('waiting');
  useNightStatusBar();

  // A full page: the tab bar steps aside while it's up.
  useEffect(() => {
    if (!phoneMode) return;
    setHideBottomNav(true);
    return () => setHideBottomNav(false);
  }, [phoneMode, setHideBottomNav]);

  useEffect(() => {
    logBillingEvent('paywall_shown', user?.id ?? null, { source: welcome ? 'welcome' : 'pro-page' });
    // /pro?sheet=1 opens the in-context sheet itself — the way to see it
    // before a feature would.
    if (new URLSearchParams(location.search).get('sheet') === '1') openPaywall('pro-page');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="min-h-screen" style={{ background: NIGHT_BG, color: NIGHT_INK }}>
      <div className="mx-auto w-full" style={{ maxWidth: phoneMode ? 430 : 560, padding: phoneMode ? '0 22px' : '0 24px', paddingTop: 'max(54px, calc(env(safe-area-inset-top) + 16px))', paddingBottom: 'max(40px, calc(env(safe-area-inset-bottom) + 28px))' }}>
        <div className="flex items-center gap-3" style={{ marginBottom: 18 }}>
          <button type="button" onClick={() => navigate(-1)} aria-label="Back" className="hit-44 w-9 h-9 rounded-full grid place-items-center active:scale-95 transition-transform" style={{ background: 'rgba(255,255,255,0.1)', color: NIGHT_INK }}><ChevronLeft size={17} /></button>
          <span style={eyebrow}>GoodEats Pro</span>
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
              <span style={{ width: 64, height: 64, borderRadius: 999, background: 'rgba(174,187,211,0.16)', color: PALE, display: 'grid', placeItems: 'center' }}><Check size={28} /></span>
              <h1 style={{ ...headline, fontSize: '32px', marginTop: 20 }}>Welcome to <em style={{ fontStyle: 'italic' }}>Pro.</em></h1>
              <p style={{ marginTop: 8, fontSize: '14px', color: NIGHT_INK_SOFT }}>Everything's unlocked.</p>
              <button type="button" onClick={() => navigate('/')} className="mt-8 rounded-full px-6 h-12" style={{ background: PALE, color: '#161a22', fontSize: '14px', fontWeight: 800 }}>Start exploring</button>
            </>
          ) : welcomeState === 'waiting' ? (
            <>
              <Loader2 size={22} className="animate-spin" style={{ color: NIGHT_INK_FAINT }} />
              <p style={{ marginTop: 16, fontSize: '14px', color: NIGHT_INK_SOFT }}>Finishing up…</p>
            </>
          ) : (
            <>
              <h1 style={{ ...headline, fontSize: '26px' }}>Almost <em style={{ fontStyle: 'italic' }}>there.</em></h1>
              <p style={{ marginTop: 8, fontSize: '14px', lineHeight: 1.5, color: NIGHT_INK_SOFT, maxWidth: '34ch' }}>Your purchase is going through. Pro turns on by itself within a minute or two; you don't need to do anything.</p>
              <button type="button" onClick={() => { void plan.refresh(); }} className="mt-6 rounded-full px-5 h-11" style={{ border: '1px solid rgba(255,255,255,0.2)', fontSize: '13.5px', fontWeight: 700 }}>Check again</button>
            </>
          )}
        </div>
      </Shell>
    );
  }

  const subscribed = plan.checked && plan.subscribed;
  const outcome = p.phase === 'success' || p.phase === 'web-sent';

  return (
    <Shell>
      <StoryCarousel />

      <section style={{ marginTop: 28 }}>
        {subscribed ? (
          <div style={{ ...glass, borderRadius: 22, padding: '18px 18px' }}>
            <span style={eyebrow}>Your plan</span>
            <h1 style={{ ...headline, fontSize: '28px', margin: '10px 0 6px' }}>You're on <em style={{ fontStyle: 'italic' }}>Pro.</em></h1>
            <p style={{ fontSize: '13.5px', lineHeight: 1.5, color: NIGHT_INK_SOFT, margin: 0 }}>
              {plan.source === 'grant'
                ? (plan.grantUntil ? `On the house until ${fmtDate(plan.grantUntil)}.` : 'On the house.')
                : plan.proUntil
                  ? `${plan.willRenew === false ? 'Ends' : 'Renews'} ${fmtDate(plan.proUntil)}${plan.source ? ` · ${plan.source.startsWith('app_store') ? 'App Store' : plan.source.startsWith('stripe') ? 'Web' : plan.source}` : ''}.`
                  : 'Yours for good.'}
            </p>
            {plan.source !== 'grant' && (
              <button type="button" onClick={() => { void openManage(plan.source); }} className="mt-4 inline-flex items-center gap-2 rounded-full px-4 h-10" style={{ border: '1px solid rgba(255,255,255,0.2)', fontSize: '13px', fontWeight: 700, color: NIGHT_INK }}>
                Manage subscription <ExternalLink size={13} />
              </button>
            )}
          </div>
        ) : outcome ? (
          <NightOutcome phase={p.phase as 'success' | 'web-sent'} onDone={p.reset} />
        ) : (
          <>
            <span style={eyebrow}>Plans</span>
            <h1 style={{ ...headline, fontSize: '28px', margin: '10px 0 6px' }}>One plan.<br /><em style={{ fontStyle: 'italic' }}>Two ways to pay.</em></h1>
            <p style={{ fontSize: '13.5px', lineHeight: 1.45, color: NIGHT_INK_SOFT, margin: '0 0 18px' }}>Everything free stays free. Pro is optional, and you can leave it any time.</p>
            {p.loadingOffers ? (
              <p style={{ fontSize: '13px', color: NIGHT_INK_SOFT }}>Loading plans…</p>
            ) : p.offers.length === 0 ? (
              <p style={{ ...glass, borderRadius: 16, padding: '12px 14px', fontSize: '13px', color: NIGHT_INK_SOFT, lineHeight: 1.45 }}>Purchases aren't set up in this build yet. Everything stays free until they are.</p>
            ) : (
              <>
                <NightPlanCards offers={p.offers} value={p.offer?.key ?? p.selected} onChange={p.pick} disabled={p.busy} />
                <div style={{ marginTop: 16 }}><NightPurchaseFooter p={p} /></div>
              </>
            )}
            <div style={{ marginTop: 12 }}><NightLegal p={p} /></div>
          </>
        )}
      </section>

      <section style={{ marginTop: 36 }}>
        <span style={eyebrow}>Questions</span>
        <dl style={{ marginTop: 10 }}>
          {FAQ.map((f) => (
            <div key={f.q} style={{ padding: '12px 0', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <dt style={{ fontSize: '14px', fontWeight: 700, color: NIGHT_INK }}>{f.q}</dt>
              <dd style={{ margin: '4px 0 0', fontSize: '13px', lineHeight: 1.5, color: NIGHT_INK_SOFT }}>{f.a}</dd>
            </div>
          ))}
        </dl>
        <p style={{ marginTop: 14, fontSize: '12px', color: NIGHT_INK_FAINT }}>One plan, every device.</p>
      </section>
    </Shell>
  );
};
