/**
 * /pro — GoodEats Pro at page scale, in glass night, on ONE screen: a
 * swipeable story card that takes whatever height the phone has to
 * spare, the two plans side by side beneath it, the button, the legal
 * row. Nothing to scroll to; the questions that used to sit below the
 * fold are answered by the plan cards' own lines ("cancel anytime") and
 * the App Store. On a Pro account the same page shows the plan's status
 * and where to manage it.
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

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

/** The story card never goes below this; on a phone too short for it the
 *  page scrolls rather than crushing the object inside. */
const CARD_MIN = 300;
/** …and never above this, so a tall phone gets air around it instead of
 *  a card that swallows the screen. */
const CARD_MAX = 470;

/** The stories, one glass card each, swiped. The card is a single
 *  object: the screen it stands for sits on the card's own ground, the
 *  words beneath a hairline — no box inside the box. Dots follow the
 *  scroll. */
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
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div
        ref={ref}
        className="flex overflow-x-auto no-scrollbar snap-x snap-mandatory"
        style={{ flex: `1 1 ${CARD_MIN}px`, minHeight: CARD_MIN, maxHeight: CARD_MAX, scrollbarWidth: 'none', gap: 0, margin: '0 -22px', padding: '0 22px', scrollPaddingLeft: 22, scrollPaddingRight: 22 }}
      >
        {PRO_STORIES.map((s, i) => (
          <div key={s.id} className="snap-center flex-none" style={{ width: '100%', paddingRight: i === PRO_STORIES.length - 1 ? 0 : 10, boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
            <div style={{ ...glass, flex: 1, borderRadius: 26, padding: '20px 18px 18px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                {index === i ? <s.Visual key={`${s.id}-${index}`} /> : <s.Visual />}
              </div>
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.09)' }}>
                <span style={eyebrow}>{s.eyebrow}</span>
                <h2 style={{ ...headline, fontSize: '25px', margin: '9px 0 5px' }}>{s.line1} <em style={{ fontStyle: 'italic' }}>{s.line2}</em></h2>
                <p style={{ fontSize: '12.5px', lineHeight: 1.45, color: NIGHT_INK_SOFT, margin: 0 }}>{s.sub}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-center gap-[5px]" style={{ marginTop: 8, flex: 'none' }} role="tablist" aria-label="Stories">
        {PRO_STORIES.map((s, i) => (
          <button key={s.id} type="button" role="tab" aria-selected={index === i} aria-label={s.eyebrow} onClick={() => go(i)} className="hit-44-y" style={{ padding: 4 }}>
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

  // The screen is a column the exact height of the viewport. The story
  // card is the one flexible row; everything else takes what it needs.
  // Only a phone shorter than the card's floor ever scrolls.
  const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div style={{ background: NIGHT_BG, color: NIGHT_INK, height: '100dvh', overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <div
        className="mx-auto w-full"
        style={{
          maxWidth: phoneMode ? 430 : 560,
          minHeight: '100%',
          display: 'flex', flexDirection: 'column',
          padding: phoneMode ? '0 22px' : '0 24px',
          paddingTop: 'max(54px, calc(env(safe-area-inset-top) + 16px))',
          paddingBottom: 'max(22px, calc(env(safe-area-inset-bottom) + 10px))',
        }}
      >
        <div className="flex items-center gap-3" style={{ marginBottom: 14, flex: 'none' }}>
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
        <div className="flex-1 flex flex-col items-center justify-center text-center" style={{ paddingBottom: 60 }}>
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

      <section style={{ marginTop: 16, flex: 'none' }}>
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
            {p.loadingOffers ? (
              // Two blanks the size of the cards, so the button doesn't
              // jump when the store answers.
              <div aria-busy style={{ display: 'flex', gap: 8 }}>
                {[0, 1].map((i) => <div key={i} style={{ ...glass, flex: 1, height: 104, borderRadius: 18, opacity: 0.5 }} />)}
              </div>
            ) : p.offers.length === 0 ? (
              <p style={{ ...glass, borderRadius: 16, padding: '12px 14px', fontSize: '13px', color: NIGHT_INK_SOFT, lineHeight: 1.45 }}>Purchases aren't set up in this build yet. Everything stays free until they are.</p>
            ) : (
              <>
                <NightPlanCards layout="row" offers={p.offers} value={p.offer?.key ?? p.selected} onChange={p.pick} disabled={p.busy} />
                <div style={{ marginTop: 12 }}><NightPurchaseFooter p={p} /></div>
              </>
            )}
            <div style={{ marginTop: 10 }}><NightLegal p={p} /></div>
          </>
        )}
      </section>
    </Shell>
  );
};
