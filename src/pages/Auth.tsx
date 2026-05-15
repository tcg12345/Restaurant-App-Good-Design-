import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Mail, Lock, Eye, EyeOff, Loader2, Smartphone } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { cn } from '../lib/utils';

type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: string; color: string };

// Lightweight password strength heuristic: length + character-class diversity.
// Score caps at 4 so the indicator bar fills in four discrete steps.
function getPasswordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: '', color: '' };
  let raw = 0;
  if (password.length >= 6) raw++;
  if (password.length >= 10) raw++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) raw++;
  if (/\d/.test(password)) raw++;
  if (/[^A-Za-z0-9]/.test(password)) raw++;
  const score = Math.min(raw, 4) as 0 | 1 | 2 | 3 | 4;
  const meta: Record<0 | 1 | 2 | 3 | 4, { label: string; color: string }> = {
    0: { label: '', color: '' },
    1: { label: 'Weak', color: 'bg-red-500' },
    2: { label: 'Fair', color: 'bg-orange-500' },
    3: { label: 'Good', color: 'bg-yellow-500' },
    4: { label: 'Strong', color: 'bg-green-500' },
  };
  return { score, ...meta[score] };
}

export const Auth: React.FC = () => {
  const { signIn, signUp } = useAuth();
  const { phoneMode, togglePhoneMode } = useSettings();
  const navigate = useNavigate();
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    if (isSignUpMode && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setSubmitting(true);

    if (isSignUpMode) {
      const { error: err } = await signUp(email, password);
      if (err) {
        setError(err);
      } else {
        setSuccess('Account created! Check your email to confirm, then sign in.');
        setIsSignUpMode(false);
        setPassword('');
        setConfirmPassword('');
      }
    } else {
      const { error: err } = await signIn(email, password);
      if (err) {
        setError(err);
      }
    }

    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <div className="relative flex-1 flex flex-col items-center justify-center px-6 py-12 overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-primary/5" />
          <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-secondary/5" />
          <div className="absolute top-1/3 right-1/4 w-48 h-48 rounded-full bg-accent/10" />
        </div>

        {/* Back button */}
        <motion.button
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
          onClick={() => navigate('/')}
          className="absolute top-[max(1.5rem,env(safe-area-inset-top))] left-6 z-20 flex items-center gap-2 text-on-surface/50 hover:text-on-surface transition-colors cursor-pointer"
        >
          <ArrowLeft size={20} />
          <span className="text-sm font-medium">Back</span>
        </motion.button>

        {/* Logo & title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="relative z-10 flex flex-col items-center text-center mb-8"
        >
          <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center text-white font-serif italic text-3xl shadow-lg shadow-primary/25 mb-5">
            G
          </div>
          <h1 className="text-3xl md:text-4xl font-serif font-bold tracking-tight text-on-surface mb-2">
            {isSignUpMode ? 'Create Account' : 'Welcome Back'}
          </h1>
          <p className="text-sm text-on-surface/50 max-w-sm font-light">
            {isSignUpMode
              ? 'Join Gourmet Canvas and start your culinary journey'
              : 'Sign in to continue your culinary journey'}
          </p>
        </motion.div>

        {/* Auth form */}
        <motion.form
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          onSubmit={handleSubmit}
          className="relative z-10 w-full max-w-sm flex flex-col gap-3"
        >
          {/* Email input */}
          <div className="relative">
            <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/30" />
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-white/70 backdrop-blur-sm border border-black/5 text-on-surface placeholder:text-on-surface/30 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all text-sm"
              autoComplete="email"
            />
          </div>

          {/* Password input */}
          <div className="relative">
            <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/30" />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-11 pr-11 py-3.5 rounded-2xl bg-white/70 backdrop-blur-sm border border-black/5 text-on-surface placeholder:text-on-surface/30 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all text-sm"
              autoComplete={isSignUpMode ? 'new-password' : 'current-password'}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface/30 hover:text-on-surface/50 transition-colors"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {/* Password strength indicator (sign up only) */}
          {isSignUpMode && password.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-3 px-2 -mt-1"
              aria-live="polite"
            >
              <div className="flex-1 h-1 rounded-full bg-on-surface/[0.06] overflow-hidden">
                <motion.div
                  initial={false}
                  animate={{ width: `${passwordStrength.score * 25}%` }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                  className={`h-full rounded-full ${passwordStrength.color}`}
                />
              </div>
              <span className="text-xs font-semibold text-on-surface/55 w-[44px] text-right flex-shrink-0">
                {passwordStrength.label}
              </span>
            </motion.div>
          )}

          {/* Confirm password (sign up only) */}
          {isSignUpMode && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="relative"
            >
              <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/30" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-white/70 backdrop-blur-sm border border-black/5 text-on-surface placeholder:text-on-surface/30 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all text-sm"
                autoComplete="new-password"
              />
            </motion.div>
          )}

          {/* Error message */}
          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-xl"
            >
              {error}
            </motion.p>
          )}

          {/* Success message */}
          {success && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-green-700 bg-green-50 px-4 py-2.5 rounded-xl"
            >
              {success}
            </motion.p>
          )}

          {/* Submit button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={submitting}
            className="group flex items-center justify-center gap-3 bg-primary text-white px-8 py-4 rounded-2xl text-lg font-semibold shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-shadow cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed mt-1"
          >
            {submitting ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <>
                {isSignUpMode ? 'Create Account' : 'Sign In'}
                <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </motion.button>

          {/* Toggle sign in / sign up */}
          <p className="text-center text-sm text-on-surface/40 mt-1">
            {isSignUpMode ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={() => {
                setIsSignUpMode(!isSignUpMode);
                setError('');
                setSuccess('');
              }}
              className="text-primary font-medium hover:underline cursor-pointer"
            >
              {isSignUpMode ? 'Sign In' : 'Sign Up'}
            </button>
          </p>

          {/* Phone-mode toggle — wraps the app in a portrait phone frame
              on desktop. Choice is persisted to localStorage so it
              survives the redirect after sign-in. */}
          <button
            type="button"
            onClick={togglePhoneMode}
            className={cn(
              'mt-2 mx-auto flex items-center gap-2.5 px-4 py-2.5 rounded-full text-xs font-semibold transition-colors border',
              phoneMode
                ? 'bg-on-surface/[0.05] border-on-surface/15 text-on-surface'
                : 'bg-transparent border-on-surface/10 text-on-surface/50 hover:text-on-surface/80 hover:border-on-surface/20',
            )}
            aria-pressed={phoneMode}
          >
            <Smartphone size={14} className={phoneMode ? 'text-primary' : 'text-on-surface/40'} />
            <span>Phone preview</span>
            {/* Compact pill-style toggle indicator */}
            <span
              className={cn(
                'relative inline-flex h-4 w-7 rounded-full transition-colors',
                phoneMode ? 'bg-primary' : 'bg-on-surface/15',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform',
                  phoneMode ? 'translate-x-3.5' : 'translate-x-0.5',
                )}
              />
            </span>
          </button>
        </motion.form>
      </div>
    </div>
  );
};
