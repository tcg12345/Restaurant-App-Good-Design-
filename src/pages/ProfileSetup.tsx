import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User, MapPin } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { saveProfile } from '../lib/supabase-community';
import { geocodePlace, searchLocations, type HomeLocation } from '../components/HomeLocationBar';
import {
  OnboardingScreen, Title, Subtitle, Eyebrow, FieldLabel, Field, PrimaryButton,
  GhostButton, ProgressHeader, RadioCard, ErrorRow, TERRA, SECONDARY, BORDER, LABEL_GREY,
} from '../components/onboarding/OnboardingKit';

type AccountType = 'lover' | 'expert';
type StepKey = 'name' | 'handle' | 'city' | 'type' | 'visibility';

/* ── City autocomplete (Mapbox suggestions, reused from HomeLocationBar) ── */
const CityAutocomplete: React.FC<{
  value: string;
  onChange: (v: string) => void;
  onPick: (loc: HomeLocation) => void;
  onSubmit?: () => void;
}> = ({ value, onChange, onPick, onSubmit }) => {
  const [suggestions, setSuggestions] = useState<HomeLocation[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNext = useRef(false); // don't re-search the value we just picked

  useEffect(() => {
    if (skipNext.current) { skipNext.current = false; return; }
    const q = value.trim();
    if (timer.current) clearTimeout(timer.current);
    if (q.length < 2) { setSuggestions([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      const res = await searchLocations(q);
      setSuggestions(res);
      setOpen(res.length > 0);
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value]);

  const pick = (loc: HomeLocation) => {
    skipNext.current = true;
    onChange(loc.label);
    onPick(loc);
    setOpen(false);
    setSuggestions([]);
  };

  return (
    <div className="relative">
      <Field
        value={value} onChange={onChange} placeholder="e.g. New York"
        icon={<MapPin size={16} strokeWidth={1.6} />} autoFocus autoCapitalize="words"
        onSubmit={onSubmit}
        onFocus={() => { if (suggestions.length) setOpen(true); }}
        onBlur={() => { setTimeout(() => setOpen(false), 150); }}
      />
      {open && suggestions.length > 0 && (
        <div
          className="absolute left-0 right-0 z-20 overflow-hidden"
          style={{ top: 'calc(100% + 8px)', borderRadius: 15, background: '#fff', border: `1.5px solid ${BORDER}`, boxShadow: '0 16px 40px rgba(40,24,14,0.14)' }}
        >
          {suggestions.map((s, i) => (
            <button
              key={`${s.label}-${i}`}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              className="w-full flex items-center gap-2.5 text-left cursor-pointer bg-white border-none transition-colors"
              style={{ padding: '12px 16px', borderTop: i === 0 ? 'none' : `1px solid #F2E9E3` }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#FAF4F0')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#fff')}
            >
              <MapPin size={15} strokeWidth={1.6} style={{ color: LABEL_GREY, flexShrink: 0 }} />
              <span className="truncate" style={{ fontSize: 14.5, color: '#3A322E' }}>{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const ProfileSetup: React.FC = () => {
  const { user, refreshProfile, signOut } = useAuth();

  // Seed name/username from the identity provider ONCE, synchronously, so we can
  // decide up-front whether to even show the name step (App Store Guideline 4 —
  // when Sign in with Apple already gives us the name we must not re-collect it).
  const [seed] = useState(() => {
    const md = (user?.user_metadata ?? {}) as Record<string, unknown>;
    const metaName = (
      (md.full_name as string) || (md.name as string) ||
      [md.given_name, md.family_name].filter(Boolean).join(' ')
    ).trim();
    const email = user?.email ?? '';
    const isPrivateRelay = /@privaterelay\.appleid\.com$/i.test(email); // Apple "Hide My Email"
    const emailPrefix = isPrivateRelay ? '' : (email.split('@')[0] ?? '');
    const name = metaName || emailPrefix;
    return {
      name,
      username: name.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20),
      nameFromProvider: !!metaName, // a real name came from Apple/Google
    };
  });

  // Whether this account was created via an OAuth provider (no email/password
  // "create account" step happened) — used only for the step numbering.
  const provider = (user?.app_metadata?.provider as string) || 'email';
  const offset = provider === 'email' ? 1 : 0;

  // Skip the name question entirely when the provider already gave us a name.
  const steps: StepKey[] = seed.nameFromProvider
    ? ['handle', 'city', 'type', 'visibility']
    : ['name', 'handle', 'city', 'type', 'visibility'];
  const total = offset + steps.length;

  const [screen, setScreen] = useState<'wizard' | 'done'>('wizard');
  const [pStep, setPStep] = useState(0);
  const [displayName, setDisplayName] = useState(seed.name);
  const [username, setUsername] = useState(seed.username);
  const [homeCity, setHomeCity] = useState('');
  const [homeGeo, setHomeGeo] = useState<HomeLocation | null>(null);
  const [accountType, setAccountType] = useState<AccountType>('lover');
  const [isPublic, setIsPublic] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const stepKey = steps[pStep];
  const isLast = pStep === steps.length - 1;
  const handle = '@' + (username.toLowerCase() || 'username');
  const usernameValid = username.trim().length >= 3 && /^[a-zA-Z0-9_]+$/.test(username);

  const finish = useCallback(async () => {
    if (!user?.id) return;
    setSubmitting(true);
    setError('');
    const cityTrim = homeCity.trim();
    // Prefer the picked suggestion's coordinates; otherwise geocode the text.
    const geo = homeGeo ?? (cityTrim ? await geocodePlace(cityTrim) : null);
    const homeBase = cityTrim
      ? { homeCity: geo?.label || cityTrim, homeLat: geo?.lat ?? null, homeLng: geo?.lng ?? null }
      : undefined;
    const result = await saveProfile(
      user.id,
      displayName.trim() || username.trim(),
      username.trim(),
      '',
      isPublic,
      accountType === 'expert',
      homeBase,
    );
    setSubmitting(false);
    if (result.success) setScreen('done');
    else setError(result.error || 'Something went wrong');
  }, [user, displayName, username, homeCity, homeGeo, isPublic, accountType]);

  const next = useCallback(() => {
    setError('');
    if (stepKey === 'handle') {
      if (!username.trim()) { setError('Please choose a username'); return; }
      if (!usernameValid) { setError('Username must be 3+ letters, numbers, or underscores'); return; }
    }
    if (isLast) { void finish(); return; }
    setPStep((p) => p + 1);
  }, [stepKey, username, usernameValid, isLast, finish]);

  const back = useCallback(() => {
    setError('');
    if (pStep <= 0) { void signOut(); return; } // step 0 back = abandon setup
    setPStep((p) => p - 1);
  }, [pStep, signOut]);

  const skipCity = useCallback(() => {
    setHomeCity(''); setHomeGeo(null); setError('');
    setPStep((p) => p + 1);
  }, []);

  const startExploring = useCallback(() => { void refreshProfile(); }, [refreshProfile]);

  /* ── Done ────────────────────────────────────────────────────────────── */
  if (screen === 'done') {
    return (
      <OnboardingScreen glow="center">
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-1 flex-col items-center text-center" style={{ paddingTop: 40 }}
        >
          <div className="flex items-center justify-center" style={{ width: 88, height: 88, borderRadius: '50%', background: TERRA, boxShadow: '0 14px 34px rgba(166,55,29,0.32)' }}>
            <svg width="42" height="42" viewBox="0 0 44 44" fill="none"><path d="M11 23l7 7 15-16" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div style={{ marginTop: 26 }}><Title>You're all set</Title></div>
          <p style={{ fontSize: 15.5, lineHeight: 1.55, color: SECONDARY, margin: '12px 0 0', maxWidth: 280 }}>
            Welcome aboard, <span style={{ color: TERRA, fontWeight: 600 }}>{handle}</span>. Your canvas is ready — let's find something worth the trip.
          </p>
          <div style={{ marginTop: 'auto', paddingTop: 34, width: '100%' }}>
            <PrimaryButton onClick={startExploring}>Start exploring</PrimaryButton>
          </div>
        </motion.div>
      </OnboardingScreen>
    );
  }

  /* ── Wizard ──────────────────────────────────────────────────────────── */
  return (
    <OnboardingScreen>
      <ProgressHeader step={offset + pStep + 1} total={total} onBack={back} />

      <div className="flex flex-1 flex-col">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={stepKey}
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-1 flex-col"
          >
            {stepKey === 'name' && (
              <div className="flex flex-1 flex-col">
                <div style={{ marginTop: 46 }}>
                  <Eyebrow>About you</Eyebrow>
                  <div style={{ marginTop: 13 }}><Title size={33}>What should we call you?</Title></div>
                  <Subtitle>This is the name friends will see on your profile.</Subtitle>
                </div>
                <div style={{ marginTop: 32 }}>
                  <FieldLabel>Your name</FieldLabel>
                  <Field value={displayName} onChange={setDisplayName} placeholder="Jane Doe" icon={<User size={17} strokeWidth={1.6} />} autoFocus autoComplete="name" autoCapitalize="words" onSubmit={next} />
                </div>
              </div>
            )}

            {stepKey === 'handle' && (
              <div className="flex flex-1 flex-col">
                <div style={{ marginTop: 46 }}>
                  <Eyebrow>Your handle</Eyebrow>
                  <div style={{ marginTop: 13 }}><Title size={33}>Claim your @</Title></div>
                  <Subtitle>Your one-of-a-kind handle on Gourmet Canvas.</Subtitle>
                </div>
                <div style={{ marginTop: 32 }}>
                  <FieldLabel>Username</FieldLabel>
                  <Field value={username} onChange={(v) => { setUsername(v.replace(/\s/g, '').replace(/[^a-zA-Z0-9_]/g, '')); setError(''); }} placeholder="username" prefix="@" autoFocus autoComplete="username" autoCapitalize="off" onSubmit={next} />
                  <div className="flex items-center justify-between" style={{ marginTop: 11 }}>
                    <div style={{ fontSize: 13.5, color: '#9A8F89' }}>Your handle: <span style={{ color: TERRA, fontWeight: 600 }}>{handle}</span></div>
                    {usernameValid && (
                      <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12.5, color: '#1B8A5E', fontWeight: 600 }}>
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="#1FA06D" /><path d="M5 8.2l2 2 4-4.4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        Available
                      </span>
                    )}
                  </div>
                  {error && <ErrorRow>{error}</ErrorRow>}
                </div>
              </div>
            )}

            {stepKey === 'city' && (
              <div className="flex flex-1 flex-col">
                <div style={{ marginTop: 46 }}>
                  <Eyebrow>Location</Eyebrow>
                  <div style={{ marginTop: 13 }}><Title size={33}>Where do you eat?</Title></div>
                  <Subtitle>We'll surface the tables nearest you. Change it anytime.</Subtitle>
                </div>
                <div style={{ marginTop: 32 }}>
                  <FieldLabel>Home city</FieldLabel>
                  <CityAutocomplete
                    value={homeCity}
                    onChange={(v) => { setHomeCity(v); setHomeGeo(null); }}
                    onPick={(loc) => { setHomeGeo(loc); }}
                    onSubmit={next}
                  />
                </div>
              </div>
            )}

            {stepKey === 'type' && (
              <div className="flex flex-1 flex-col">
                <div style={{ marginTop: 46 }}>
                  <Eyebrow>Account</Eyebrow>
                  <div style={{ marginTop: 13 }}><Title size={33}>How do you want to show up?</Title></div>
                  <Subtitle>You can switch this whenever you like.</Subtitle>
                </div>
                <div className="flex flex-col gap-3" style={{ marginTop: 28 }}>
                  <RadioCard selected={accountType === 'lover'} onClick={() => setAccountType('lover')} title="Food lover" description="Save spots, rate where you eat, and follow friends." />
                  <RadioCard
                    selected={accountType === 'expert'} onClick={() => setAccountType('expert')}
                    title={<span className="inline-flex items-center gap-2">Expert reviewer<span style={{ fontSize: 9.5, letterSpacing: '0.6px', fontWeight: 700, color: TERRA, background: '#F4E3DC', padding: '2px 7px', borderRadius: 5 }}>VERIFIED</span></span>}
                    description="Apply to publish expert picks — we'll verify you first."
                  />
                </div>
              </div>
            )}

            {stepKey === 'visibility' && (
              <div className="flex flex-1 flex-col">
                <div style={{ marginTop: 46 }}>
                  <Eyebrow>Visibility</Eyebrow>
                  <div style={{ marginTop: 13 }}><Title size={33}>Public or private?</Title></div>
                  <Subtitle>You're always in control of who sees your activity.</Subtitle>
                </div>
                <div className="flex flex-col gap-3" style={{ marginTop: 28 }}>
                  <RadioCard selected={isPublic} onClick={() => setIsPublic(true)} title="Public" description="Anyone can follow you and see your reviews." />
                  <RadioCard selected={!isPublic} onClick={() => setIsPublic(false)} title="Private" description="Only people you approve can see your activity." />
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div style={{ paddingTop: 26 }}>
          {error && stepKey !== 'handle' && <div style={{ marginBottom: 12 }}><ErrorRow>{error}</ErrorRow></div>}
          <PrimaryButton onClick={next} loading={submitting} trailing={isLast ? 'check' : 'arrow'}>
            {isLast ? 'Finish setup' : 'Continue'}
          </PrimaryButton>
          {stepKey === 'city' && (
            <div style={{ marginTop: 4 }}>
              <GhostButton onClick={skipCity}>Skip for now</GhostButton>
            </div>
          )}
        </div>
      </div>
    </OnboardingScreen>
  );
};
