import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User, AtSign, MapPin, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { saveProfile } from '../lib/supabase-community';
import { geocodePlace, searchLocations, type HomeLocation } from '../components/HomeLocationBar';
import { AuthShell, useDesktopAuthLayout } from '../components/AuthShell';
// Mobile uses the new cream/terracotta onboarding wizard; desktop keeps the
// original single-form AuthShell design.
import * as OB from '../components/onboarding/OnboardingKit';

type StepKey = 'name' | 'handle' | 'city' | 'type' | 'visibility';

/* ── City autocomplete (mobile wizard) — Mapbox suggestions ─────────────── */
const CityAutocomplete: React.FC<{
  value: string;
  onChange: (v: string) => void;
  onPick: (loc: HomeLocation) => void;
  onSubmit?: () => void;
}> = ({ value, onChange, onPick, onSubmit }) => {
  const [suggestions, setSuggestions] = useState<HomeLocation[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNext = useRef(false);

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
      <OB.Field
        value={value} onChange={onChange} placeholder="e.g. New York"
        icon={<MapPin size={16} strokeWidth={1.6} />} autoFocus autoCapitalize="words"
        onSubmit={onSubmit}
        onFocus={() => { if (suggestions.length) setOpen(true); }}
        onBlur={() => { setTimeout(() => setOpen(false), 150); }}
      />
      {open && suggestions.length > 0 && (
        <div
          className="absolute left-0 right-0 z-20 overflow-hidden"
          style={{ top: 'calc(100% + 8px)', borderRadius: 15, background: 'var(--ob-card)', border: `1.5px solid ${OB.BORDER}`, boxShadow: '0 16px 40px rgba(40,24,14,0.14)' }}
        >
          {suggestions.map((s, i) => (
            <button
              key={`${s.label}-${i}`}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              className="w-full flex items-center gap-2.5 text-left cursor-pointer border-none transition-colors"
              style={{ padding: '12px 16px', background: 'var(--ob-card)', borderTop: i === 0 ? 'none' : '1px solid var(--ob-divider)' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--ob-card-hover)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--ob-card)')}
            >
              <MapPin size={15} strokeWidth={1.6} style={{ color: OB.LABEL_GREY, flexShrink: 0 }} />
              <span className="truncate" style={{ fontSize: 14.5, color: 'var(--ob-ink-soft)' }}>{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const ProfileSetup: React.FC = () => {
  const { user, refreshProfile, signOut } = useAuth();
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

  const [displayName, setDisplayName] = useState(seed.name);
  const [username, setUsername] = useState(seed.username);
  const [homeCity, setHomeCity] = useState('');
  const [homeGeo, setHomeGeo] = useState<HomeLocation | null>(null);
  const [isPublic, setIsPublic] = useState(true);
  const [isExpert, setIsExpert] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Mobile wizard state (unused by desktop, but hooks must be unconditional).
  const [pStep, setPStep] = useState(0);
  const [screen, setScreen] = useState<'wizard' | 'done'>('wizard');

  const handle = '@' + (username.toLowerCase() || 'username');
  const usernameValid = username.trim().length >= 3 && /^[a-zA-Z0-9_]+$/.test(username);

  // Shared persistence (geocode the city, write the profile).
  const persistProfile = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!user?.id) return { ok: false };
    const cityTrim = homeCity.trim();
    const geo = homeGeo ?? (cityTrim ? await geocodePlace(cityTrim) : null);
    const homeBase = cityTrim
      ? { homeCity: geo?.label || cityTrim, homeLat: geo?.lat ?? null, homeLng: geo?.lng ?? null }
      : undefined;
    const result = await saveProfile(user.id, displayName.trim() || username.trim(), username.trim(), '', isPublic, homeBase);
    return { ok: result.success, error: result.error };
  }, [user, homeCity, homeGeo, displayName, username, isPublic, isExpert]);

  /* ── Desktop split layout (original single form) ─────────────────────── */
  if (useDesktopLayout) {
    const handleSubmit = async (e?: React.FormEvent) => {
      e?.preventDefault();
      setError('');
      if (!username.trim()) { setError('Please choose a username'); return; }
      if (username.length < 3) { setError('Username must be at least 3 characters'); return; }
      if (!/^[a-zA-Z0-9_]+$/.test(username)) { setError('Username can only contain letters, numbers, and underscores'); return; }
      if (isExpert && !homeCity.trim()) {
        setError('Please add the city you cover — it helps people find your recommendations');
        return;
      }
      setSubmitting(true);
      const res = await persistProfile();
      if (res.ok) await refreshProfile();
      else setError(res.error || 'Something went wrong');
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
          <form onSubmit={handleSubmit} className="w-full flex flex-col gap-2.5">
            <div className="relative">
              <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/30" />
              <input type="text" placeholder="Your name (e.g. Tyler)" value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full pl-11 pr-4 py-3 rounded-2xl bg-white/70 backdrop-blur-sm border border-black/5 text-on-surface placeholder:text-on-surface/30 focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm" />
            </div>
            <div className="relative">
              <AtSign size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/30" />
              <input type="text" placeholder="Username (e.g. tyler_eats)" value={username}
                onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                className="w-full pl-11 pr-4 py-3 rounded-2xl bg-white/70 backdrop-blur-sm border border-black/5 text-on-surface placeholder:text-on-surface/30 focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm"
                autoCapitalize="off" autoCorrect="off" />
            </div>
            {username && (
              <p className="text-xs text-on-surface/40 px-1">Your username will be: <span className="font-semibold text-primary">@{username.toLowerCase()}</span></p>
            )}
            <div className="relative">
              <MapPin size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/30" />
              <input type="text" placeholder={isExpert ? 'Home city (required for experts)' : 'Home city (optional)'}
                value={homeCity}
                onChange={(e) => setHomeCity(e.target.value)}
                autoCapitalize="words" autoCorrect="off"
                className="w-full pl-11 pr-4 py-3 rounded-2xl bg-white/70 backdrop-blur-sm border border-black/5 text-on-surface placeholder:text-on-surface/30 focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm" />
            </div>
            <div className="flex items-center justify-between bg-white/70 backdrop-blur-sm border border-black/5 rounded-2xl px-4 py-2.5">
              <div>
                <p className="text-sm font-medium text-on-surface">{isPublic ? 'Public Account' : 'Private Account'}</p>
                <p className="text-[11px] text-on-surface/40">{isPublic ? 'Anyone can see your profile and follow you' : 'Only approved followers can see your profile'}</p>
              </div>
              <button type="button" onClick={() => setIsPublic(!isPublic)}
                aria-label={isPublic ? 'Make profile private' : 'Make profile public'}
                className={`w-11 h-7 rounded-full relative transition-colors duration-200 flex-shrink-0 ${isPublic ? 'bg-primary' : 'bg-on-surface/15'}`}>
                <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-all ${isPublic ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
            </div>
            <div className="flex items-center justify-between bg-white/70 backdrop-blur-sm border border-black/5 rounded-2xl px-4 py-2.5">
              <div>
                <p className="text-sm font-medium text-on-surface">{isExpert ? 'Expert Account' : 'Regular Account'}</p>
                <p className="text-[11px] text-on-surface/40">{isExpert ? 'Your ratings appear as expert recommendations' : 'Sign up as an expert reviewer'}</p>
              </div>
              <button type="button" onClick={() => setIsExpert(!isExpert)}
                aria-label={isExpert ? 'Switch to regular account' : 'Switch to expert account'}
                className={`w-11 h-7 rounded-full relative transition-colors duration-200 flex-shrink-0 ${isExpert ? 'bg-primary' : 'bg-on-surface/15'}`}>
                <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-all ${isExpert ? 'left-[18px]' : 'left-0.5'}`} />
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
          </form>
        </div>
      </AuthShell>
    );
  }

  /* ── Mobile cream/terracotta wizard ──────────────────────────────────── */
  const steps: StepKey[] = seed.nameFromProvider
    ? ['handle', 'city', 'type', 'visibility']
    : ['name', 'handle', 'city', 'type', 'visibility'];
  const provider = (user?.app_metadata?.provider as string) || 'email';
  const offset = provider === 'email' ? 1 : 0; // create-account was "step 1" for email signups
  const total = offset + steps.length;
  const stepKey = steps[pStep];
  const isLast = pStep === steps.length - 1;

  const finish = async () => {
    setSubmitting(true);
    setError('');
    const res = await persistProfile();
    setSubmitting(false);
    if (res.ok) setScreen('done');
    else setError(res.error || 'Something went wrong');
  };

  const next = () => {
    setError('');
    if (stepKey === 'handle') {
      if (!username.trim()) { setError('Please choose a username'); return; }
      if (!usernameValid) { setError('Username must be 3+ letters, numbers, or underscores'); return; }
    }
    if (isLast) { void finish(); return; }
    setPStep((p) => p + 1);
  };

  const back = () => {
    setError('');
    if (pStep <= 0) { void signOut(); return; }
    setPStep((p) => p - 1);
  };

  if (screen === 'done') {
    return (
      <OB.OnboardingScreen glow="center">
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-1 flex-col items-center text-center" style={{ paddingTop: 40 }}
        >
          <div className="flex items-center justify-center" style={{ width: 88, height: 88, borderRadius: '50%', background: OB.TERRA, boxShadow: '0 14px 34px rgba(166,55,29,0.32)' }}>
            <svg width="42" height="42" viewBox="0 0 44 44" fill="none"><path d="M11 23l7 7 15-16" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div style={{ marginTop: 26 }}><OB.Title>You're all set</OB.Title></div>
          <p style={{ fontSize: 15.5, lineHeight: 1.55, color: OB.SECONDARY, margin: '12px 0 0', maxWidth: 280 }}>
            Welcome aboard, <span style={{ color: OB.TERRA, fontWeight: 600 }}>{handle}</span>. Your canvas is ready — let's find something worth the trip.
          </p>
          <div style={{ marginTop: 'auto', paddingTop: 34, width: '100%' }}>
            <OB.PrimaryButton onClick={() => { void refreshProfile(); }}>Start exploring</OB.PrimaryButton>
          </div>
        </motion.div>
      </OB.OnboardingScreen>
    );
  }

  return (
    <OB.OnboardingScreen>
      <OB.ProgressHeader step={offset + pStep + 1} total={total} onBack={back} />
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
                  <OB.Eyebrow>About you</OB.Eyebrow>
                  <div style={{ marginTop: 13 }}><OB.Title size={33}>What should we call you?</OB.Title></div>
                  <OB.Subtitle>This is the name friends will see on your profile.</OB.Subtitle>
                </div>
                <div style={{ marginTop: 32 }}>
                  <OB.FieldLabel>Your name</OB.FieldLabel>
                  <OB.Field value={displayName} onChange={setDisplayName} placeholder="Jane Doe" icon={<User size={17} strokeWidth={1.6} />} autoFocus autoComplete="name" autoCapitalize="words" onSubmit={next} />
                </div>
              </div>
            )}

            {stepKey === 'handle' && (
              <div className="flex flex-1 flex-col">
                <div style={{ marginTop: 46 }}>
                  <OB.Eyebrow>Your handle</OB.Eyebrow>
                  <div style={{ marginTop: 13 }}><OB.Title size={33}>Claim your @</OB.Title></div>
                  <OB.Subtitle>Your one-of-a-kind handle on Gourmet Canvas.</OB.Subtitle>
                </div>
                <div style={{ marginTop: 32 }}>
                  <OB.FieldLabel>Username</OB.FieldLabel>
                  <OB.Field value={username} onChange={(v) => { setUsername(v.replace(/\s/g, '').replace(/[^a-zA-Z0-9_]/g, '')); setError(''); }} placeholder="username" prefix="@" autoFocus autoComplete="username" autoCapitalize="off" onSubmit={next} />
                  <div className="flex items-center justify-between" style={{ marginTop: 11 }}>
                    <div style={{ fontSize: 13.5, color: 'var(--ob-label)' }}>Your handle: <span style={{ color: OB.TERRA, fontWeight: 600 }}>{handle}</span></div>
                    {usernameValid && (
                      <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12.5, color: 'var(--ob-success)', fontWeight: 600 }}>
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="var(--ob-success-dot)" /><path d="M5 8.2l2 2 4-4.4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        Available
                      </span>
                    )}
                  </div>
                  {error && <OB.ErrorRow>{error}</OB.ErrorRow>}
                </div>
              </div>
            )}

            {stepKey === 'city' && (
              <div className="flex flex-1 flex-col">
                <div style={{ marginTop: 46 }}>
                  <OB.Eyebrow>Location</OB.Eyebrow>
                  <div style={{ marginTop: 13 }}><OB.Title size={33}>Where do you eat?</OB.Title></div>
                  <OB.Subtitle>We'll surface the tables nearest you. Change it anytime.</OB.Subtitle>
                </div>
                <div style={{ marginTop: 32 }}>
                  <OB.FieldLabel>Home city</OB.FieldLabel>
                  <CityAutocomplete value={homeCity} onChange={(v) => { setHomeCity(v); setHomeGeo(null); }} onPick={setHomeGeo} onSubmit={next} />
                </div>
              </div>
            )}

            {stepKey === 'type' && (
              <div className="flex flex-1 flex-col">
                <div style={{ marginTop: 46 }}>
                  <OB.Eyebrow>Account</OB.Eyebrow>
                  <div style={{ marginTop: 13 }}><OB.Title size={33}>How do you want to show up?</OB.Title></div>
                  <OB.Subtitle>You can switch this whenever you like.</OB.Subtitle>
                </div>
                <div className="flex flex-col gap-3" style={{ marginTop: 28 }}>
                  <OB.RadioCard selected={!isExpert} onClick={() => setIsExpert(false)} title="Food lover" description="Save spots, rate where you eat, and follow friends." />
                  <OB.RadioCard
                    selected={isExpert} onClick={() => setIsExpert(true)}
                    title={<span className="inline-flex items-center gap-2">Expert reviewer<span style={{ fontSize: 9.5, letterSpacing: '0.6px', fontWeight: 700, color: OB.TERRA, background: 'var(--ob-badge-bg)', padding: '2px 7px', borderRadius: 5 }}>VERIFIED</span></span>}
                    description="Apply to publish expert picks — we'll verify you first."
                  />
                </div>
              </div>
            )}

            {stepKey === 'visibility' && (
              <div className="flex flex-1 flex-col">
                <div style={{ marginTop: 46 }}>
                  <OB.Eyebrow>Visibility</OB.Eyebrow>
                  <div style={{ marginTop: 13 }}><OB.Title size={33}>Public or private?</OB.Title></div>
                  <OB.Subtitle>You're always in control of who sees your activity.</OB.Subtitle>
                </div>
                <div className="flex flex-col gap-3" style={{ marginTop: 28 }}>
                  <OB.RadioCard selected={isPublic} onClick={() => setIsPublic(true)} title="Public" description="Anyone can follow you and see your reviews." />
                  <OB.RadioCard selected={!isPublic} onClick={() => setIsPublic(false)} title="Private" description="Only people you approve can see your activity." />
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div style={{ paddingTop: 26 }}>
          {error && stepKey !== 'handle' && <div style={{ marginBottom: 12 }}><OB.ErrorRow>{error}</OB.ErrorRow></div>}
          <OB.PrimaryButton onClick={next} loading={submitting} trailing={isLast ? 'check' : 'arrow'}>
            {isLast ? 'Finish setup' : 'Continue'}
          </OB.PrimaryButton>
          {stepKey === 'city' && (
            <div style={{ marginTop: 4 }}>
              <OB.GhostButton onClick={() => { setHomeCity(''); setHomeGeo(null); setError(''); setPStep((p) => p + 1); }}>Skip for now</OB.GhostButton>
            </div>
          )}
        </div>
      </div>
    </OB.OnboardingScreen>
  );
};
