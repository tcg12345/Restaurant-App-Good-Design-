import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { saveProfile, isUsernameTaken } from '../lib/supabase-community';
import { geocodePlace, type HomeLocation } from '../components/HomeLocationBar';
import { CityAutocomplete } from '../components/CityAutocomplete';
import { AuthShell, useDesktopAuthLayout } from '../components/AuthShell';
// Mobile uses the new cream/terracotta onboarding wizard; desktop keeps the
// original single-form AuthShell design.
import * as OB from '../components/onboarding/OnboardingKit';
import {
  TastePillGrid, AtmosphereGrid, FollowRail, RatePlacesStep,
  TASTE_CUISINES, TASTE_PRICES,
} from '../components/onboarding/TasteSteps';
import { AddRestaurantModal } from '../components/AddRestaurantModal';
import { ImportStep, importFooter, useOnboardingImport } from '../components/onboarding/ImportStep';
import { loadLastSelectedLocation } from '../components/HomeLocationBar';
import { saveTasteQuiz, getTasteQuiz } from '../lib/taste-quiz';
import { getPreauthCity } from '../lib/preauth';
import { logOnboardingEvent, markOnboardingStep } from '../lib/onboarding-events';

type StepKey =
  | 'name' | 'handle' | 'city'
  // Taste + first-actions steps — one wizard, one progress bar, instead of
  // the separate /onboarding page these lived on. The profile row persists
  // on leaving 'visibility', so a bail-out mid-taste still keeps the account.
  | 'cuisines' | 'prices' | 'atmosphere' | 'import' | 'follow' | 'rate';

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
  const useDesktopLayout = useDesktopAuthLayout();

  // Seed name/username from the identity provider ONCE, synchronously, so the
  // mobile wizard can decide up-front whether to even show the name step (App
  // Store Guideline 4 — when Sign in with Apple gives us the name we must not
  // re-collect it). Apple "Hide My Email" private-relay addresses are skipped.
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
      nameFromProvider: !!metaName,
    };
  });

  // Existing row first, identity-provider seed second, defaults last.
  const [displayName, setDisplayName] = useState(profile?.display_name || seed.name);
  const [username, setUsername] = useState(profile?.username || seed.username);
  // Existing row first, then the city picked during the pre-auth flow.
  const preauthCity = getPreauthCity();
  const [homeCity, setHomeCity] = useState(profile?.home_city || preauthCity?.label || '');
  const [homeGeo, setHomeGeo] = useState<HomeLocation | null>(profile?.home_city ? null : preauthCity);
  const [isPublic, setIsPublic] = useState(profile?.is_public ?? true);
  // Only persist visibility when the user explicitly chose it here (or the
  // account has no row yet) — otherwise an untouched default would flip an
  // existing private account public.
  const [visibilityTouched, setVisibilityTouched] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  // Mobile wizard state (unused by desktop, but hooks must be unconditional).
  const [pStep, setPStep] = useState(0);
  // +1 forward, -1 back — the step slide matches travel direction.
  const [dir, setDir] = useState(1);
  const [screen, setScreen] = useState<'wizard' | 'done'>('wizard');
  // Taste answers (the wizard's cold-start priors — see TasteSteps.tsx).
  // Seeded from the pre-auth flow's local mirror when it ran: those
  // questions were already answered before the account existed, so the
  // wizard skips them and this state carries the answers to the profile
  // row once it exists.
  const [preauth] = useState(() => ({
    answers: getTasteQuiz(null),
    city: getPreauthCity(),
  }));
  const [cuisineSel, setCuisineSel] = useState<string[]>(preauth.answers?.cuisines ?? []);
  const [priceSel, setPriceSel] = useState<number[]>(preauth.answers?.prices ?? []);
  const [atmosphere, setAtmosphere] = useState<string | null>(preauth.answers?.atmosphere ?? null);
  // The profile row saves once, on leaving 'visibility' — backing up and
  // coming forward again must not re-await a geocode + write.
  const [profileSaved, setProfileSaved] = useState(false);
  /**
   * Frozen when the user LEAVES the import step, never derived from
   * ratings.length. `pStep` is a positional index into `steps`, so removing
   * an entry is only safe while the user stands BEFORE it — a live
   * derivation could shrink the array out from under someone already on
   * 'rate', leaving steps[pStep] undefined and a blank screen.
   */
  const [skipRate, setSkipRate] = useState(false);
  const importState = useOnboardingImport((() => {
    if (homeGeo) return { lat: homeGeo.lat, lng: homeGeo.lng };
    if (typeof profile?.home_lat === 'number' && typeof profile?.home_lng === 'number') {
      return { lat: profile.home_lat, lng: profile.home_lng };
    }
    const last = loadLastSelectedLocation();
    return last ? { lat: last.lat, lng: last.lng } : null;
  })());

  useEffect(() => { logOnboardingEvent('wizard_start', user?.id); }, [user?.id]);
  // Which step an abandon is attributed to. Read through a ref because the
  // desktop layout returns before `steps` is computed, and a hook below
  // that return would change the hook count on a breakpoint resize.
  // Effects run after render, so the ref is already current; pStep and
  // screen cover every transition. `screen === 'done'` clears it —
  // finishing is not leaving.
  const stepKeyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    markOnboardingStep(screen === 'done' ? null : `wizard_${stepKeyRef.current ?? 'start'}`, user?.id);
  }, [screen, pStep, user?.id]);

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
    const homeBase = cityTrim
      ? { homeCity: geo?.label || cityTrim, homeLat: geo?.lat ?? null, homeLng: geo?.lng ?? null }
      : undefined;
    const isPublicToSave = (visibilityTouched || !profile) ? isPublic : undefined;
    const result = await saveProfile(user.id, displayName.trim() || username.trim(), username.trim(), undefined, isPublicToSave, homeBase);
    return { ok: result.success, error: result.error };
  }, [user, profile, homeCity, homeGeo, displayName, username, isPublic, visibilityTouched]);

  /* ── Desktop split layout (original single form) ─────────────────────── */
  if (useDesktopLayout) {
    const handleSubmit = async (e?: React.FormEvent) => {
      e?.preventDefault();
      setError('');
      if (!username.trim()) { setError('Please choose a username'); return; }
      if (username.length < 3) { setError('Username must be at least 3 characters'); return; }
      if (!/^[a-zA-Z0-9_]+$/.test(username)) { setError('Username can only contain letters, numbers, and underscores'); return; }
      if (availability === 'taken') { setError('That username is already taken'); return; }
      setSubmitting(true);
      const res = await persistProfile();
      // Desktop goes straight into the app: the taste steps are part of the
      // MOBILE wizard (the product's real signup surface). A desktop signup
      // just starts with default priors until they rate.
      if (res.ok) await refreshProfile();
      else setError(friendlyError(res.error));
      setSubmitting(false);
    };
    const handleSubmitThenVerify = async () => {
      setError('');
      if (!username.trim()) { setError('Please choose a username'); return; }
      if (username.length < 3) { setError('Username must be at least 3 characters'); return; }
      if (!/^[a-zA-Z0-9_]+$/.test(username)) { setError('Username can only contain letters, numbers, and underscores'); return; }
      if (availability === 'taken') { setError('That username is already taken'); return; }
      setSubmitting(true);
      const res = await persistProfile();
      if (res.ok) {
        navigate('/verify/apply');
        await refreshProfile();
      } else setError(friendlyError(res.error));
      setSubmitting(false);
    };
    const handleBack = () => { void signOut(); };
    const headerRight = (
      <button type="button" onClick={handleBack} className="inline-flex items-center gap-1.5 text-on-surface/55 hover:text-on-surface transition-colors cursor-pointer">
        <ArrowLeft size={14} />
        <span>Sign out</span>
      </button>
    );
    return (
      <AuthShell headerRight={headerRight} panel="profile">
        <div className="space-y-3">
          <header>
            <h1 className="font-serif font-bold text-3xl xl:text-4xl tracking-tight leading-[1.05] text-on-surface mb-1.5">
              Set up your profile
            </h1>
            <p className="text-sm text-on-surface/55 font-light leading-relaxed">
              Choose a display name and username so friends can find you.
            </p>
          </header>
          <form onSubmit={handleSubmit} className="w-full flex flex-col gap-3">
            <div>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface/45 mb-1.5">
                Display name
              </label>
              <input type="text" placeholder="e.g. Tyler Gorin" value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoCapitalize="words" autoComplete="name"
                className="w-full px-4 py-3 rounded-2xl bg-white/70 backdrop-blur-sm border border-black/5 text-on-surface placeholder:text-on-surface/30 focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm" />
              <p className="text-[11px] text-on-surface/40 mt-1 px-1">The name friends see on your profile.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface/45 mb-1.5">
                Username
              </label>
              <input type="text" placeholder="e.g. tyler_eats" value={username}
                onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                className="w-full px-4 py-3 rounded-2xl bg-white/70 backdrop-blur-sm border border-black/5 text-on-surface placeholder:text-on-surface/30 focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm"
                autoCapitalize="off" autoCorrect="off" autoComplete="username" />
              <p className="text-[11px] text-on-surface/40 mt-1 px-1 flex items-center justify-between gap-2">
                <span>
                  {username
                    ? <>Your unique handle: <span className="font-semibold text-primary">@{username.toLowerCase()}</span></>
                    : 'Your unique @handle — letters, numbers, and underscores.'}
                </span>
                {availability === 'checking' && <span className="flex-shrink-0">Checking…</span>}
                {availability === 'available' && <span className="flex-shrink-0 font-semibold text-green-700">Available</span>}
                {availability === 'taken' && <span className="flex-shrink-0 font-semibold text-red-600">Taken</span>}
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface/45 mb-1.5">
                Home city <span className="normal-case font-medium text-on-surface/35">(optional)</span>
              </label>
              <CityAutocomplete
                variant="form"
                value={homeCity}
                onChange={(v) => { setHomeCity(v); setHomeGeo(null); }}
                onPick={setHomeGeo}
              />
              <p className="text-[11px] text-on-surface/40 mt-1 px-1">Helps us surface restaurants near you.</p>
            </div>
            <div className="flex items-center justify-between bg-white/70 backdrop-blur-sm border border-black/5 rounded-2xl px-4 py-2.5">
              <div>
                <p className="text-sm font-medium text-on-surface">{isPublic ? 'Public Account' : 'Private Account'}</p>
                <p className="text-[11px] text-on-surface/40">{isPublic ? 'Anyone can see your profile and follow you' : 'Only approved followers can see your profile'}</p>
              </div>
              <button type="button" onClick={() => { setIsPublic(!isPublic); setVisibilityTouched(true); }}
                aria-label={isPublic ? 'Make profile private' : 'Make profile public'}
                className={`w-11 h-7 rounded-full relative transition-colors duration-200 flex-shrink-0 ${isPublic ? 'bg-primary' : 'bg-on-surface/15'}`}>
                <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-all ${isPublic ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
            </div>
            {error && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-xl">{error}</motion.p>
            )}
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              type="submit" disabled={submitting}
              className="group flex items-center justify-center gap-3 bg-primary text-white px-8 py-3 rounded-2xl text-base font-semibold shadow-lg shadow-primary/25 mt-1 disabled:opacity-60">
              {submitting ? <Loader2 size={18} className="animate-spin" /> : (
                <>Continue <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" /></>
              )}
            </motion.button>
            {/* Subtle, out-of-the-way verification entry — completes setup
                first (the application row needs the profile to exist), then
                opens the request form. */}
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleSubmitThenVerify()}
              className="mt-1 inline-flex items-center justify-center gap-1.5 text-[12px] font-medium text-on-surface/45 hover:text-primary transition-colors disabled:opacity-50"
            >
              <VerifiedBadge size={13} />
              Are you a chef, critic, or creator? Request verification
            </button>
          </form>
        </div>
      </AuthShell>
    );
  }

  /* ── Mobile cream/terracotta wizard ──────────────────────────────────── */
  // Questions the pre-auth flow already asked are not asked again: its
  // answers arrived seeded into state above, and re-asking would read as
  // the app forgetting them. OAuth users who skipped straight to signup
  // (no pre-auth answers) still get the full set.
  const hasPreauthTaste = !!preauth.answers
    && ((preauth.answers.cuisines?.length ?? 0) > 0
      || (preauth.answers.prices?.length ?? 0) > 0
      || !!preauth.answers.atmosphere);
  // Visibility is no longer its own step — it rides on 'handle' as a
  // toggle. Asking a user with zero content who may see it is abstract,
  // and it cost a whole screen at the point the flow can least afford one.
  //
  // Import sits AFTER the profile row persists (on leaving 'handle'), so a
  // step that can run 60 seconds never risks the account, and the row
  // exists before any rating publishes.
  const steps: StepKey[] = [
    ...(seed.nameFromProvider ? [] : ['name' as const]),
    'handle' as const,
    ...(preauth.city && !profile?.home_city ? [] : ['city' as const]),
    ...(hasPreauthTaste ? [] : (['cuisines', 'prices', 'atmosphere'] as const)),
    'import' as const,
    'follow' as const,
    ...(skipRate ? [] : ['rate' as const]),
  ];
  const provider = (user?.app_metadata?.provider as string) || 'email';
  const offset = provider === 'email' ? 1 : 0; // create-account was "step 1" for email signups
  const total = offset + steps.length;
  const stepKey = steps[pStep];
  stepKeyRef.current = stepKey;
  const isLast = pStep === steps.length - 1;


  /** Save the taste answers. Runs on leaving 'atmosphere' and again when
   *  the wizard ends — an upsert either way, so backing up and re-answering
   *  just refreshes the row. Empty answers write nothing. */
  const persistTaste = useCallback(() => {
    if (cuisineSel.length === 0 && priceSel.length === 0 && !atmosphere) return;
    void saveTasteQuiz(user?.id, {
      cuisines: cuisineSel,
      prices: priceSel,
      atmosphere: atmosphere ?? undefined,
      completedAt: Date.now(),
    });
  }, [user?.id, cuisineSel, priceSel, atmosphere]);

  const finishThenVerify = async () => {
    setSubmitting(true);
    setError('');
    const res = await persistProfile();
    setSubmitting(false);
    if (res.ok) {
      navigate('/verify/apply');
      void refreshProfile();
    } else setError(friendlyError(res.error));
  };

  const next = () => {
    setError('');
    setDir(1);
    if (stepKey === 'handle') {
      if (!username.trim()) { setError('Please choose a username'); return; }
      if (!usernameValid) { setError('Username must be 3+ letters, numbers, or underscores'); return; }
      if (availability === 'taken') { setError('That username is already taken'); return; }
    }
    if (stepKey === 'import') {
      // Someone who brought a ladder over doesn't need to be taught how to
      // build one — branch past the manual rate step rather than stacking
      // it. Only real ratings count: a wishlist-only import leaves them
      // with no scores, and the rate step is what fixes that.
      setSkipRate(importState.ratedCount > 0);
      logOnboardingEvent(
        importState.ratedCount > 0 ? 'wizard_import_done' : 'wizard_import_skipped',
        user?.id,
      );
    }
    // The profile row saves HERE, on leaving the identity step, not at the
    // wizard's end: everything after is skippable, and someone who bails
    // during import or the taste steps must still have a working account
    // with a name and handle. (App keeps showing this wizard regardless —
    // profileComplete only flips on the refreshProfile the done screen
    // fires.)
    if (stepKey === 'handle' && !profileSaved) {
      void (async () => {
        setSubmitting(true);
        const res = await persistProfile();
        setSubmitting(false);
        if (res.ok) {
          setProfileSaved(true);
          // The row exists now — stamp pre-auth taste answers onto it
          // immediately. When the taste steps run in-wizard this happens
          // again on their Continue; saveTasteQuiz is an upsert either way.
          persistTaste();
          logOnboardingEvent('wizard_profile_saved', user?.id);
          setPStep((p) => p + 1);
        }
        else setError(friendlyError(res.error));
      })();
      return;
    }
    if (stepKey === 'atmosphere') persistTaste();
    if (isLast) { persistTaste(); logOnboardingEvent('wizard_done', user?.id); setScreen('done'); return; }
    setPStep((p) => p + 1);
  };

  const back = () => {
    setError('');
    if (pStep <= 0) { void signOut(); return; }
    setDir(-1);
    setPStep((p) => p - 1);
  };

  if (screen === 'done') {
    return (
      <OB.OnboardingScreen glow="center">
        <div className="flex flex-1 flex-col items-center text-center" style={{ paddingTop: 48 }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={OB.SPRING_SOFT}
            className="flex items-center justify-center"
            style={{ width: 88, height: 88, borderRadius: '50%', background: OB.TERRA, boxShadow: '0 16px 36px -10px color-mix(in srgb, var(--ob-terra) 55%, transparent)' }}
          >
            <svg width="42" height="42" viewBox="0 0 44 44" fill="none">
              <motion.path
                d="M11 23l7 7 15-16"
                stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.45, delay: 0.18, ease: OB.EASE }}
              />
            </svg>
          </motion.div>
          <OB.Reveal blur i={1} style={{ marginTop: 26 }}><OB.Title>You're all set</OB.Title></OB.Reveal>
          <OB.Reveal i={2}>
            <p style={{ fontSize: 15.5, lineHeight: 1.55, color: OB.SECONDARY, margin: '12px 0 0', maxWidth: 280 }}>
              Welcome aboard, <span style={{ color: OB.TERRA, fontWeight: 600 }}>{handle}</span>. Let's find something worth the trip.
            </p>
          </OB.Reveal>
          <OB.Reveal i={3} style={{ marginTop: 'auto', paddingTop: 34, width: '100%' }}>
            <OB.PrimaryButton onClick={() => { void refreshProfile(); }}>Start exploring</OB.PrimaryButton>
          </OB.Reveal>
        </div>
      </OB.OnboardingScreen>
    );
  }

  return (
    <OB.OnboardingScreen>
      <OB.ProgressHeader step={offset + pStep + 1} total={total} onBack={back} />
      <div className="flex flex-1 flex-col">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
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
            {stepKey === 'name' && (
              <div className="flex flex-1 flex-col">
                <OB.StepHeader title="What should we call you?" subtitle="The name friends see on your profile." />
                <OB.Reveal i={2} style={{ marginTop: 30 }}>
                  <OB.Field value={displayName} onChange={setDisplayName} placeholder="Jane Doe" icon={<User size={17} strokeWidth={1.6} />} autoFocus autoComplete="name" autoCapitalize="words" onSubmit={next} />
                </OB.Reveal>
              </div>
            )}

            {stepKey === 'handle' && (
              <div className="flex flex-1 flex-col">
                <OB.StepHeader title="Claim your @" />
                <OB.Reveal i={1} style={{ marginTop: 30 }}>
                  <OB.Field value={username} onChange={(v) => { setUsername(v.replace(/\s/g, '').replace(/[^a-zA-Z0-9_]/g, '')); setError(''); }} placeholder="username" prefix="@" autoFocus autoComplete="username" autoCapitalize="off" onSubmit={next} />
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
                  {error && <OB.ErrorRow>{error}</OB.ErrorRow>}
                </OB.Reveal>
                {/* Visibility used to be a whole screen of its own. Asking
                    someone with zero content who may see it is abstract, and
                    the answer is better collected at the first publish — but
                    it stays visible here as one line, because a social app
                    silently defaulting this would be worse than a screen. */}
                <OB.Reveal i={2}>
                  <div
                    className="flex items-center justify-between rounded-2xl"
                    style={{ marginTop: 22, padding: '13px 16px', background: 'var(--ob-card)', border: '1px solid var(--ob-border)', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
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
                      <motion.span
                        className="absolute rounded-full bg-white"
                        initial={false}
                        animate={{ left: isPublic ? 21 : 3 }}
                        transition={OB.SPRING}
                        style={{ top: 3, width: 22, height: 22, boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }}
                      />
                    </button>
                  </div>
                </OB.Reveal>
              </div>
            )}

            {stepKey === 'city' && (
              <div className="flex flex-1 flex-col">
                <OB.StepHeader title="Where do you eat?" subtitle="We'll surface tables near you — change it anytime." />
                <OB.Reveal i={2} style={{ marginTop: 30 }}>
                  <CityAutocomplete value={homeCity} onChange={(v) => { setHomeCity(v); setHomeGeo(null); }} onPick={setHomeGeo} onSubmit={next} />
                </OB.Reveal>
              </div>
            )}

            {stepKey === 'cuisines' && (
              <div className="flex flex-1 flex-col">
                <OB.StepHeader title="Which cuisines do you love?" subtitle="Pick as many as you like." />
                <div style={{ marginTop: 26 }}>
                  <TastePillGrid
                    options={TASTE_CUISINES.map((c) => ({ id: c, label: c }))}
                    selected={cuisineSel}
                    onToggle={(id) => setCuisineSel((prev) => prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id])}
                  />
                </div>
              </div>
            )}

            {stepKey === 'prices' && (
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
              </div>
            )}

            {stepKey === 'atmosphere' && (
              <div className="flex flex-1 flex-col">
                <OB.StepHeader title="Your ideal atmosphere?" />
                <div style={{ marginTop: 22 }}>
                  <AtmosphereGrid selected={atmosphere} onSelect={setAtmosphere} />
                </div>
              </div>
            )}

            {stepKey === 'import' && (
              <div className="flex flex-1 flex-col">
                <OB.StepHeader
                  title="Already rank restaurants somewhere?"
                  subtitle="Screenshot your Beli list — we'll read every place and every score."
                />
                <OB.Reveal i={2} style={{ marginTop: 26 }}>
                  <ImportStep state={importState} />
                </OB.Reveal>
              </div>
            )}

            {stepKey === 'follow' && (
              <div className="flex flex-1 flex-col">
                <OB.StepHeader title="Follow a few tastemakers" subtitle="Their ratings and posts fill your feed from day one." />
                <OB.Reveal i={2} style={{ marginTop: 24 }}>
                  <FollowRail />
                </OB.Reveal>
              </div>
            )}

            {stepKey === 'rate' && (
              <div className="flex flex-1 flex-col">
                <OB.StepHeader title="Rate places you've been" subtitle="A few real ratings beat any quiz." />
                <OB.Reveal i={2} style={{ marginTop: 20 }}>
                  <RatePlacesStep />
                </OB.Reveal>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div style={{ paddingTop: 26 }}>
          {error && stepKey !== 'handle' && <div style={{ marginBottom: 12 }}><OB.ErrorRow>{error}</OB.ErrorRow></div>}
          {(() => {
            // The import step drives its own footer (its label and action
            // change per phase); every other step shares the wizard's.
            const f = stepKey === 'import'
              ? importFooter(importState, next)
              : {
                  label: isLast ? 'Finish setup' : stepKey === 'handle' ? 'Save & continue' : 'Continue',
                  onClick: next,
                  loading: submitting,
                  trailing: (isLast ? 'check' : 'arrow') as 'check' | 'arrow' | 'none',
                };
            return (
              <OB.PrimaryButton onClick={f.onClick} loading={f.loading} trailing={f.trailing}>
                {f.label}
              </OB.PrimaryButton>
            );
          })()}
          {stepKey === 'city' && (
            <div style={{ marginTop: 4 }}>
              <OB.GhostButton onClick={() => { setHomeCity(''); setHomeGeo(null); setError(''); setDir(1); setPStep((p) => p + 1); }}>Skip for now</OB.GhostButton>
            </div>
          )}
          {stepKey === 'handle' && (
            <div style={{ marginTop: 4 }}>
              {/* Verification lives on the last PROFILE step — it saves the
                  row and opens the request form, skipping everything after. */}
              <OB.GhostButton onClick={() => { void finishThenVerify(); }}>
                Are you a chef, critic, or creator? Request verification
              </OB.GhostButton>
            </div>
          )}
        </div>
      </div>
      {/* The rate step opens the app's real rating flow. App's own modal
          instance isn't mounted while this wizard shows (ProfileSetup
          renders before the main branch), so the wizard hosts one. */}
      <AddRestaurantModal />
    </OB.OnboardingScreen>
  );
};
