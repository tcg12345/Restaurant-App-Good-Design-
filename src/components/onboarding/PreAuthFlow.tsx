import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Star, LogIn } from 'lucide-react';
import * as OB from './OnboardingKit';
import { CuisineGrid, PriceStep, TASTE_CUISINES } from './TasteSteps';
import { CityAutocomplete } from '../CityAutocomplete';
import { savePickedLocation, geocodePlace } from '../HomeLocationBar';
import { saveTasteQuiz } from '../../lib/taste-quiz';
import { savePreauthCity, markPreauthDone, savePreauthOutcome } from '../../lib/preauth';
import { logOnboardingEvent, markOnboardingStep } from '../../lib/onboarding-events';
import { fetchTastePreview } from '../../lib/taste-preview';
import type { ScoredPlace } from '../../lib/recommendations';
import { priceLevelToString } from '../../lib/places';
import { cuisineLabel } from '../../lib/cuisine';
import type { HomeLocation } from '../HomeLocationBar';

/**
 * The pre-auth onboarding: taste questions BEFORE the account gate, with a
 * personalized preview as the payoff, so the signup ask arrives after the
 * app has shown what it can do — "save your taste profile", not "create an
 * account to find out".
 *
 * Everything collected here is device-local (lib/taste-quiz's local mirror
 * plus lib/preauth) and flows into the post-signup wizard: ProfileSetup
 * reads the answers, skips the questions already answered, prefills the
 * city, and stamps the profile row once it exists.
 *
 * The preview runs the REAL cold-start recommendation path — the quiz-
 * seeded taste profile through buildCandidateQueries and scoreCandidates —
 * not a canned list. What they see is what the app will actually do with
 * their answers, which is the only honest version of this screen.
 *
 * Escapes on the first and last screens: returning users go straight to
 * sign-in, and "Browse without an account" stays reachable (App Store
 * 5.1.1(v)). Leaving in any direction marks the flow done for this device.
 */

type PreStep = 'welcome' | 'cuisines' | 'prices' | 'city' | 'preview';
const ORDER: PreStep[] = ['welcome', 'cuisines', 'prices', 'city', 'preview'];

/**
 * The welcome screen's one visual: three rows of a ranked list, scores
 * worn as discs. It says what the app IS — a ladder you build, not a
 * directory you browse — before a single question is asked, and it fills
 * the two-thirds of the screen that used to sit empty under the headline.
 * Real places, so the list reads like one a person would actually keep.
 */
const TEASER_ROWS = [
  { rank: 1, name: 'Lucali', sub: 'Pizza · $$', score: '9.4' },
  { rank: 2, name: 'Via Carota', sub: 'Italian · $$$', score: '9.1' },
  { rank: 3, name: "Xi'an Famous Foods", sub: 'Chinese · $', score: '8.7' },
];

const TeaserStack: React.FC = () => (
  <div>
    <OB.Reveal i={3}>
      <div style={{ fontSize: 11, letterSpacing: '1.4px', fontWeight: 700, color: 'var(--ob-label)', textTransform: 'uppercase', marginBottom: 12 }}>
        Your list, ranked
      </div>
    </OB.Reveal>
    <div className="flex flex-col" style={{ gap: 8 }} aria-hidden>
      {TEASER_ROWS.map((row, i) => (
        <motion.div
          key={row.name}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.32 + i * 0.09, ease: OB.EASE }}
          className="flex items-center gap-3 rounded-2xl"
          style={{ padding: '11px 14px', background: 'var(--ob-card)', border: '1px solid var(--ob-border)', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
        >
          <span className="flex-none tabular-nums" style={{ width: 18, fontSize: 13, fontWeight: 700, color: 'var(--ob-label)' }}>{row.rank}</span>
          <span className="flex-1 min-w-0">
            <span className="block truncate font-serif font-bold" style={{ fontSize: 15.5, lineHeight: 1.2, color: 'var(--ob-ink)' }}>{row.name}</span>
            <span className="block truncate" style={{ fontSize: 12.5, marginTop: 2, color: 'var(--ob-label)' }}>{row.sub}</span>
          </span>
          <motion.span
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ ...OB.SPRING_SOFT, delay: 0.55 + i * 0.09 }}
            className="flex-none flex items-center justify-center rounded-full tabular-nums"
            style={{ width: 40, height: 40, fontSize: 13.5, fontWeight: 700, background: OB.TERRA, color: OB.ON_TERRA }}
          >
            {row.score}
          </motion.span>
        </motion.div>
      ))}
    </div>
  </div>
);

const PreviewCard: React.FC<{ place: ScoredPlace; index: number; picked: string[]; celebrate?: number }> = ({ place, index, picked, celebrate }) => {
  const cuisine = cuisineLabel(place);
  const price = priceLevelToString(place.priceLevel);
  const sub = [cuisine, price].filter(Boolean).join(' · ');
  // This screen's headline is "built from your answers", so lead with a
  // reason that actually came from them. Google's star count is true but
  // says nothing about the person — leading with it is how the old preview
  // made a personalization claim it couldn't support. And when the place
  // is one of the cuisines they just tapped, SAY that: the engine's own
  // ordering put "In your price range" on every card, because at cold
  // start the cuisine term is confidence-halved and price is not.
  const pickedMatch = cuisine && picked.find((p) => cuisine.toLowerCase().includes(p.toLowerCase()));
  // The occasion tier carries half the usual tier's weight, so it never
  // clears the engine's reason threshold on its own — name it here, or a
  // $$$$ pick shows up explained by nothing but its star count.
  const isCelebration = celebrate !== undefined && price.length === celebrate;
  const why = pickedMatch
    ? `${pickedMatch} — one of your picks`
    : isCelebration
      ? `For when you're celebrating (${price})`
      : place.tasteReasons?.[0] ?? place.reasons?.[0];
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: index * 0.07, ease: OB.EASE }}
      className="rounded-2xl"
      style={{ padding: '13px 16px', background: 'var(--ob-card)', border: '1px solid var(--ob-border)', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
    >
      <div className="flex items-center gap-3">
        <span className="flex-1 min-w-0">
          <span className="block truncate font-serif font-bold" style={{ fontSize: 15.5, lineHeight: 1.2, color: 'var(--ob-ink)' }}>{place.name}</span>
          <span className="block truncate" style={{ fontSize: 12.5, marginTop: 3, color: 'var(--ob-label)' }}>{sub}</span>
        </span>
        {place.rating > 0 && (
          <span className="flex-none inline-flex items-center gap-1" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ob-ink)' }}>
            <Star size={12} fill="currentColor" strokeWidth={0} style={{ color: OB.TERRA }} />
            {place.rating.toFixed(1)}
          </span>
        )}
      </div>
      {why && (
        <span className="mt-2 inline-block rounded-full" style={{ padding: '4px 10px', fontSize: 11.5, fontWeight: 600, color: OB.TERRA, background: 'var(--ob-badge-bg)' }}>
          {why}
        </span>
      )}
    </motion.div>
  );
};

export const PreAuthFlow: React.FC<{
  /** Leave for the Auth screen — 'signup' framed as saving the profile,
   *  'signin' for the returning-user escape. */
  onExit: (mode: 'signup' | 'signin') => void;
  onBrowseAsGuest?: () => void;
}> = ({ onExit, onBrowseAsGuest }) => {
  const [step, setStep] = useState<PreStep>('welcome');
  // +1 forward, -1 back — the entrance slide matches travel direction.
  const [dir, setDir] = useState(1);
  const [cuisineSel, setCuisineSel] = useState<string[]>([]);
  // The usual tier and the occasional one — stated as such, not inferred
  // from tap order (see PriceStep).
  const [pricePrimary, setPricePrimary] = useState<number | undefined>(undefined);
  const [priceSecondary, setPriceSecondary] = useState<number | undefined>(undefined);
  const priceSel = useMemo(
    () => [pricePrimary, priceSecondary].filter((n): n is number => n !== undefined),
    [pricePrimary, priceSecondary],
  );
  const [cityText, setCityText] = useState('');
  const [cityGeo, setCityGeo] = useState<HomeLocation | null>(null);
  const [preview, setPreview] = useState<ScoredPlace[] | null>(null);

  useEffect(() => { logOnboardingEvent('preauth_start'); }, []);
  // Which screen an abandon would be attributed to.
  useEffect(() => { markOnboardingStep(`preauth_${step}`); }, [step]);

  const idx = ORDER.indexOf(step);
  const go = (next: PreStep) => {
    logOnboardingEvent(`preauth_${step}_done`);
    setDir(1);
    setStep(next);
  };
  const back = () => { if (idx > 0) { setDir(-1); setStep(ORDER[idx - 1]); } };

  /** Persist answers to the local mirror (no user yet) — ProfileSetup
   *  reads them back after signup and stamps the row. */
  const persistAnswers = (geoOverride?: HomeLocation | null) => {
    const geo = geoOverride ?? cityGeo;
    if (cuisineSel.length === 0 && priceSel.length === 0 && !geo) return;
    void saveTasteQuiz(undefined, {
      cuisines: cuisineSel,
      // Both shapes: the flat array for anything still reading it, and the
      // primary/secondary split the pair + price priors actually want.
      prices: priceSel,
      pricePrimary,
      priceSecondary,
      city: geo?.label,
      completedAt: Date.now(),
    });
  };

  const leave = (mode: 'signup' | 'signin' | 'guest') => {
    persistAnswers();
    markPreauthDone();
    // Durable, unlike App's `preauthExited` React state: a relaunch on the
    // gate must still show the "save what you just built" ask, and a guest
    // is owed one follow-up offer on a later launch.
    savePreauthOutcome(mode);
    // Left on purpose — not an abandon. The wizard re-registers on mount.
    markOnboardingStep(null);
    logOnboardingEvent(`preauth_gate_${mode}`);
    if (mode === 'guest') onBrowseAsGuest?.();
    else onExit(mode);
  };

  // Preview data — fires when the step is reached with a real city.
  useEffect(() => {
    if (step !== 'preview' || !cityGeo || preview !== null) return;
    let cancelled = false;
    fetchTastePreview({ cuisines: cuisineSel, prices: priceSel }, cityGeo)
      .then((places) => {
        if (cancelled) return;
        setPreview(places);
        if (places.length > 0) logOnboardingEvent('preauth_preview_shown');
      });
    return () => { cancelled = true; };
  }, [step, cityGeo, preview, cuisineSel, priceSel]);

  const [resolvingCity, setResolvingCity] = useState(false);
  const advanceFromCity = async () => {
    let geo = cityGeo;
    // Free-typed text gets geocoded here instead of silently dropped.
    // This was the step's worst bug: onChange nulls cityGeo on every
    // keystroke, so someone who typed "New York" in full and hit
    // Continue — without tapping a suggestion row — sailed past as if
    // they'd skipped, and the post-signup wizard asked for the city all
    // over again.
    if (!geo && cityText.trim().length >= 2) {
      setResolvingCity(true);
      geo = await geocodePlace(cityText.trim());
      setResolvingCity(false);
      if (geo) { setCityText(geo.label); setCityGeo(geo); }
    }
    if (geo) {
      savePreauthCity(geo);
      // ALSO write the location the app genuinely resolves from. The
      // pre-auth city used to dead-end: it reached the profile row, and
      // nothing ever read those columns back into the map or the rec target
      // — so a user who typed "Austin", confirmed "Austin" and saw an Austin
      // preview landed on Discover showing New York.
      // As a PICK, not just an anchor: this is the answer every later launch
      // falls back to when the device's location isn't available, which is
      // what makes the city chosen here the app's default until it's changed.
      savePickedLocation(geo);
      persistAnswers(geo);
      logOnboardingEvent('location_resolved');
      go('preview');
    } else {
      // Nothing resolvable — the gate still explains itself.
      persistAnswers();
      go('preview');
    }
  };

  // One footer per step, keyed so it re-plays its entrance on every step
  // change (the content pane remounts the same way via `key={step}`) — but
  // rendered OUTSIDE the scrollable pane, so "Continue" lands on the exact
  // same pixel on 'cuisines' as it does on the much longer 'preview' list.
  //
  // The primary button is always the LAST element in the footer, never the
  // first: a footer is only as tall as what's actually in it, so a ghost
  // link stacked BELOW the button would push the button itself up on
  // exactly the steps that have one — the same drifting-button bug one
  // level down. Anything secondary goes ABOVE it instead, so the button's
  // distance from the bottom edge never depends on what else is on screen.
  const footer = (() => {
    switch (step) {
      case 'welcome':
        return (
          <OB.Reveal key={step} i={3}>
            {/* Sign in is a real button, not a line of grey text: half of
                everyone landing here already has an account, and making
                them hunt for eight-word ghost copy was burying the second
                most important action on the screen. Still secondary — the
                bordered pill, never a second terracotta. */}
            {onBrowseAsGuest && (
              <div style={{ marginBottom: 4 }}>
                <OB.GhostButton onClick={() => leave('guest')}>Browse without an account</OB.GhostButton>
              </div>
            )}
            <div style={{ marginBottom: 10 }}>
              <OB.SecondaryButton icon={<LogIn size={16} strokeWidth={2} />} onClick={() => leave('signin')}>
                Sign in
              </OB.SecondaryButton>
            </div>
            <OB.PrimaryButton onClick={() => go('cuisines')}>Get started</OB.PrimaryButton>
          </OB.Reveal>
        );
      case 'cuisines':
        return (
          <OB.Reveal key={step} i={3}>
            <OB.PrimaryButton onClick={() => go('prices')}>Continue</OB.PrimaryButton>
          </OB.Reveal>
        );
      case 'prices':
        return (
          <OB.Reveal key={step} i={3}>
            <OB.PrimaryButton onClick={() => go('city')}>Continue</OB.PrimaryButton>
          </OB.Reveal>
        );
      case 'city':
        return (
          <OB.Reveal key={step} i={3}>
            {/* Skip disappears once a city exists — with one picked, the
                only honest action left is showing the picks, and a skip
                that DISCARDED a chosen city was exactly the bug here. */}
            {!cityGeo && !cityText.trim() && (
              <div style={{ marginBottom: 4 }}>
                <OB.GhostButton onClick={() => { persistAnswers(); go('preview'); }}>Skip for now</OB.GhostButton>
              </div>
            )}
            <OB.PrimaryButton onClick={() => { void advanceFromCity(); }} loading={resolvingCity}>
              {cityGeo ? 'Show my picks' : 'Continue'}
            </OB.PrimaryButton>
          </OB.Reveal>
        );
      case 'preview':
        return (
          <OB.Reveal key={step} i={3}>
            {/* No sign-in / guest links here — the welcome screen already
                offered both, and repeating them made the flow's last
                screen read like its first. The Auth screen this leads to
                still carries "Browse without an account" (5.1.1(v)). */}
            <OB.PrimaryButton onClick={() => leave('signup')} trailing="check">Save my taste profile</OB.PrimaryButton>
          </OB.Reveal>
        );
    }
  })();

  return (
    <OB.OnboardingScreen
      header={step !== 'welcome' && <OB.ProgressHeader step={idx} total={ORDER.length - 1} onBack={back} />}
      footer={footer}
    >
      {/* Keyed div, no AnimatePresence — entrance plays per step (direction-
          aware) and nothing gates on an exit animation completing. */}
      <motion.div
        key={step}
        initial={{ opacity: 0, x: 24 * dir }}
        animate={{ opacity: 1, x: 0 }}
        transition={OB.SPRING}
        className="flex flex-1 flex-col"
      >
        {step === 'welcome' && (
          <div className="flex flex-1 flex-col">
            <motion.div
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ ...OB.SPRING_SOFT, delay: 0.05 }}
              style={{ marginTop: 40 }}
            >
              <OB.BrandMark size={56} />
            </motion.div>
            <div style={{ marginTop: 26 }}>
              <OB.Reveal blur i={1}><OB.Title size={36}>Find your next <em>favorite table</em></OB.Title></OB.Reveal>
              <OB.Reveal i={2}><OB.Subtitle>A couple quick questions, and we'll show you where to eat.</OB.Subtitle></OB.Reveal>
            </div>
            {/* Pushed to the bottom of the scroll region so it sits just
                above the actions, whatever the screen height. */}
            <div style={{ marginTop: 'auto', paddingTop: 36, paddingBottom: 8 }}>
              <TeaserStack />
            </div>
          </div>
        )}

        {step === 'cuisines' && (
          <div className="flex flex-1 flex-col">
            <OB.StepHeader
              title="Which cuisines do you love?"
              subtitle={cuisineSel.length > 0
                ? `${cuisineSel.length} picked — add as many as you like.`
                : 'Pick as many as you like.'}
            />
            <div style={{ marginTop: 22 }}>
              <CuisineGrid
                options={TASTE_CUISINES}
                selected={cuisineSel}
                onToggle={(id) => setCuisineSel((prev) => prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id])}
              />
            </div>
          </div>
        )}

        {step === 'prices' && (
          <div className="flex flex-1 flex-col">
            <OB.StepHeader title={<>What do you usually <em>spend?</em></>} subtitle="Your picks lean toward this, without ever excluding a great table." />
            <OB.Reveal i={2} style={{ marginTop: 26 }}>
              <PriceStep
                primary={pricePrimary}
                secondary={priceSecondary}
                onChange={(p, s) => { setPricePrimary(p); setPriceSecondary(s); }}
              />
            </OB.Reveal>
          </div>
        )}

        {step === 'city' && (
          <div className="flex flex-1 flex-col">
            <OB.StepHeader title={<>Where do you <em>eat?</em></>} subtitle="Your first picks come from here." />
            <OB.Reveal i={2} style={{ marginTop: 26 }}>
              <CityAutocomplete
                value={cityText}
                onChange={(v) => { setCityText(v); setCityGeo(null); }}
                onPick={(loc) => { setCityText(loc.label); setCityGeo(loc); }}
                onSubmit={advanceFromCity}
              />
            </OB.Reveal>
          </div>
        )}

        {step === 'preview' && (
          <div className="flex flex-1 flex-col">
            <OB.StepHeader
              title={cityGeo ? 'Your first picks' : 'Your taste profile is ready'}
              subtitle={cityGeo
                ? `Near ${cityGeo.label.split(',')[0]} — built from your answers.`
                : "Save it and we'll surface tables that fit it, wherever you are."}
            />
            {cityGeo && (
              <div className="flex flex-col gap-2.5" style={{ marginTop: 22 }}>
                {preview === null ? (
                  [0, 1, 2].map((i) => (
                    <div key={i} className="animate-pulse rounded-2xl" style={{ height: 74, background: 'var(--ob-divider)' }} />
                  ))
                ) : preview.length > 0 ? (
                  preview.slice(0, 4).map((p, i) => (
                    <PreviewCard key={p.id} place={p} index={i} picked={cuisineSel} celebrate={priceSecondary} />
                  ))
                ) : (
                  <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ob-label)' }}>
                    We couldn't pull picks for that area just now — your taste profile is saved and ready either way.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </motion.div>
    </OB.OnboardingScreen>
  );
};
