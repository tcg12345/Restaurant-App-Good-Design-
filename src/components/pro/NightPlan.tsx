/**
 * The plan cards, the CTA and the legal row, in glass night. Shared by
 * the onboarding intro's last page and the Pro page.
 */
import React from 'react';
import { motion } from 'motion/react';
import { Check, Loader2 } from 'lucide-react';
import { openExternalUrl, TERMS_URL, PRIVACY_URL } from '../../lib/external-links';
import { ctaFor, finePrintFor, type PlanKey, type PlanOffer } from '../../lib/entitlements';
import { AppleGlyph } from '../onboarding/OnboardingKit';
import type { usePurchase } from './usePurchase';
import { glass, NIGHT_INK, NIGHT_INK_SOFT, NIGHT_INK_FAINT, PALE, ON_PALE, EASE } from './night';

type Purchase = ReturnType<typeof usePurchase>;

export const NightPlanCards: React.FC<{ offers: PlanOffer[]; value: PlanKey; onChange: (k: PlanKey) => void; disabled?: boolean }> = ({ offers, value, onChange, disabled }) => (
  <div role="radiogroup" aria-label="Plan" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    {offers.map((o) => {
      const on = o.key === value;
      return (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={on}
          disabled={disabled}
          onClick={() => onChange(o.key)}
          className="text-left active:scale-[0.99] transition-transform disabled:opacity-60"
          style={{
            ...glass,
            borderRadius: 18, padding: '13px 14px', position: 'relative', color: NIGHT_INK,
            border: `1px solid ${on ? PALE : 'rgba(255,255,255,0.12)'}`,
            background: on ? 'rgba(174, 187, 211, 0.12)' : 'rgba(255,255,255,0.06)',
          }}
        >
          {o.tag && (
            <span style={{ position: 'absolute', top: -10, left: 14, padding: '4px 9px', borderRadius: 999, background: PALE, color: ON_PALE, fontFamily: 'var(--font-mono)', fontSize: '8.5px', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 600 }}>{o.tag}</span>
          )}
          <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: '15px', fontWeight: 800 }}>{o.title}</span>
              <span style={{ display: 'block', fontSize: '11px', color: NIGHT_INK_SOFT, marginTop: 2, lineHeight: 1.3 }}>
                {o.priceLine}{o.trialDays > 0 ? ` · ${o.trialDays} days free first` : ''}
              </span>
            </span>
            <span style={{ textAlign: 'right', flex: 'none' }}>
              <span style={{ display: 'block', fontSize: '20px', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{o.perMonthLine ? o.perMonthLine.replace(/ a month$/, '') : o.priceLine.split(' /')[0]}</span>
              <span style={{ display: 'block', fontSize: '10px', color: NIGHT_INK_SOFT, marginTop: 3 }}>a month</span>
            </span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '12px', fontWeight: 700, color: on ? NIGHT_INK : NIGHT_INK_FAINT }}>
            <span style={{ width: 18, height: 18, borderRadius: 999, border: `1.6px solid ${on ? PALE : 'rgba(255,255,255,0.35)'}`, background: on ? PALE : 'transparent', color: ON_PALE, display: 'inline-grid', placeItems: 'center' }}>{on && <Check size={11} strokeWidth={3} />}</span>
            {on ? 'Selected' : 'Select'}
          </span>
        </button>
      );
    })}
  </div>
);

/** The CTA + fine print + legal row. `p` is the purchase hook's value. */
export const NightPurchaseFooter: React.FC<{ p: Purchase; ctaLabel?: string }> = ({ p, ctaLabel }) => (
  <div>
    <motion.button
      type="button"
      onClick={() => { void p.buy(); }}
      disabled={!p.offer || !p.available || p.busy}
      whileTap={!p.busy ? { scale: 0.97 } : undefined}
      transition={{ duration: 0.2, ease: EASE }}
      className="w-full flex items-center justify-center gap-2 rounded-full disabled:opacity-40"
      style={{ height: 52, background: PALE, color: ON_PALE, fontSize: '15px', fontWeight: 800, boxShadow: '0 12px 28px -12px rgba(174,187,211,0.6)' }}
    >
      {p.busy ? <Loader2 size={17} className="animate-spin" /> : (
        <>
          {p.native && <span style={{ display: 'inline-flex', filter: 'brightness(0)' }}><AppleGlyph /></span>}
          <span>{p.phase === 'error' ? 'Try again' : (ctaLabel ?? (p.offer ? ctaFor(p.offer) : 'Continue'))}</span>
        </>
      )}
    </motion.button>
    {p.phase === 'error' && (
      <p style={{ marginTop: 10, textAlign: 'center', fontSize: '12.5px', fontWeight: 600, color: '#e08273' }}>{p.error || 'The purchase didn’t go through. Nothing was charged.'}</p>
    )}
    {p.offer && p.phase !== 'error' && (
      <p style={{ marginTop: 8, textAlign: 'center', fontSize: '11.5px', color: NIGHT_INK_FAINT }}>{finePrintFor(p.offer)}</p>
    )}
  </div>
);

export const NightLegal: React.FC<{ p: Purchase }> = ({ p }) => (
  <p style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, fontSize: '11px', fontWeight: 600, color: NIGHT_INK_FAINT, margin: 0 }}>
    {p.native && <><button type="button" onClick={() => { void p.restore(); }} disabled={p.busy} className="underline-offset-2 hover:underline">Restore</button><span aria-hidden>·</span></>}
    <button type="button" onClick={() => { void openExternalUrl(TERMS_URL); }} className="underline-offset-2 hover:underline">Terms</button>
    <span aria-hidden>·</span>
    <button type="button" onClick={() => { void openExternalUrl(PRIVACY_URL); }} className="underline-offset-2 hover:underline">Privacy</button>
  </p>
);

/** The states after a purchase attempt: the check, or "finish in your browser". */
export const NightOutcome: React.FC<{ phase: 'success' | 'web-sent'; onDone: () => void }> = ({ phase, onDone }) => (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '40px 0' }}>
    {phase === 'success' ? (
      <>
        <span style={{ width: 64, height: 64, borderRadius: 999, background: 'rgba(174,187,211,0.16)', color: PALE, display: 'grid', placeItems: 'center' }}><Check size={28} /></span>
        <p style={{ marginTop: 18, fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: '30px', color: NIGHT_INK, letterSpacing: '-0.02em' }}>Welcome to <em style={{ fontStyle: 'italic' }}>Pro.</em></p>
        <p style={{ marginTop: 6, fontSize: '13.5px', color: NIGHT_INK_SOFT }}>Everything's unlocked.</p>
      </>
    ) : (
      <>
        <p style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: '26px', color: NIGHT_INK, letterSpacing: '-0.02em' }}>Finish in <em style={{ fontStyle: 'italic' }}>your browser.</em></p>
        <p style={{ marginTop: 8, fontSize: '13.5px', color: NIGHT_INK_SOFT, maxWidth: '30ch', lineHeight: 1.5 }}>Checkout opened in a new tab. Pro turns on here the moment it's done.</p>
        <button type="button" onClick={onDone} className="mt-6 rounded-full px-5 h-11" style={{ border: '1px solid rgba(255,255,255,0.2)', color: NIGHT_INK, fontSize: '13.5px', fontWeight: 700 }}>Done</button>
      </>
    )}
  </motion.div>
);
