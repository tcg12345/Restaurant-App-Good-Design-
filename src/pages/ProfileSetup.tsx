import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User, MapPin } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { saveProfile } from '../lib/supabase-community';
import { geocodePlace } from '../components/HomeLocationBar';
import {
  OnboardingScreen, Title, Subtitle, Eyebrow, FieldLabel, Field, PrimaryButton,
  GhostButton, ProgressHeader, RadioCard, ErrorRow, TERRA, SECONDARY,
} from '../components/onboarding/OnboardingKit';

type AccountType = 'lover' | 'expert';

export const ProfileSetup: React.FC = () => {
  const { user, refreshProfile, signOut } = useAuth();

  const [screen, setScreen] = useState<'wizard' | 'done'>('wizard');
  const [pStep, setPStep] = useState(0); // 0 name · 1 handle · 2 city · 3 type · 4 visibility
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [homeCity, setHomeCity] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('lover');
  const [isPublic, setIsPublic] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill the name from whatever the identity provider already gave us so we
  // never force the user to type it (App Store Guideline 4 — Sign in with Apple
  // provides name/email and we must not re-collect them). Falls back to the
  // email local-part, skipping Apple's private-relay address. Seeded once, only
  // while the fields are untouched so we never clobber edits.
  useEffect(() => {
    if (!user || displayName) return;
    const md = (user.user_metadata ?? {}) as Record<string, unknown>;
    const metaName = (
      (md.full_name as string) || (md.name as string) ||
      [md.given_name, md.family_name].filter(Boolean).join(' ')
    ).trim();
    const email = user.email ?? '';
    const isPrivateRelay = /@privaterelay\.appleid\.com$/i.test(email);
    const emailPrefix = isPrivateRelay ? '' : (email.split('@')[0] ?? '');
    const seed = metaName || emailPrefix;
    if (seed) {
      setDisplayName(seed);
      setUsername((prev) => prev || seed.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20));
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const handle = '@' + (username.toLowerCase() || 'username');
  const usernameValid = username.trim().length >= 3 && /^[a-zA-Z0-9_]+$/.test(username);

  // Persist the profile, then surface the "all set" screen. The handoff into the
  // app happens when the user taps Start exploring → refreshProfile().
  const finish = useCallback(async () => {
    if (!user?.id) return;
    setSubmitting(true);
    setError('');
    const cityTrim = homeCity.trim();
    const geo = cityTrim ? await geocodePlace(cityTrim) : null;
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
  }, [user, displayName, username, homeCity, isPublic, accountType]);

  const next = useCallback(() => {
    setError('');
    if (pStep === 1) {
      if (!username.trim()) { setError('Please choose a username'); return; }
      if (!usernameValid) { setError('Username must be 3+ letters, numbers, or underscores'); return; }
    }
    if (pStep >= 4) { void finish(); return; }
    setPStep((p) => p + 1);
  }, [pStep, username, usernameValid, finish]);

  // Step 0 "back" abandons setup (signs out); otherwise step back.
  const back = useCallback(() => {
    setError('');
    if (pStep <= 0) { void signOut(); return; }
    setPStep((p) => p - 1);
  }, [pStep, signOut]);

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
  const stepNum = 2 + pStep; // create-account was step 1
  const isLast = pStep >= 4;

  return (
    <OnboardingScreen>
      <ProgressHeader step={stepNum} total={6} onBack={back} />

      <div className="flex flex-1 flex-col">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pStep}
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-1 flex-col"
          >
            {pStep === 0 && (
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

            {pStep === 1 && (
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

            {pStep === 2 && (
              <div className="flex flex-1 flex-col">
                <div style={{ marginTop: 46 }}>
                  <Eyebrow>Location</Eyebrow>
                  <div style={{ marginTop: 13 }}><Title size={33}>Where do you eat?</Title></div>
                  <Subtitle>We'll surface the tables nearest you. Change it anytime.</Subtitle>
                </div>
                <div style={{ marginTop: 32 }}>
                  <FieldLabel>Home city</FieldLabel>
                  <Field value={homeCity} onChange={setHomeCity} placeholder="e.g. New York" icon={<MapPin size={16} strokeWidth={1.6} />} autoFocus autoCapitalize="words" onSubmit={next} />
                </div>
              </div>
            )}

            {pStep === 3 && (
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

            {pStep === 4 && (
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

        {/* Bottom action (outside the per-step animation so it stays put) */}
        <div style={{ paddingTop: 26 }}>
          {error && pStep !== 1 && <div style={{ marginBottom: 12 }}><ErrorRow>{error}</ErrorRow></div>}
          <PrimaryButton onClick={next} loading={submitting} trailing={isLast ? 'check' : 'arrow'}>
            {isLast ? 'Finish setup' : 'Continue'}
          </PrimaryButton>
          {pStep === 2 && (
            <div style={{ marginTop: 4 }}>
              <GhostButton onClick={() => setPStep(3)}>Skip for now</GhostButton>
            </div>
          )}
        </div>
      </div>
    </OnboardingScreen>
  );
};
