import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Star } from 'lucide-react';
import * as OB from './OnboardingKit';
import { TastePillGrid, AtmosphereGrid, TASTE_CUISINES, TASTE_PRICES } from './TasteSteps';
import { CityAutocomplete } from '../CityAutocomplete';
import { saveLastSelectedLocation } from '../HomeLocationBar';
import { saveTasteQuiz } from '../../lib/taste-quiz';
import { savePreauthCity, markPreauthDone, savePreauthOutcome } from '../../lib/preauth';
import { logOnboardingEvent, markOnboardingStep } from '../../lib/onboarding-events';
import {
  buildTasteProfile, buildCandidateQueries, scoreCandidates,
  type CandidateSignals, type ScoredPlace, type RecCandidate,
} from '../../lib/recommendations';
import {
  searchPlacesByText, searchPlacesByTextPaged, isFoodPlace, isVenuePlace,
  priceLevelToString, TEXT_EXACT_SUFFICIENT_POOL, type PlaceResult,
} from '../../lib/places';
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

type PreStep = 'welcome' | 'cuisines' | 'prices' | 'atmosphere' | 'city' | 'preview';
const ORDER: PreStep[] = ['welcome', 'cuisines', 'prices', 'atmosphere', 'city', 'preview'];

const emptySignals = (): CandidateSignals => ({
  expertUserIds: new Set(),
  followedExpertIds: new Set(),
  friendUserIds: new Set(),
  communityByRestaurant: new Map(),
  expertRecRestaurantIds: new Set(),
});

const PREVIEW_RADIUS_M = 12_000;

/** Cold-start preview: quiz answers → taste profile → candidate queries →
 *  live search → scorer. At most 3 billed text searches, behind the search
 *  memo. Exported for reuse/tests. */
export async function fetchTastePreview(
  answers: { cuisines: string[]; prices: number[]; atmosphere: string | null },
  city: HomeLocation,
): Promise<ScoredPlace[]> {
  // Same signal shape the flow persists — otherwise the preview would rank
  // by different rules than the app the user is about to sign up for.
  const profile = buildTasteProfile([], [], [], [], {
    cuisines: answers.cuisines,
    prices: answers.prices,
    pricePrimary: answers.prices[0],
    priceSecondary: answers.prices[1],
    atmosphere: answers.atmosphere ?? undefined,
    city: city.label,
  });
  const queries = buildCandidateQueries(profile, city).slice(0, 3);
  const batches = await Promise.all(queries.map((q) =>
    q.priceLevels && q.priceLevels.length > 0
      ? searchPlacesByTextPaged(q.text, {
          lat: city.lat, lng: city.lng, radiusMeters: PREVIEW_RADIUS_M,
          useRestriction: true, priceLevels: q.priceLevels,
        }).then((page) => page.places).catch(() => [] as PlaceResult[])
      : searchPlacesByText(q.text, city.lat, city.lng, city.label, true, PREVIEW_RADIUS_M,
          undefined, { minExactResults: TEXT_EXACT_SUFFICIENT_POOL })
          .catch(() => [] as PlaceResult[]),
  ));
  const seen = new Set<string>();
  const pool: RecCandidate[] = [];
  for (const p of batches.flat()) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    // Light quality floor — the preview is a first impression, and a 3.4★
    // with nine reviews makes the "made for your taste" claim ring false.
    if (!isFoodPlace(p.types) || isVenuePlace(p)) continue;
    if ((p.rating || 0) < 4.0 || (p.userRatingCount || 0) < 25) continue;
    pool.push(p);
  }
  return scoreCandidates(pool, profile, emptySignals(), city, PREVIEW_RADIUS_M, { limit: 6 });
}

const PreviewCard: React.FC<{ place: ScoredPlace; index: number }> = ({ place, index }) => {
  const sub = [cuisineLabel(place), priceLevelToString(place.priceLevel)].filter(Boolean).join(' · ');
  // This screen's headline is "built from your answers", so lead with a
  // reason that actually came from them. Google's star count is true but
  // says nothing about the person — leading with it is how the old preview
  // made a personalization claim it couldn't support.
  const why = place.tasteReasons?.[0] ?? place.reasons?.[0];
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
  const [priceSel, setPriceSel] = useState<number[]>([]);
  const [atmosphere, setAtmosphere] = useState<string | null>(null);
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
  const persistAnswers = () => {
    if (cuisineSel.length === 0 && priceSel.length === 0 && !atmosphere && !cityGeo) return;
    void saveTasteQuiz(undefined, {
      cuisines: cuisineSel,
      // Both shapes: the flat array for anything still reading it, and the
      // primary/secondary split the pair + price priors actually want. The
      // step is still a multi-select, so the first pick is the primary —
      // the merged cuisine × spend screen will state it explicitly.
      prices: priceSel,
      pricePrimary: priceSel[0],
      priceSecondary: priceSel[1],
      atmosphere: atmosphere ?? undefined,
      city: cityGeo?.label,
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
    fetchTastePreview({ cuisines: cuisineSel, prices: priceSel, atmosphere }, cityGeo)
      .then((places) => {
        if (cancelled) return;
        setPreview(places);
        if (places.length > 0) logOnboardingEvent('preauth_preview_shown');
      });
    return () => { cancelled = true; };
  }, [step, cityGeo, preview, cuisineSel, priceSel, atmosphere]);

  const advanceFromCity = () => {
    if (cityGeo) {
      savePreauthCity(cityGeo);
      // ALSO write the key the app genuinely resolves from. The pre-auth
      // city used to dead-end: it reached the profile row, and nothing
      // ever read those columns back into the map or the rec target — so
      // a user who typed "Austin", confirmed "Austin" and saw an Austin
      // preview landed on Discover showing New York.
      saveLastSelectedLocation(cityGeo);
      logOnboardingEvent('location_resolved');
      go('preview');
    } else {
      // No city, no preview to show — the gate still explains itself.
      persistAnswers();
      go('preview');
    }
  };

  return (
    <OB.OnboardingScreen>
      {step !== 'welcome' && (
        <OB.ProgressHeader step={idx} total={ORDER.length - 1} onBack={back} />
      )}
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
              <OB.Reveal blur i={1}><OB.Title size={36}>Find your next favorite table</OB.Title></OB.Reveal>
              <OB.Reveal i={2}><OB.Subtitle>Three quick questions, and we'll show you where to eat.</OB.Subtitle></OB.Reveal>
            </div>
            <OB.Reveal i={3} style={{ marginTop: 'auto', paddingTop: 30 }}>
              <OB.PrimaryButton onClick={() => go('cuisines')}>Get started</OB.PrimaryButton>
              <div style={{ marginTop: 4 }}>
                <OB.GhostButton onClick={() => leave('signin')}>Already have an account? Sign in</OB.GhostButton>
              </div>
              {onBrowseAsGuest && (
                <OB.GhostButton onClick={() => leave('guest')}>Browse without an account</OB.GhostButton>
              )}
            </OB.Reveal>
          </div>
        )}

        {step === 'cuisines' && (
          <div className="flex flex-1 flex-col">
            <OB.StepHeader title="Which cuisines do you love?" subtitle="Pick as many as you like." />
            <div style={{ marginTop: 26 }}>
              <TastePillGrid
                options={TASTE_CUISINES.map((c) => ({ id: c, label: c }))}
                selected={cuisineSel}
                onToggle={(id) => setCuisineSel((prev) => prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id])}
              />
            </div>
            <OB.Reveal i={3} style={{ marginTop: 'auto', paddingTop: 24 }}>
              <OB.PrimaryButton onClick={() => go('prices')}>Continue</OB.PrimaryButton>
            </OB.Reveal>
          </div>
        )}

        {step === 'prices' && (
          <div className="flex flex-1 flex-col">
            <OB.StepHeader title="What do you usually spend?" />
            <div style={{ marginTop: 26 }}>
              <TastePillGrid
                options={TASTE_PRICES.map((t) => ({ id: String(t.tier), label: t.label, sub: t.sub }))}
                selected={priceSel.map(String)}
                onToggle={(id) => {
                  const tier = Number(id);
                  setPriceSel((prev) => prev.includes(tier) ? prev.filter((t) => t !== tier) : [...prev, tier]);
                }}
              />
            </div>
            <OB.Reveal i={3} style={{ marginTop: 'auto', paddingTop: 24 }}>
              <OB.PrimaryButton onClick={() => go('atmosphere')}>Continue</OB.PrimaryButton>
            </OB.Reveal>
          </div>
        )}

        {step === 'atmosphere' && (
          <div className="flex flex-1 flex-col">
            <OB.StepHeader title="Your ideal atmosphere?" />
            <div style={{ marginTop: 22 }}>
              <AtmosphereGrid selected={atmosphere} onSelect={setAtmosphere} />
            </div>
            <OB.Reveal i={3} style={{ marginTop: 'auto', paddingTop: 24 }}>
              <OB.PrimaryButton onClick={() => go('city')}>Continue</OB.PrimaryButton>
            </OB.Reveal>
          </div>
        )}

        {step === 'city' && (
          <div className="flex flex-1 flex-col">
            <OB.StepHeader title="Where do you eat?" subtitle="Your first picks come from here." />
            <OB.Reveal i={2} style={{ marginTop: 26 }}>
              <CityAutocomplete
                value={cityText}
                onChange={(v) => { setCityText(v); setCityGeo(null); }}
                onPick={(loc) => { setCityText(loc.label); setCityGeo(loc); }}
                onSubmit={advanceFromCity}
              />
            </OB.Reveal>
            <OB.Reveal i={3} style={{ marginTop: 'auto', paddingTop: 24 }}>
              <OB.PrimaryButton onClick={advanceFromCity}>{cityGeo ? 'Show my picks' : 'Continue'}</OB.PrimaryButton>
              <div style={{ marginTop: 4 }}>
                <OB.GhostButton onClick={() => { persistAnswers(); go('preview'); }}>Skip for now</OB.GhostButton>
              </div>
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
                  preview.slice(0, 4).map((p, i) => <PreviewCard key={p.id} place={p} index={i} />)
                ) : (
                  <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ob-label)' }}>
                    We couldn't pull picks for that area just now — your taste profile is saved and ready either way.
                  </p>
                )}
              </div>
            )}
            <OB.Reveal i={3} style={{ marginTop: 'auto', paddingTop: 26 }}>
              <OB.PrimaryButton onClick={() => leave('signup')} trailing="check">Save my taste profile</OB.PrimaryButton>
              <div style={{ marginTop: 4 }}>
                <OB.GhostButton onClick={() => leave('signin')}>Already have an account? Sign in</OB.GhostButton>
              </div>
              {onBrowseAsGuest && (
                <OB.GhostButton onClick={() => leave('guest')}>Browse without an account</OB.GhostButton>
              )}
            </OB.Reveal>
          </div>
        )}
      </motion.div>
    </OB.OnboardingScreen>
  );
};
