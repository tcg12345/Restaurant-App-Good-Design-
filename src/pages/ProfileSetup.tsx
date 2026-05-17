import React, { useState } from 'react';
import { motion } from 'motion/react';
import { User, AtSign, MapPin, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { saveProfile } from '../lib/supabase-community';
import { geocodePlace } from '../components/HomeLocationBar';
import { AuthShell, GMark, useDesktopAuthLayout } from '../components/AuthShell';

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!displayName.trim()) { setError('Please enter your name'); return; }
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
      displayName.trim(),
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

  // Shared form body — used inside both the desktop AuthShell column
  // and the mobile fullscreen layout below.
  const formBody = (
    <form onSubmit={handleSubmit} className="w-full flex flex-col gap-3">
      <div className="relative">
        <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/30" />
        <input type="text" placeholder="Your name (e.g. Tyler)" value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-white/70 backdrop-blur-sm border border-black/5 text-on-surface placeholder:text-on-surface/30 focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm" />
      </div>

      <div className="relative">
        <AtSign size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/30" />
        <input type="text" placeholder="Username (e.g. tyler_eats)" value={username}
          onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
          className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-white/70 backdrop-blur-sm border border-black/5 text-on-surface placeholder:text-on-surface/30 focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm"
          autoCapitalize="off" autoCorrect="off" />
      </div>

      {username && (
        <p className="text-xs text-on-surface/40 px-1">Your username will be: <span className="font-semibold text-primary">@{username.toLowerCase()}</span></p>
      )}

      {/* Home city — surfaces the user on /location's "experts in this
          area" row when they're declared as experts. Required when the
          expert toggle below is on; optional otherwise. */}
      <div className="relative">
        <MapPin size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/30" />
        <input type="text" placeholder={isExpert ? 'Home city (required for experts)' : 'Home city (optional)'}
          value={homeCity}
          onChange={(e) => setHomeCity(e.target.value)}
          autoCapitalize="words" autoCorrect="off"
          className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-white/70 backdrop-blur-sm border border-black/5 text-on-surface placeholder:text-on-surface/30 focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm" />
      </div>

      {/* Public/Private toggle */}
      <div className="flex items-center justify-between bg-white/70 backdrop-blur-sm border border-black/5 rounded-2xl px-4 py-3">
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

      {/* Expert toggle */}
      <div className="flex items-center justify-between bg-white/70 backdrop-blur-sm border border-black/5 rounded-2xl px-4 py-3">
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
        className="group flex items-center justify-center gap-3 bg-primary text-white px-8 py-4 rounded-2xl text-lg font-semibold shadow-lg shadow-primary/25 mt-1 disabled:opacity-60">
        {submitting ? <Loader2 size={20} className="animate-spin" /> : (
          <>Continue <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" /></>
        )}
      </motion.button>
    </form>
  );

  // Sign out and return to the email-entry step. Profile setup is the
  // only post-auth surface the user can't otherwise leave, so "back"
  // here means abandon setup and reset the flow.
  const handleBack = () => { void signOut(); };

  // ── Desktop split layout ──────────────────────────────────────────────
  // Renders inside the same shell as the sign-in flow so the user
  // stays in the same form column they entered their password in.
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
      <AuthShell headerRight={headerRight}>
        <div className="space-y-6">
          <header>
            <h1 className="font-serif font-bold text-4xl xl:text-5xl tracking-tight leading-[1.05] text-on-surface mb-3">
              Set up your profile
            </h1>
            <p className="text-base text-on-surface/55 font-light leading-relaxed">
              Choose a display name and username so friends can find you.
            </p>
          </header>
          {formBody}
        </div>
      </AuthShell>
    );
  }

  // ── Mobile / phone-frame layout (unchanged style) ────────────────────
  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-6 py-12">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-primary/5" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-secondary/5" />
      </div>

      <button
        type="button"
        onClick={handleBack}
        className="absolute top-[max(1.5rem,env(safe-area-inset-top))] left-6 z-20 flex items-center gap-2 text-on-surface/50 hover:text-on-surface transition-colors cursor-pointer"
      >
        <ArrowLeft size={20} />
        <span className="text-sm font-medium">Sign out</span>
      </button>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="relative z-10 flex flex-col items-center text-center mb-8">
        <GMark size={56} className="mb-5" />
        <h1 className="text-3xl font-serif font-bold tracking-tight text-on-surface mb-2">Set Up Your Profile</h1>
        <p className="text-sm text-on-surface/50 max-w-sm">Choose a display name and username so friends can find you</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="relative z-10 w-full max-w-sm">
        {formBody}
      </motion.div>
    </div>
  );
};
