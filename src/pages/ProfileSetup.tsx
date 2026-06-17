import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { User, AtSign, MapPin, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { saveProfile } from '../lib/supabase-community';
import { geocodePlace } from '../components/HomeLocationBar';
import { AuthShell, useDesktopAuthLayout } from '../components/AuthShell';
import {
  MobileAuthShell,
  MobileBackButton,
  MobileBrandMark,
  MobileField,
  MobilePrimaryButton,
} from '../components/AuthMobileShell';

export const ProfileSetup: React.FC = () => {
  const { user, refreshProfile, signOut } = useAuth();
  const useDesktopLayout = useDesktopAuthLayout();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [homeCity, setHomeCity] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [isExpert, setIsExpert] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill the name from whatever the identity provider already gave us so
  // we never ask the user to type it (App Store Guideline 4 — Sign in with
  // Apple provides name/email via Authentication Services and we must not
  // re-collect them). Sign in with Apple writes `full_name` to user metadata
  // on first auth (see native-apple.ts); Google populates `full_name`/`name`.
  // Falls back to the email local-part, skipping Apple's private-relay
  // address (which is just an opaque token, not a real name). Seeded once,
  // and only while the field is still untouched so we never clobber edits.
  useEffect(() => {
    if (!user || displayName) return;
    const md = (user.user_metadata ?? {}) as Record<string, unknown>;
    const metaName = (
      (md.full_name as string) ||
      (md.name as string) ||
      [md.given_name, md.family_name].filter(Boolean).join(' ')
    ).trim();
    const email = user.email ?? '';
    const isPrivateRelay = /@privaterelay\.appleid\.com$/i.test(email);
    const emailPrefix = isPrivateRelay ? '' : (email.split('@')[0] ?? '');
    const seed = metaName || emailPrefix;
    if (seed) {
      setDisplayName(seed);
      // Suggest a username from the same seed when the user hasn't typed one.
      setUsername((prev) => prev || seed.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20));
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');

    // Name is intentionally NOT required: Sign in with Apple already provides
    // it, so re-collecting it would violate Guideline 4. If the field is
    // somehow empty, fall back to the username so `display_name` is never
    // blank (keeps `profileComplete` satisfiable) — the user is never blocked
    // on typing a name.
    if (!username.trim()) { setError('Please choose a username'); return; }
    if (username.length < 3) { setError('Username must be at least 3 characters'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) { setError('Username can only contain letters, numbers, and underscores'); return; }
    // Experts get nudged to declare their home base so /location can
    // surface them to people exploring the area. Non-experts can leave it.
    if (isExpert && !homeCity.trim()) {
      setError('Please add the city you cover — it helps people find your recommendations');
      return;
    }

    if (!user?.id) return;
    setSubmitting(true);

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
      isExpert,
      homeBase,
    );
    if (result.success) {
      await refreshProfile();
    } else {
      setError(result.error || 'Something went wrong');
    }
    setSubmitting(false);
  };

  // Sign out and return to the email-entry step. Profile setup is the
  // only post-auth surface the user can't otherwise leave, so "back"
  // here means abandon setup and reset the flow.
  const handleBack = () => { void signOut(); };

  // ── Desktop split layout ──────────────────────────────────────────────
  if (useDesktopLayout) {
    const headerRight = (
      <button
        type="button"
        onClick={handleBack}
        className="inline-flex items-center gap-1.5 text-on-surface/55 hover:text-on-surface transition-colors cursor-pointer"
      >
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

  // ── Mobile / phone-frame layout — matches the new mobile auth design ─
  return (
    <MobileAuthShell>
      {/* Top bar with sign-out back button, safe-area aware */}
      <div
        className="relative z-10 px-5 flex items-center justify-between"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))', paddingBottom: '0.5rem', minHeight: 56 }}
      >
        <MobileBackButton onClick={handleBack} label="Sign out" />
        <div className="min-w-[44px]" />
      </div>

      {/* Form content */}
      <div className="relative z-10 flex-1 min-h-0 flex flex-col overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="flex-1 flex flex-col px-5 pt-2 pb-4"
        >
          <div className="flex flex-col items-start gap-4 mb-6">
            <MobileBrandMark size={48} />
            <div>
              <h1 className="font-display font-bold text-[28px] tracking-tight leading-[1.05] text-on-surface">
                Set up your profile
              </h1>
              <p className="text-on-surface/55 text-[14px] leading-relaxed mt-2">
                A name, a handle, and where you eat from — that's it.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <MobileField
              label="Your name"
              icon={<User size={16} />}
              type="text"
              value={displayName}
              onChange={setDisplayName}
              placeholder="e.g. Tyler"
              autoComplete="name"
            />
            <MobileField
              label="Username"
              icon={<AtSign size={16} />}
              type="text"
              value={username}
              onChange={(v) => setUsername(v.replace(/[^a-zA-Z0-9_]/g, ''))}
              placeholder="tyler_eats"
              autoComplete="username"
            />
            {username && (
              <p className="text-[11px] text-on-surface/45 px-1 -mt-1">
                Your handle: <span className="font-semibold text-primary">@{username.toLowerCase()}</span>
              </p>
            )}
            <MobileField
              label="Home city"
              icon={<MapPin size={16} />}
              type="text"
              value={homeCity}
              onChange={setHomeCity}
              placeholder={isExpert ? 'Required for experts' : 'Optional'}
              autoComplete="address-level2"
            />

            {/* Toggles styled to sit on the mesh background */}
            <button
              type="button"
              onClick={() => setIsPublic(!isPublic)}
              aria-pressed={isPublic}
              className="flex items-center justify-between rounded-2xl bg-white/65 backdrop-blur-md border border-on-surface/8 px-4 py-3 text-left"
            >
              <div className="min-w-0 pr-3">
                <p className="text-[13px] font-semibold text-on-surface">
                  {isPublic ? 'Public account' : 'Private account'}
                </p>
                <p className="text-[11px] text-on-surface/55 mt-0.5 leading-snug">
                  {isPublic ? 'Anyone can see your profile and follow you' : 'Only approved followers can see your profile'}
                </p>
              </div>
              <span
                className={`relative h-7 w-12 rounded-full flex-shrink-0 transition-colors ${isPublic ? 'bg-primary' : 'bg-on-surface/15'}`}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-md transition-all ${isPublic ? 'left-[22px]' : 'left-0.5'}`}
                />
              </span>
            </button>

            <button
              type="button"
              onClick={() => setIsExpert(!isExpert)}
              aria-pressed={isExpert}
              className="flex items-center justify-between rounded-2xl bg-white/65 backdrop-blur-md border border-on-surface/8 px-4 py-3 text-left"
            >
              <div className="min-w-0 pr-3">
                <p className="text-[13px] font-semibold text-on-surface">
                  {isExpert ? 'Expert account' : 'Regular account'}
                </p>
                <p className="text-[11px] text-on-surface/55 mt-0.5 leading-snug">
                  {isExpert ? 'Your ratings appear as expert recommendations' : 'Sign up as an expert reviewer'}
                </p>
              </div>
              <span
                className={`relative h-7 w-12 rounded-full flex-shrink-0 transition-colors ${isExpert ? 'bg-primary' : 'bg-on-surface/15'}`}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-md transition-all ${isExpert ? 'left-[22px]' : 'left-0.5'}`}
                />
              </span>
            </button>

            {error && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-xl"
              >
                {error}
              </motion.p>
            )}
          </form>
        </motion.div>
      </div>

      {/* Sticky CTA above home indicator */}
      <div
        className="relative z-10 px-5 pt-3"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <MobilePrimaryButton type="button" loading={submitting} onClick={() => handleSubmit()}>
          <span>Continue</span>
          <ArrowRight size={18} />
        </MobilePrimaryButton>
      </div>
    </MobileAuthShell>
  );
};
