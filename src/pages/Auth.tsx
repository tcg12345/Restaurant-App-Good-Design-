import React, { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, Smartphone } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { cn } from '../lib/utils';
import { AuthShell, useDesktopAuthLayout } from '../components/AuthShell';
import {
  MobileAuthShell,
  MobileBackButton,
  MobileBrandMark,
  MobileEmailPill,
  MobileField,
  MobileGhostButton,
  MobilePrimaryButton,
} from '../components/AuthMobileShell';

type Step = 'email' | 'password' | 'signup';
type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: string; color: string };

// Lightweight password strength heuristic: length + character-class diversity.
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

// ── Social icons ────────────────────────────────────────────────────────
const AppleIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M11.2 8.4c0-1.7 1.4-2.5 1.4-2.5-.8-1.1-2-1.3-2.4-1.3-1-.1-2 .6-2.5.6s-1.3-.6-2.2-.6c-1.1 0-2.2.7-2.8 1.7C1.5 8.4 2.4 11.6 3.6 13.4c.6.9 1.3 1.9 2.2 1.8.9 0 1.2-.6 2.3-.6s1.4.6 2.3.6c.9 0 1.6-.9 2.2-1.8.7-1 .9-2 .9-2-.1 0-1.9-.7-1.9-2.8zM9.6 3.6c.5-.6.8-1.4.7-2.2-.7 0-1.5.5-2 1-.4.5-.8 1.3-.7 2.1.8.1 1.6-.4 2-.9z" />
  </svg>
);

const GoogleIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <path fill="#4285F4" d="M15.5 8.2c0-.5 0-1-.1-1.5H8v2.9h4.2c-.2 1-.7 1.8-1.6 2.4v2h2.6c1.5-1.4 2.3-3.5 2.3-5.8z" />
    <path fill="#34A853" d="M8 16c2.2 0 4-.7 5.3-1.9l-2.6-2c-.7.5-1.6.8-2.7.8-2.1 0-3.8-1.4-4.4-3.3H1v2.1A8 8 0 008 16z" />
    <path fill="#FBBC05" d="M3.6 9.6c-.2-.5-.3-1-.3-1.6s.1-1.1.3-1.6V4.3H1A8 8 0 000 8c0 1.3.3 2.5.9 3.7l2.7-2.1z" />
    <path fill="#EA4335" d="M8 3.2c1.2 0 2.3.4 3.1 1.2L13.4 2A8 8 0 001 4.3l2.6 2.1C4.2 4.6 5.9 3.2 8 3.2z" />
  </svg>
);

// ── Form atoms (shared between desktop and mobile layouts) ──────────────
const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface/45 mb-1.5">
    {children}
  </label>
);

const TextField: React.FC<{
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  trailing?: React.ReactNode;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  name?: string;
}> = ({ type = 'text', value, onChange, placeholder, autoComplete, autoFocus, trailing, inputMode, name }) => (
  <div className="relative">
    <input
      type={type}
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      inputMode={inputMode}
      className={cn(
        'w-full px-4 py-3 rounded-2xl bg-white/70 backdrop-blur-sm border border-on-surface/8 text-on-surface',
        'placeholder:text-on-surface/30 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all text-sm',
        trailing && 'pr-11',
      )}
    />
    {trailing && (
      <div className="absolute right-3 top-1/2 -translate-y-1/2">{trailing}</div>
    )}
  </div>
);

const PrimaryButton: React.FC<{
  children: React.ReactNode;
  type?: 'button' | 'submit';
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
}> = ({ children, type = 'submit', onClick, disabled, loading }) => (
  <motion.button
    type={type}
    onClick={onClick}
    disabled={disabled || loading}
    whileHover={!disabled && !loading ? { scale: 1.01 } : undefined}
    whileTap={!disabled && !loading ? { scale: 0.99 } : undefined}
    className="group w-full flex items-center justify-center gap-3 bg-primary text-white px-6 py-3 rounded-2xl text-base font-semibold shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-shadow cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
  >
    {loading ? (
      <Loader2 size={18} className="animate-spin" />
    ) : (
      <>
        <span>{children}</span>
        <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
      </>
    )}
  </motion.button>
);

const SocialRow: React.FC<{
  onOAuth: (provider: 'google' | 'apple') => void;
  pending: 'google' | 'apple' | null;
}> = ({ onOAuth, pending }) => (
  <div className="grid grid-cols-2 gap-3">
    <button
      type="button"
      onClick={() => onOAuth('apple')}
      disabled={pending !== null}
      className="flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-2xl bg-white/70 backdrop-blur-sm border border-on-surface/8 text-on-surface text-sm font-medium hover:bg-white transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {pending === 'apple' ? <Loader2 size={16} className="animate-spin" /> : <AppleIcon size={16} />}
      <span>Apple</span>
    </button>
    <button
      type="button"
      onClick={() => onOAuth('google')}
      disabled={pending !== null}
      className="flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-2xl bg-white/70 backdrop-blur-sm border border-on-surface/8 text-on-surface text-sm font-medium hover:bg-white transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {pending === 'google' ? <Loader2 size={16} className="animate-spin" /> : <GoogleIcon size={16} />}
      <span>Google</span>
    </button>
  </div>
);

const Divider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="relative flex items-center my-1">
    <div className="flex-1 h-px bg-on-surface/10" />
    <span className="px-3 text-[11px] uppercase tracking-wider text-on-surface/40 font-medium">{children}</span>
    <div className="flex-1 h-px bg-on-surface/10" />
  </div>
);

const EmailPill: React.FC<{ email: string; onClear: () => void }> = ({ email, onClear }) => (
  <button
    type="button"
    onClick={onClear}
    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-on-surface/[0.05] text-on-surface/80 text-[13px] font-medium hover:bg-on-surface/[0.08] transition-colors"
  >
    <span>{email}</span>
    <ArrowLeft size={12} />
  </button>
);

// ── Step components ─────────────────────────────────────────────────────
type SharedProps = {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  submitting: boolean;
  error: string;
  onEmailContinue: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
  onBack: () => void;
  onOAuth: (provider: 'google' | 'apple') => void;
  oauthPending: 'google' | 'apple' | null;
  keepSignedIn: boolean;
  setKeepSignedIn: (v: boolean) => void;
};

const StepEmail: React.FC<SharedProps> = ({
  email, setEmail, submitting, error, onEmailContinue, onOAuth, oauthPending,
}) => (
  <div className="space-y-4">
    <header>
      <h1 className="font-serif font-bold text-3xl xl:text-4xl tracking-tight leading-[1.05] text-on-surface mb-2">
        Welcome to Gourmet&nbsp;Canvas
      </h1>
      <p className="text-sm text-on-surface/55 font-light leading-relaxed max-w-md">
        Sign in or create an account — we'll figure out which one based on your email.
      </p>
    </header>

    <SocialRow onOAuth={onOAuth} pending={oauthPending} />
    <Divider>or continue with email</Divider>

    <form
      onSubmit={(e) => {
        e.preventDefault();
        onEmailContinue();
      }}
      className="space-y-4"
    >
      <div>
        <FieldLabel>Email address</FieldLabel>
        <TextField
          type="email"
          name="email"
          value={email}
          onChange={setEmail}
          placeholder="you@example.com"
          autoComplete="email"
          autoFocus
          inputMode="email"
        />
      </div>

      {error && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-xl"
        >
          {error}
        </motion.p>
      )}

      <PrimaryButton loading={submitting}>Continue</PrimaryButton>
    </form>
  </div>
);

const StepPassword: React.FC<SharedProps> = ({
  email, password, setPassword, showPassword, setShowPassword,
  submitting, error, onSignIn, onBack, keepSignedIn, setKeepSignedIn,
}) => (
  <div className="space-y-4">
    <header>
      <h1 className="font-serif font-bold text-3xl xl:text-4xl tracking-tight leading-[1.05] text-on-surface mb-2">
        Welcome back
      </h1>
      <p className="text-sm text-on-surface/55 font-light leading-relaxed flex flex-wrap items-center gap-2">
        <span>Signing in as</span>
        <EmailPill email={email} onClear={onBack} />
      </p>
    </header>

    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSignIn();
      }}
      className="space-y-4"
    >
      <div>
        <FieldLabel>Password</FieldLabel>
        <TextField
          type={showPassword ? 'text' : 'password'}
          name="password"
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
          autoComplete="current-password"
          autoFocus
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="text-on-surface/40 hover:text-on-surface/70 p-1"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          }
        />
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={keepSignedIn}
            onChange={(e) => setKeepSignedIn(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          <span className="text-sm text-on-surface/70">Keep me signed in</span>
        </label>
        <button type="button" className="text-sm text-primary font-medium hover:underline cursor-pointer">
          Forgot password?
        </button>
      </div>

      {error && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-xl"
        >
          {error}
        </motion.p>
      )}

      <PrimaryButton loading={submitting}>Sign in</PrimaryButton>
    </form>
  </div>
);

const StepSignup: React.FC<SharedProps> = ({
  email, password, setPassword, showPassword, setShowPassword,
  submitting, error, onSignUp, onBack,
}) => {
  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-serif font-bold text-3xl xl:text-4xl tracking-tight leading-[1.05] text-on-surface mb-2">
          Create your account
        </h1>
        <p className="text-sm text-on-surface/55 font-light leading-relaxed flex flex-wrap items-center gap-2">
          <span>Setting up for</span>
          <EmailPill email={email} onClear={onBack} />
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSignUp();
        }}
        className="space-y-4"
      >
        <div>
          <FieldLabel>Password</FieldLabel>
          <TextField
            type={showPassword ? 'text' : 'password'}
            name="password"
            value={password}
            onChange={setPassword}
            placeholder="Choose a password"
            autoComplete="new-password"
            autoFocus
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-on-surface/40 hover:text-on-surface/70 p-1"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            }
          />
          {password.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 mt-2 px-1"
              aria-live="polite"
            >
              <div className="flex-1 h-1 rounded-full bg-on-surface/8 overflow-hidden">
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
        </div>

        {error && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-xl"
          >
            {error}
          </motion.p>
        )}

        <PrimaryButton loading={submitting}>Create account</PrimaryButton>

        <p className="text-xs text-on-surface/45 text-center leading-relaxed">
          By continuing you agree to our{' '}
          <a href="#" className="text-on-surface/70 underline">Terms</a> and{' '}
          <a href="#" className="text-on-surface/70 underline">Privacy Policy</a>.
        </p>
      </form>
    </div>
  );
};

// ── Main page ────────────────────────────────────────────────────────────
export const Auth: React.FC = () => {
  const { signIn, signUp, signInWithOAuth, checkEmailExists } = useAuth();
  const { phoneMode, togglePhoneMode, isNative } = useSettings();
  const useDesktopLayout = useDesktopAuthLayout();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [oauthPending, setOauthPending] = useState<'google' | 'apple' | null>(null);

  const handleEmailContinue = useCallback(async () => {
    setError('');
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Please enter an email address');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Please enter a valid email address');
      return;
    }
    setEmail(trimmed);
    setSubmitting(true);
    const exists = await checkEmailExists(trimmed);
    setSubmitting(false);
    setStep(exists ? 'password' : 'signup');
  }, [email, checkEmailExists]);

  const handleSignIn = useCallback(async () => {
    setError('');
    if (!password) {
      setError('Please enter your password');
      return;
    }
    setSubmitting(true);
    const { error: err } = await signIn(email, password);
    if (err) setError(err);
    setSubmitting(false);
  }, [email, password, signIn]);

  const handleSignUp = useCallback(async () => {
    setError('');
    if (!password) {
      setError('Please choose a password');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setSubmitting(true);
    const { error: err } = await signUp(email, password);
    if (err) setError(err);
    setSubmitting(false);
  }, [email, password, signUp]);

  const handleBack = useCallback(() => {
    setStep('email');
    setPassword('');
    setError('');
  }, []);

  const handleOAuth = useCallback(async (provider: 'google' | 'apple') => {
    setError('');
    setOauthPending(provider);
    const { error: err } = await signInWithOAuth(provider);
    // On success the browser redirects away, so we only reach here on
    // failure (e.g. the provider isn't enabled in Supabase yet).
    if (err) {
      setError(err);
      setOauthPending(null);
    }
  }, [signInWithOAuth]);

  const sharedProps: SharedProps = {
    email, setEmail, password, setPassword, showPassword, setShowPassword,
    submitting, error,
    onEmailContinue: handleEmailContinue,
    onSignIn: handleSignIn,
    onSignUp: handleSignUp,
    onBack: handleBack,
    onOAuth: handleOAuth,
    oauthPending,
    keepSignedIn, setKeepSignedIn,
  };

  const stepContent = (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={step}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
      >
        {step === 'email' && <StepEmail {...sharedProps} />}
        {step === 'password' && <StepPassword {...sharedProps} />}
        {step === 'signup' && <StepSignup {...sharedProps} />}
      </motion.div>
    </AnimatePresence>
  );

  // ── Desktop split layout ─────────────────────────────────────────────
  if (useDesktopLayout) {
    const headerRight =
      step === 'email' ? (
        <span className="text-on-surface/45">New to Gourmet Canvas?</span>
      ) : (
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-1.5 text-on-surface/55 hover:text-on-surface transition-colors cursor-pointer"
        >
          <ArrowLeft size={14} />
          <span>Use a different email</span>
        </button>
      );
    return (
      <AuthShell headerRight={headerRight} panel={step}>
        {stepContent}
      </AuthShell>
    );
  }

  // ── Mobile / phone-frame layout ──────────────────────────────────────
  const passwordStrength = getPasswordStrength(password);

  return (
    <MobileAuthShell>
      {/* Top bar — safe-area aware, holds the back chip on later steps */}
      <div
        className="relative z-10 px-5 flex items-center justify-between"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))', paddingBottom: '0.5rem', minHeight: 56 }}
      >
        <div className="min-w-[44px]">
          {step !== 'email' && (
            <MobileBackButton onClick={handleBack} />
          )}
        </div>
        {/* Tiny phone-preview toggle, kept reachable on desktop preview;
            hidden on native where the toggle has no meaning. */}
        {!isNative && (
          <button
            type="button"
            onClick={togglePhoneMode}
            className={cn(
              'inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[11px] font-semibold border transition-colors',
              phoneMode
                ? 'bg-on-surface/[0.06] border-on-surface/15 text-on-surface/85'
                : 'bg-transparent border-on-surface/10 text-on-surface/55',
            )}
            aria-pressed={phoneMode}
          >
            <Smartphone size={12} className={phoneMode ? 'text-primary' : 'text-on-surface/45'} />
            <span>Preview</span>
          </button>
        )}
      </div>

      {/* Step content — animates in/out per step */}
      <div className="relative z-10 flex-1 min-h-0 flex flex-col overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="flex-1 flex flex-col px-5 pt-2 pb-4"
          >
            {/* Brand + heading */}
            <div className="flex flex-col items-start gap-4 mb-6">
              <MobileBrandMark size={48} pulse={step === 'email'} />
              <div>
                <h1 className="font-display font-bold text-[28px] tracking-tight leading-[1.05] text-on-surface">
                  {step === 'email' && 'Continue with email'}
                  {step === 'password' && 'Welcome back'}
                  {step === 'signup' && 'Create your account'}
                </h1>
                <div className="text-on-surface/55 text-[14px] leading-relaxed mt-2">
                  {step === 'email' && (
                    <span>We'll send you in if you have an account, or set one up if not.</span>
                  )}
                  {step !== 'email' && (
                    <MobileEmailPill email={email} onClear={handleBack} />
                  )}
                </div>
              </div>
            </div>

            {/* Form body */}
            {step === 'email' && (
              <form
                onSubmit={(e) => { e.preventDefault(); handleEmailContinue(); }}
                className="flex flex-col gap-3"
              >
                <MobileField
                  label="Email"
                  icon={<Mail size={16} />}
                  type="email"
                  name="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="you@example.com"
                  autoFocus
                  autoComplete="email"
                  inputMode="email"
                />
                <div className="flex items-center gap-3 my-1">
                  <span className="flex-1 h-px bg-on-surface/10" />
                  <span className="text-[10px] uppercase tracking-[0.18em] text-on-surface/40 font-bold">or</span>
                  <span className="flex-1 h-px bg-on-surface/10" />
                </div>
                <MobileGhostButton
                  icon={oauthPending === 'apple' ? <Loader2 size={16} className="animate-spin" /> : <AppleIcon size={16} />}
                  onClick={() => handleOAuth('apple')}
                >
                  Continue with Apple
                </MobileGhostButton>
                <MobileGhostButton
                  icon={oauthPending === 'google' ? <Loader2 size={16} className="animate-spin" /> : <GoogleIcon size={16} />}
                  onClick={() => handleOAuth('google')}
                >
                  Continue with Google
                </MobileGhostButton>
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
            )}

            {step === 'password' && (
              <form
                onSubmit={(e) => { e.preventDefault(); handleSignIn(); }}
                className="flex flex-col gap-3"
              >
                <MobileField
                  label="Password"
                  icon={<Lock size={16} />}
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="••••••••"
                  autoFocus
                  autoComplete="current-password"
                  rightSlot={
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-on-surface/40 p-1"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  }
                />
                <div className="flex items-center justify-between px-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={keepSignedIn}
                      onChange={(e) => setKeepSignedIn(e.target.checked)}
                      className="h-4 w-4 accent-primary"
                    />
                    <span className="text-[13px] text-on-surface/75">Keep me signed in</span>
                  </label>
                  <button type="button" className="text-[13px] text-primary font-medium">
                    Forgot?
                  </button>
                </div>
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
            )}

            {step === 'signup' && (
              <form
                onSubmit={(e) => { e.preventDefault(); handleSignUp(); }}
                className="flex flex-col gap-3"
              >
                <MobileField
                  label="Password"
                  icon={<Lock size={16} />}
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="Choose a password"
                  autoFocus
                  autoComplete="new-password"
                  rightSlot={
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-on-surface/40 p-1"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  }
                />
                {password.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 px-1"
                    aria-live="polite"
                  >
                    <div className="flex-1 grid grid-cols-4 gap-1.5">
                      {[0, 1, 2, 3].map((i) => (
                        <span
                          key={i}
                          className={cn(
                            'h-1 rounded-full transition-colors',
                            i < passwordStrength.score ? passwordStrength.color : 'bg-on-surface/8',
                          )}
                        />
                      ))}
                    </div>
                    <span className="text-[11px] font-semibold text-on-surface/60 w-[44px] text-right">
                      {passwordStrength.label}
                    </span>
                  </motion.div>
                )}
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
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Sticky CTA — sits above the iOS home indicator on native */}
      <div
        className="relative z-10 px-5 pt-3"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <MobilePrimaryButton
          type="button"
          loading={submitting}
          onClick={
            step === 'email'
              ? handleEmailContinue
              : step === 'password'
                ? handleSignIn
                : handleSignUp
          }
        >
          {step === 'email' && (
            <>
              <span>Continue</span>
              <ArrowRight size={18} />
            </>
          )}
          {step === 'password' && 'Sign in'}
          {step === 'signup' && 'Create account'}
        </MobilePrimaryButton>
        {step === 'signup' && (
          <p className="text-[11px] text-on-surface/45 text-center leading-snug mt-3 px-2">
            By continuing you agree to our{' '}
            <a href="#" className="underline">Terms</a> and{' '}
            <a href="#" className="underline">Privacy</a>.
          </p>
        )}
      </div>
    </MobileAuthShell>
  );
};
