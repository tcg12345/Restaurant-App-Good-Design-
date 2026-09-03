/**
 * The Pro intro at the end of onboarding — glass night.
 *
 * Four pages, one story each, then the plan. Always dark whatever the
 * theme, a slate glow at the top, one glass object per page. Every page
 * has "Maybe later"; the × does the same. Nobody has to pay: the last
 * page says so in words, and either exit finishes onboarding exactly as
 * before. A purchase or a restore finishes it too.
 *
 * Replaces the wizard's shell for this step (it draws its own dots and
 * close), so it is not nested inside the wizard's AnimatePresence.
 */
import React, { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../contexts/SettingsContext';
import { logBillingEvent } from '../../lib/billing-events';
import { useNightStatusBar } from '../../lib/night-status-bar';
import { PRO_STORIES } from '../pro/ProStories';
import { usePurchase } from '../pro/usePurchase';
import { NightPlanCards, NightPurchaseFooter, NightLegal, NightOutcome } from '../pro/NightPlan';
import { NIGHT_BG, NIGHT_INK, NIGHT_INK_SOFT, PALE, glass, eyebrow, headline, EASE } from '../pro/night';

const PAGES = PRO_STORIES.length + 1;

export const ProIntroStep: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const { user } = useAuth();
  const reduce = useReducedMotion();
  const [page, setPage] = useState(0);
  const p = usePurchase('onboarding', { onSuccess: onDone });
  const { setHideBottomNav } = useSettings();
  useNightStatusBar();

  // A full screen: the tab bar steps aside (it isn't there during
  // onboarding, but /pro/intro shows this inside the app).
  useEffect(() => { setHideBottomNav(true); return () => setHideBottomNav(false); }, [setHideBottomNav]);

  useEffect(() => {
    logBillingEvent('paywall_shown', user?.id ?? null, { source: 'onboarding', plan: 'free' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const later = () => {
    logBillingEvent('paywall_dismissed', user?.id ?? null, { source: 'onboarding', meta: { page } });
    onDone();
  };

  const onPlan = page === PRO_STORIES.length;
  const story = onPlan ? null : PRO_STORIES[page];
  const outcome = p.phase === 'success' || p.phase === 'web-sent';

  return (
    <div className="relative w-full overflow-hidden" style={{ height: '100dvh', background: NIGHT_BG, color: NIGHT_INK }}>
      <div className="relative mx-auto flex h-full w-full max-w-[430px] flex-col" style={{ paddingTop: 'max(54px, calc(env(safe-area-inset-top) + 20px))', paddingLeft: 22, paddingRight: 22 }}>
        {/* Dots and the close: the same in every page, so they never move. */}
        <div className="flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-[5px]" aria-label={`Page ${page + 1} of ${PAGES}`} role="progressbar" aria-valuenow={page + 1} aria-valuemin={1} aria-valuemax={PAGES}>
            {Array.from({ length: PAGES }, (_, i) => (
              <motion.i key={i} className="block rounded-full" style={{ height: 6, background: NIGHT_INK }} animate={{ width: i === page ? 18 : 6, opacity: i === page ? 1 : 0.3 }} transition={{ duration: 0.3, ease: EASE }} />
            ))}
          </div>
          <button type="button" onClick={later} disabled={p.busy} aria-label="Not now" className="hit-44 w-9 h-9 rounded-full grid place-items-center disabled:opacity-40" style={{ background: 'rgba(255,255,255,0.1)', color: NIGHT_INK }}>
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col">
          {/* Keyed div, no AnimatePresence: the entrance plays per page and
              nothing waits on an exit. Inside the app's route stack a nested
              AnimatePresence never finishes its exits, and the page would
              swap its footer without swapping its body. */}
          <motion.div
              key={outcome ? 'outcome' : page}
              className="flex flex-1 flex-col items-center text-center"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.42, ease: EASE }}
            >
              {outcome ? (
                <NightOutcome phase={p.phase as 'success' | 'web-sent'} onDone={onDone} />
              ) : story ? (
                <>
                  <div style={{ ...glass, borderRadius: 22, padding: 14, width: '100%', maxWidth: 300, marginTop: 26, textAlign: 'left' }}>
                    <story.Visual />
                  </div>
                  <div style={{ marginTop: 22 }}><span style={eyebrow}>GoodEats Pro · {story.eyebrow}</span></div>
                  <h1 style={{ ...headline, fontSize: '30px', margin: '12px 0 8px' }}>{story.line1}<br /><em style={{ fontStyle: 'italic' }}>{story.line2}</em></h1>
                  <p style={{ fontSize: '13.5px', lineHeight: 1.45, color: NIGHT_INK_SOFT, maxWidth: '28ch', margin: 0 }}>{story.sub}</p>
                </>
              ) : (
                <div className="w-full text-left" style={{ marginTop: 18 }}>
                  <span style={eyebrow}>GoodEats Pro</span>
                  <h1 style={{ ...headline, fontSize: '28px', margin: '12px 0 8px' }}>One plan.<br /><em style={{ fontStyle: 'italic' }}>Two ways to pay.</em></h1>
                  <p style={{ fontSize: '13.5px', lineHeight: 1.45, color: NIGHT_INK_SOFT, margin: '0 0 18px' }}>Everything free stays free. Pro is optional, and you can leave it any time.</p>
                  {p.loadingOffers ? (
                    <p style={{ fontSize: '13px', color: NIGHT_INK_SOFT }}>Loading plans…</p>
                  ) : p.offers.length === 0 ? (
                    <p style={{ ...glass, borderRadius: 16, padding: '12px 14px', fontSize: '13px', color: NIGHT_INK_SOFT, lineHeight: 1.45 }}>Purchases aren't set up in this build yet. Everything stays free until they are.</p>
                  ) : (
                    <NightPlanCards offers={p.offers} value={p.offer?.key ?? p.selected} onChange={p.pick} disabled={p.busy} />
                  )}
                </div>
              )}
            </motion.div>
        </div>

        {!outcome && (
          <div className="flex-shrink-0" style={{ paddingTop: 12, paddingBottom: 'max(22px, env(safe-area-inset-bottom))' }}>
            {onPlan ? (
              <NightPurchaseFooter p={p} />
            ) : (
              <motion.button type="button" onClick={() => setPage((n) => n + 1)} whileTap={{ scale: 0.97 }} transition={{ duration: 0.2, ease: EASE }} className="w-full rounded-full" style={{ height: 52, background: PALE, color: '#161a22', fontSize: '15px', fontWeight: 800, boxShadow: '0 12px 28px -12px rgba(174,187,211,0.6)' }}>
                Continue
              </motion.button>
            )}
            <button type="button" onClick={later} disabled={p.busy} className="w-full hit-44 disabled:opacity-40" style={{ height: 44, marginTop: 6, fontSize: '13.5px', fontWeight: 700, color: NIGHT_INK_SOFT }}>
              Maybe later
            </button>
            {onPlan && <div style={{ marginTop: 4 }}><NightLegal p={p} /></div>}
          </div>
        )}
      </div>
    </div>
  );
};
