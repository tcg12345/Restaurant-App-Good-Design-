import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'motion/react';
import { Camera, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Avatar } from '../components/Avatar';
import { processPhoto } from '../lib/images';
import { saveProfile, isUsernameTaken } from '../lib/supabase-community';
import { geocodePlace, savePickedLocation, type HomeLocation } from '../components/HomeLocationBar';
import { CityAutocomplete } from '../components/CityAutocomplete';
// One responsive setup flow across phones, tablets, and desktop.
import * as OB from '../components/onboarding/OnboardingKit';
import {
  CuisineGrid, PriceStep, DietaryStep,
  TASTE_CUISINES,
} from '../components/onboarding/TasteSteps';
import { saveTasteQuiz, getTasteQuiz } from '../lib/taste-quiz';
import { getPreauthCity } from '../lib/preauth';
import { logOnboardingEvent, markOnboardingStep } from '../lib/onboarding-events';
import { usePlan } from '../contexts/PlanContext';
import { billingAvailable } from '../lib/billing';
import { ProIntroStep } from '../components/onboarding/ProIntroStep';

type StepKey = 'handle' | 'city' | 'cuisines' | 'prices' | 'dietary' | 'pro';

/**
 * Save failures are shown verbatim to someone in the middle of creating an
 * account, so keep database internals out of them — "Could not find the
 * 'home_city' column … in the schema cache" is not something they can act
 * on. Anything we deliberately worded (the username rules) passes through.
 */
const friendlyError = (raw?: string): string => {
  const message = (raw || '').trim();
  if (!message) return 'Something went wrong. Please try again.';
  if (/username/i.test(message)) return message;
  if (/schema cache|column|relation|constraint|violates|policy|permission denied|duplicate key|JWT|row-level/i.test(message)) {
    return "We couldn't save your profile just now. Please try again.";
  }
  return message;
};

export const ProfileSetup: React.FC = () => {
  // `profile` is the user's EXISTING row (partial profiles land here too, and
  // App.tsx guarantees the fetch settled before we render). Prefill from it
  // and only overwrite what the user actually touches — this screen must
  // never reset a real profile back to defaults.
  const { user, profile, refreshProfile, signOut } = useAuth();

  // Reuse provider names and avoid exposing private-relay email prefixes.
  const [seed] = useState(() => {
    const md = (user?.user_metadata ?? {}) as Record<string, unknown>;
    const metaName = (
      (md.full_name as string) || (md.name as string) ||
      [md.given_name, md.family_name].filter(Boolean).join(' ')
    ).trim();
    const email = user?.email ?? '';
    const isPrivateRelay = /@privaterelay\.appleid\.com$/i.test(email);
    const emailPrefix = isPrivateRelay ? '' : (email.split('@')[0] ?? '');
    const name = metaName || emailPrefix;
    return {
      name,
      username: name.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20),
    };
  });

  // Existing row first, identity-provider seed second, defaults last.
  const [displayName, setDisplayName] = useState(profile?.display_name || seed.name);
  const [username, setUsername] = useState(profile?.username || seed.username);
  // Existing row first, then the city picked during the pre-auth flow.
  const preauthCity = getPreauthCity();
  const [homeCity, setHomeCity] = useState(profile?.home_city || preauthCity?.label || '');
  const [homeGeo, setHomeGeo] = useState<HomeLocation | null>(profile?.home_city && typeof profile.home_lat === 'number' && typeof profile.home_lng === 'number' ? { label: profile.home_city, lat: profile.home_lat, lng: profile.home_lng } : profile?.home_city ? null : preauthCity);
  const [isPublic, setIsPublic] = useState(profile?.is_public ?? true);
  // Only persist visibility when the user explicitly chose it here (or the
  // account has no row yet) — otherwise an untouched default would flip an
  // existing private account public.
  const [visibilityTouched, setVisibilityTouched] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Mobile wizard state (unused by desktop, but hooks must be unconditional).
  const [pStep, setPStep] = useState(0);
  // +1 forward, -1 back — the step slide matches travel direction.
  const [dir, setDir] = useState(1);
  // Set the instant the wizard's last step completes — App swaps this wizard
  // out for the main app as soon as refreshProfile lands, so there is no
  // "you're done" screen of its own to wait on; this just stops abandon
  // tracking from firing during that brief gap.
  const [finishing, setFinishing] = useState(false);
  // Taste answers (the wizard's cold-start priors — see TasteSteps.tsx).
  // Seeded from the pre-auth flow's local mirror when it ran: those
  // questions were already answered before the account existed, so the
  // wizard skips them and this state carries the answers to the profile
  // row once it exists.
  const [preauth] = useState(() => ({
    answers: getTasteQuiz(profile),
    city: getPreauthCity(),
  }));
  const [cuisineSel, setCuisineSel] = useState<string[]>(preauth.answers?.cuisines ?? []);
  const [pricePrimary, setPricePrimary] = useState<number | undefined>(
    preauth.answers?.pricePrimary ?? preauth.answers?.prices?.[0],
  );
  const [priceSecondary, setPriceSecondary] = useState<number | undefined>(
    preauth.answers?.priceSecondary ?? preauth.answers?.prices?.[1],
  );
  // Dietary preferences — asked here, after the account exists, never in
  // the pre-auth stretch (three questions is that flow's whole promise).
  const [dietarySel, setDietarySel] = useState<string[]>(preauth.answers?.dietary ?? []);
  // Profile photo. Uploaded on pick (processPhoto → the `photos` bucket, the
  // same path Settings uses), so what they see is what gets saved; the row
  // takes the URL on the handle step's "Save & continue". Untouched means
  // undefined to saveProfile — an existing photo is never cleared by
  // passing through here.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_url ?? null);
  const [avatarTouched, setAvatarTouched] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setAvatarBusy(true);
    setError('');
    try {
      // 512px at a higher quality than feed photos: an avatar renders
      // small almost everywhere, but it is also the one image blown up to
      // 84px+ on a profile header.
      const url = await processPhoto(file, { maxDim: 512, quality: 0.8 });
      setAvatarUrl(url);
      setAvatarTouched(true);
    } catch {
      setError("That image couldn't be read. Try another photo.");
    }
    setAvatarBusy(false);
  };
  const plan = usePlan();
  const proOffered = useRef(false);
  if (plan.checked && plan.gatesEnabled && !plan.isPro && billingAvailable()) proOffered.current = true;
  useEffect(() => { logOnboardingEvent('wizard_start', user?.id); }, [user?.id]);
  // Track abandonment against the screen actually being shown.
  const stepKeyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    markOnboardingStep(finishing ? null : `wizard_${stepKeyRef.current ?? 'start'}`, user?.id);
  }, [finishing, pStep, user?.id]);

  const handle = '@' + (username.toLowerCase() || 'username');
  const usernameValid = username.trim().length >= 3 && /^[a-zA-Z0-9_]+$/.test(username);

  // Real availability, not just regex validity — a handle can be perfectly
  // well-formed and still belong to someone else (which used to surface only
  // as the 23505 error on submit). Debounced head-count query; 'unknown'
  // (check failed) shows nothing and lets the submit-time backstop decide.
  type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'unknown';
  const [availability, setAvailability] = useState<Availability>('idle');
  useEffect(() => {
    if (!usernameValid) { setAvailability('idle'); return; }
    const uname = username.toLowerCase().trim();
    // Keeping your current handle is always fine.
    if (profile?.username && uname === profile.username.toLowerCase()) {
      setAvailability('available');
      return;
    }
    setAvailability('checking');
    let cancelled = false;
    const t = setTimeout(async () => {
      const taken = await isUsernameTaken(uname, user?.id);
      if (cancelled) return;
      setAvailability(taken === null ? 'unknown' : taken ? 'taken' : 'available');
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [username, usernameValid, profile?.username, user?.id]);

  // Shared persistence (geocode the city, write the profile). Fields the user
  // never touched go up as `undefined` so saveProfile leaves the existing row
  // values alone: bio has no input on this screen (passing '' erased it), and
  // visibility only writes when explicitly chosen or the row doesn't exist.
  const persistProfile = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!user?.id) return { ok: false };
    const cityTrim = homeCity.trim();
    const geo = homeGeo ?? (cityTrim ? await geocodePlace(cityTrim) : null);
    // The city given here is also where the app should open: without this it
    // only ever reached the profile row, and someone who corrected their city
    // during signup kept browsing the pre-auth one.
    if (geo) savePickedLocation(geo);
    const homeBase = cityTrim
      ? { homeCity: geo?.label || cityTrim, homeLat: geo?.lat ?? null, homeLng: geo?.lng ?? null }
      : undefined;
    const isPublicToSave = (visibilityTouched || !profile) ? isPublic : undefined;
    const result = await saveProfile(
      user.id, displayName.trim() || username.trim(), username.trim(), undefined, isPublicToSave, homeBase,
      avatarTouched ? avatarUrl : undefined,
    );
    return { ok: result.success, error: result.error };
  }, [user, profile, homeCity, homeGeo, displayName, username, isPublic, visibilityTouched, avatarUrl, avatarTouched]);

  const hasPreauthCuisines = (preauth.answers?.cuisines?.length ?? 0) > 0;
  const hasPreauthPrices = (preauth.answers?.prices?.length ?? 0) > 0;
  // Already-answered questions stay out of the way.
  const steps: StepKey[] = [
    'handle' as const,
    // A known city from EITHER source skips the question. The old
    // predicate (`preauth.city && !profile?.home_city`) inverted the
    // second half: a profile that already carried home_city ADDED the
    // step — more information produced more questions.
    ...(preauth.city || profile?.home_city ? [] : ['city' as const]),
    ...(hasPreauthCuisines ? [] : ['cuisines' as const]),
    ...(hasPreauthPrices ? [] : ['prices' as const]),
    'dietary' as const,
    ...(proOffered.current ? ['pro' as const] : []),
  ];

  const offset = 0;
  const total = offset + steps.length;
  const stepKey = steps[pStep];
  stepKeyRef.current = stepKey;
  const isLast = pStep === steps.length - 1;


  /** Save the taste answers. Runs on leaving 'prices' and again when
   *  the wizard ends — an upsert either way, so backing up and re-answering
   *  just refreshes the row. Empty answers write nothing. */
  const persistTaste = useCallback(async () => {
    const prices = [pricePrimary, priceSecondary].filter((n): n is number => n !== undefined);
    // saveTasteQuiz is a FULL REPLACE (local mirror and DB row alike), so
    // every field the pre-auth flow wrote must ride along or it dies
    // here — which is exactly what used to happen: the primary/secondary
    // price split and the stated city were wiped seconds after signup,
    // the very fields that switch on the price-restricted queries and
    // seed city affinity in lib/recommendations.
    await saveTasteQuiz(user?.id, {
      cuisines: cuisineSel,
      prices,
      pricePrimary,
      priceSecondary,
      city: homeGeo?.label ?? (homeCity.trim() || undefined),
      atmosphere: preauth.answers?.atmosphere,
      avoidCuisines: preauth.answers?.avoidCuisines,
      dietary: dietarySel,
      completedAt: Date.now(),
    });
  }, [user?.id, cuisineSel, pricePrimary, priceSecondary, dietarySel, preauth.answers, homeGeo, homeCity]);

  const saving = useRef(false);
  const finishWizard = async () => {
    if (saving.current) return;
    saving.current = true;
    setSubmitting(true);
    setError('');
    try {
      const result = await persistProfile();
      if (!result.ok) throw new Error(friendlyError(result.error));
      await persistTaste();
      setFinishing(true);
      logOnboardingEvent('wizard_done', user?.id);
      await refreshProfile();
    } catch (err) {
      setFinishing(false);
      setError(err instanceof Error ? err.message : "Couldn't finish setup. Try again.");
    } finally {
      saving.current = false;
      setSubmitting(false);
    }
  };

  const next = async () => {
    if (saving.current || avatarBusy) return;
    setError('');
    if (stepKey === 'handle') {
      if (!displayName.trim()) { setError('Enter your name'); return; }
      if (!usernameValid) { setError('Use at least 3 letters, numbers, or underscores'); return; }
      if (availability === 'taken') { setError('That username is already taken'); return; }
    }
    if (isLast) { await finishWizard(); return; }
    saving.current = true;
    setSubmitting(true);
    try {
      // Save again after edits and after choosing a city. Refresh only at
      // completion, so the app doesn't replace the wizard mid-step.
      if (stepKey === 'handle' || stepKey === 'city') {
        const result = await persistProfile();
        if (!result.ok) throw new Error(friendlyError(result.error));
      }
      await persistTaste();
      setDir(1);
      setPStep(p => p + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save. Try again.");
    } finally {
      saving.current = false;
      setSubmitting(false);
    }
  };

  const back = () => {
    if (saving.current || avatarBusy) return;
    setError('');
    if (pStep <= 0) { void signOut(); return; }
    setDir(-1);
    setPStep((p) => p - 1);
  };

  const footer = <>
    {error && <OB.ErrorRow>{error}</OB.ErrorRow>}
    {stepKey !== 'handle' && <OB.GhostButton onClick={() => { void finishWizard(); }}>Finish setup</OB.GhostButton>}
    <OB.PrimaryButton onClick={() => { void next(); }} loading={submitting} disabled={avatarBusy}>
      {isLast ? 'Start exploring' : stepKey === 'dietary' ? 'Continue' : 'Save & continue'}
    </OB.PrimaryButton>
  </>;

  if (stepKey === 'pro') return <ProIntroStep onDone={() => { void finishWizard(); }} finishing={submitting} error={error} />;

  return (
    <OB.OnboardingScreen
      header={<OB.ProgressHeader step={offset + pStep + 1} total={total} onBack={back} />}
      footer={footer}
    >
      <div className="flex flex-1 flex-col">

          <motion.div
            key={stepKey}
            custom={dir}
            variants={{
              enter: (d: number) => ({ opacity: 0, x: 24 * d }),
              center: { opacity: 1, x: 0 },
              exit: (d: number) => ({ opacity: 0, x: -20 * d }),
            }}
            initial="enter" animate="center" exit="exit"
            transition={OB.SPRING}
            className="flex flex-1 flex-col"
          >
            {stepKey === 'handle' && (
              <div className="flex flex-1 flex-col">
                <OB.StepHeader title={<>Set up <em>your profile</em></>} subtitle="A few details, then you’re in." />
                {/* The photo, on the one step every signup sees (the name
                    step is skipped when Apple or Google already gave us
                    one). A social app whose new accounts are all
                    monograms looks empty from the first feed; the nav bar
                    and every follow row wear this image from day one. */}
                <OB.Reveal i={1} style={{ marginTop: 26 }}>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void pickAvatar(f); }}
                  />
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={avatarBusy}
                    className="w-full flex items-center gap-3.5 rounded-2xl text-left cursor-pointer disabled:opacity-70"
                    style={{ padding: '12px 14px', background: 'var(--ob-card)', border: '1px solid var(--ob-border)', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
                  >
                    <span className="relative flex-none">
                      <Avatar src={avatarUrl} name={displayName.trim() || username.trim() || 'You'} size={56} />
                      <span
                        className="absolute flex items-center justify-center rounded-full"
                        style={{ right: -3, bottom: -3, width: 23, height: 23, background: OB.TERRA, color: OB.ON_TERRA, border: '2px solid var(--ob-card)' }}
                      >
                        {avatarBusy ? <Loader2 size={11} className="animate-spin" /> : <Camera size={11} strokeWidth={2.4} />}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block" style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ob-ink)' }}>
                        {avatarUrl ? 'Change photo' : 'Add a profile photo'}
                      </span>
                      <span className="block" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.35, color: 'var(--ob-label)' }}>
                        Optional
                      </span>
                    </span>
                  </button>
                </OB.Reveal>
                <OB.Reveal i={2} style={{ marginTop: 16 }}>
                  <div style={{ marginBottom: 12 }}><OB.Field value={displayName} onChange={setDisplayName} placeholder="Your name" name="name" autoComplete="name" autoCapitalize="words" /></div>
                  <OB.Field value={username} onChange={(v) => { setUsername(v.replace(/\s/g, '').replace(/[^a-zA-Z0-9_]/g, '')); setError(''); }} placeholder="username" prefix="@" autoComplete="username" autoCapitalize="off" onSubmit={next} />
                  <div className="flex items-center justify-between" style={{ marginTop: 11 }}>
                    <div style={{ fontSize: 13.5, color: 'var(--ob-label)' }}>Your handle: <span style={{ color: OB.TERRA, fontWeight: 600 }}>{handle}</span></div>
                    {availability === 'checking' && (
                      <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12.5, color: 'var(--ob-label)', fontWeight: 600 }}>
                        <Loader2 size={12} className="animate-spin" /> Checking…
                      </span>
                    )}
                    {availability === 'available' && (
                      <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12.5, color: 'var(--ob-success)', fontWeight: 600 }}>
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="var(--ob-success-dot)" /><path d="M5 8.2l2 2 4-4.4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        Available
                      </span>
                    )}
                    {availability === 'taken' && (
                      <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12.5, color: 'var(--ob-error)', fontWeight: 600 }}>
                        Taken
                      </span>
                    )}
                  </div>
                </OB.Reveal>
                {/* Visibility used to be a whole screen of its own. Asking
                    someone with zero content who may see it is abstract, and
                    the answer is better collected at the first publish — but
                    it stays visible here as one line, because a social app
                    silently defaulting this would be worse than a screen. */}
                <OB.Reveal i={3}>
                  <div
                    className="flex items-center justify-between rounded-2xl"
                    style={{ marginTop: 16, padding: '13px 16px', background: 'var(--ob-card)', border: '1px solid var(--ob-border)', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
                  >
                    <span className="min-w-0 flex-1" style={{ paddingRight: 12 }}>
                      <span className="block" style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ob-ink)' }}>
                        {isPublic ? 'Public account' : 'Private account'}
                      </span>
                      <span className="block" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.35, color: 'var(--ob-label)' }}>
                        {isPublic
                          ? 'Anyone can follow you and see your ratings.'
                          : 'Only people you approve can see your activity.'}
                      </span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isPublic}
                      aria-label={isPublic ? 'Make account private' : 'Make account public'}
                      onClick={() => { setIsPublic(!isPublic); setVisibilityTouched(true); }}
                      className="flex-none relative rounded-full border-none cursor-pointer transition-colors"
                      style={{ width: 46, height: 28, background: isPublic ? OB.TERRA : 'var(--ob-radio-ring)' }}
                    >
                      {/* Knob in ON_TERRA when on: the track is bone on the
                          dark theme, where a white knob disappeared into it. */}
                      <motion.span
                        className="absolute rounded-full"
                        initial={false}
                        animate={{ left: isPublic ? 21 : 3 }}
                        transition={OB.SPRING}
                        style={{ top: 3, width: 22, height: 22, background: isPublic ? OB.ON_TERRA : '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }}
                      />
                    </button>
                  </div>
                </OB.Reveal>
              </div>
            )}

            {stepKey === 'city' && (
              <div className="flex flex-1 flex-col">
                <OB.StepHeader title={<>Where do you <em>eat?</em></>} subtitle="We'll surface tables near you — change it anytime." />
                <OB.Reveal i={2} style={{ marginTop: 30 }}>
                  <CityAutocomplete value={homeCity} onChange={(v) => { setHomeCity(v); setHomeGeo(null); }} onPick={setHomeGeo} onSubmit={next} />
                </OB.Reveal>
              </div>
            )}

            {stepKey === 'cuisines' && (
              <div className="flex flex-1 flex-col">
                <OB.StepHeader title={<>Which cuisines do you <em>love?</em></>} subtitle="Pick as many as you like." />
                <div style={{ marginTop: 22 }}>
                  <CuisineGrid
                    options={TASTE_CUISINES}
                    selected={cuisineSel}
                    onToggle={(id) => setCuisineSel((prev) => prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id])}
                  />
                </div>
              </div>
            )}

            {stepKey === 'prices' && (
              <div className="flex flex-1 flex-col">
                <OB.StepHeader title={<>What do you usually <em>spend?</em></>} subtitle="Your usual budget. Optional." />
                <OB.Reveal i={2} style={{ marginTop: 26 }}>
                  <PriceStep
                    primary={pricePrimary}
                    secondary={priceSecondary}
                    onChange={(p, s) => { setPricePrimary(p); setPriceSecondary(s); }}
                  />
                </OB.Reveal>
              </div>
            )}

            {stepKey === 'dietary' && (
              <div className="flex flex-1 flex-col">
                <OB.StepHeader title={<>Anything to <em>keep in mind?</em></>} subtitle="Optional — we'll favor places with good options for you." />
                <div style={{ marginTop: 24 }}>
                  <DietaryStep
                    selected={dietarySel}
                    onToggle={(id) => setDietarySel((prev) => prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id])}
                  />
                </div>
              </div>
            )}

          </motion.div>

      </div>
    </OB.OnboardingScreen>
  );
};
