import React, { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { PRIVACY_URL, TERMS_URL, openExternalUrl } from '../lib/external-links';
import { cn } from '../lib/utils';
import { AuthShell, useDesktopAuthLayout } from '../components/AuthShell';
// Mobile uses the new cream/terracotta onboarding kit; desktop keeps the
// original split-screen AuthShell design below.
import * as OB from '../components/onboarding/OnboardingKit';

type Step = 'email' | 'password' | 'verify' | 'setpassword';
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
  onSetPassword: () => void;
  onBack: () => void;
  onOAuth: (provider: 'google' | 'apple') => void;
  oauthPending: 'google' | 'apple' | null;
  // ── Forgot password ──
  onForgotPassword: () => void;
  resetSending: boolean;
  /** Send a 6-digit sign-in code instead of a password (the rescue path). */
  onEmailCodeSignIn: () => void;
  codeSending: boolean;
  /** Set after a reset email goes out ("We emailed a link to …"). */
  resetNotice: string;
  /** Signup = first password after code verification; recovery = new
   *  password after a forgot-password link. Tweaks the set-password copy. */
  passwordSetupMode: 'signup' | 'recovery';
  /** When set, the email step shows a prominent "Browse without an account"
   *  button. As the first screen it enters guest mode; inside the on-demand
   *  sign-in overlay it dismisses the overlay. */
  onBrowseAsGuest?: () => void;
  // ── Email verification (enter the emailed 6-digit code) ──
  code: string;
  setCode: (v: string) => void;
  onVerify: () => void;
  onResend: () => void;
  resendIn: number;
  verifyNotice: string;
};

const StepEmail: React.FC<SharedProps> = ({
  email, setEmail, submitting, error, onEmailContinue, onOAuth, oauthPending, onBrowseAsGuest,
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

    {onBrowseAsGuest && (
      <>
        <Divider>or</Divider>
        <button
          type="button"
          onClick={onBrowseAsGuest}
          className="group w-full flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-on-surface/[0.04] border-2 border-on-surface/15 text-on-surface text-[15px] font-semibold hover:bg-on-surface/[0.07] hover:border-on-surface/25 transition-colors cursor-pointer"
        >
          <span>Browse without an account</span>
          <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
        </button>
      </>
    )}
  </div>
);

const StepPassword: React.FC<SharedProps> = ({
  email, password, setPassword, showPassword, setShowPassword,
  submitting, error, onSignIn, onBack,
  onForgotPassword, resetSending, resetNotice,
  onEmailCodeSignIn, codeSending,
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
        <button
          type="button"
          onClick={onEmailCodeSignIn}
          disabled={codeSending}
          className="text-sm text-primary font-medium hover:underline cursor-pointer disabled:opacity-60 disabled:no-underline"
        >
          {codeSending ? 'Sending code…' : 'Email me a sign-in code'}
        </button>
        <button
          type="button"
          onClick={onForgotPassword}
          disabled={resetSending}
          className="text-sm text-primary font-medium hover:underline cursor-pointer disabled:opacity-60 disabled:no-underline"
        >
          {resetSending ? 'Sending reset link…' : 'Forgot password?'}
        </button>
      </div>

      {resetNotice && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-sm text-green-700 bg-green-50 px-4 py-2.5 rounded-xl"
        >
          {resetNotice}
        </motion.p>
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

      <PrimaryButton loading={submitting}>Sign in</PrimaryButton>
    </form>
  </div>
);

const StepSetPassword: React.FC<SharedProps> = ({
  email, password, setPassword, showPassword, setShowPassword,
  submitting, error, onSetPassword, passwordSetupMode,
}) => {
  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);
  const isRecovery = passwordSetupMode === 'recovery';

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-serif font-bold text-3xl xl:text-4xl tracking-tight leading-[1.05] text-on-surface mb-2">
          {isRecovery ? 'Set a new password' : 'Choose a password'}
        </h1>
        <p className="text-sm text-on-surface/55 font-light leading-relaxed flex flex-wrap items-center gap-2">
          {isRecovery ? (
            <span>Pick a new password for <span className="font-medium text-on-surface/80">{email}</span>.</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-green-700 font-medium">
              <Check size={14} /> {email} verified
            </span>
          )}
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSetPassword();
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

        <PrimaryButton loading={submitting} disabled={password.length < 8}>Continue</PrimaryButton>

        <p className="text-xs text-on-surface/45 text-center leading-relaxed">
          At least 8 characters. By continuing you agree to our{' '}
          <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="text-on-surface/70 underline">Terms</a>
          {' '}&amp;{' '}
          <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="text-on-surface/70 underline">Privacy Policy</a>.
        </p>
      </form>
    </div>
  );
};

// ── Mobile onboarding helpers (cream design) ────────────────────────────
const EyeToggle: React.FC<{ shown: boolean; onClick: () => void }> = ({ shown, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={shown ? 'Hide password' : 'Show password'}
    className="flex items-center justify-center cursor-pointer bg-transparent border-none p-0"
    style={{ width: 38, height: 38, color: 'var(--ob-secondary)' }}
  >
    {shown ? <EyeOff size={18} /> : <Eye size={18} />}
  </button>
);

const FadeStep: React.FC<{ stepKey: string; children: React.ReactNode }> = ({ stepKey, children }) => (
  <AnimatePresence mode="wait" initial={false}>
    <motion.div
      key={stepKey}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-1 flex-col"
    >
      {children}
    </motion.div>
  </AnimatePresence>
);

const StepVerify: React.FC<SharedProps> = ({
  email, code, setCode, submitting, error, onVerify, onResend, resendIn, verifyNotice, onBack,
}) => (
  <div className="space-y-4">
    <header>
      <h1 className="font-serif font-bold text-3xl xl:text-4xl tracking-tight leading-[1.05] text-on-surface mb-2">
        Check your email
      </h1>
      <p className="text-sm text-on-surface/55 font-light leading-relaxed flex flex-wrap items-center gap-2">
        <span>{verifyNotice || 'We sent a 6-digit code to'}</span>
        <EmailPill email={email} onClear={onBack} />
      </p>
    </header>

    <form
      onSubmit={(e) => { e.preventDefault(); onVerify(); }}
      className="space-y-4"
    >
      <div>
        <FieldLabel>Verification code</FieldLabel>
        <input
          type="text"
          name="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="123456"
          autoComplete="one-time-code"
          inputMode="numeric"
          autoFocus
          className="w-full px-4 py-3 rounded-2xl bg-white/70 backdrop-blur-sm border border-on-surface/8 text-on-surface text-center text-[22px] font-bold tracking-[0.4em] placeholder:tracking-[0.4em] placeholder:text-on-surface/20 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all"
        />
      </div>

      {error && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-xl">{error}</motion.p>
      )}

      <PrimaryButton loading={submitting} disabled={code.length !== 6}>Verify email</PrimaryButton>

      <button
        type="button"
        onClick={onResend}
        disabled={resendIn > 0}
        className="w-full text-center text-[13px] font-semibold text-primary disabled:text-on-surface/35 transition-colors"
      >
        {resendIn > 0 ? `Resend code in ${resendIn}s` : "Didn't get it? Resend code"}
      </button>
    </form>
  </div>
);

// ── Main page ────────────────────────────────────────────────────────────
export const Auth: React.FC<{ onBrowseAsGuest?: () => void }> = ({ onBrowseAsGuest }) => {
  const {
    signIn, signInWithOAuth, checkEmailExists,
    startEmailSignup, verifyEmailCode, resendVerificationCode,
    completePasswordSetup, needsPasswordSetup, passwordSetupMode,
    requestPasswordReset, isSignedIn, user,
  } = useAuth();
  const useDesktopLayout = useDesktopAuthLayout();

  // A relaunch mid-signup (code verified, password not yet chosen) reopens
  // straight on the choose-password step.
  const [step, setStep] = useState<Step>(() => (isSignedIn && needsPasswordSetup ? 'setpassword' : 'email'));
  // On a mid-signup relaunch the email input was never typed this session —
  // seed it from the verified session so the header can show the address.
  const [email, setEmail] = useState(() => (isSignedIn && needsPasswordSetup ? user?.email ?? '' : ''));
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [oauthPending, setOauthPending] = useState<'google' | 'apple' | null>(null);
  // Forgot-password state (sign-in step)
  const [resetSending, setResetSending] = useState(false);
  const [resetNotice, setResetNotice] = useState('');
  // Email-verification (6-digit code) state
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [verifyNotice, setVerifyNotice] = useState('');
  // Which flow the code screen is confirming: a verify-first signup (then
  // choose a password) or a legacy account whose email was never confirmed.
  // 'rescue' = "Email me a sign-in code" from the password screen: an
  // EXISTING account signing in by code, then setting a real password. This
  // is the way back in for accounts the old signup flow stranded without one
  // (see verifyEmailCode) — and it doubles as a forgot-password path that
  // stays inside the app instead of bouncing through an emailed link.
  const [verifyFor, setVerifyFor] = useState<'signup' | 'unconfirmed' | 'rescue'>('signup');
  const [codeSending, setCodeSending] = useState(false);

  // Resend cooldown ticker
  React.useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

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
    if (exists === 'yes') {
      setSubmitting(false);
      setStep('password');
      return;
    }
    if (exists === 'unknown') {
      // The lookup failed — we do NOT know if this email is registered.
      // Assuming "new" here would run the signup OTP flow on an existing
      // account and reset its password, so stop and let the user retry.
      setSubmitting(false);
      setError("We couldn't check that email just now — please try again.");
      return;
    }
    // Confirmed new account ('no'): verify the email FIRST (6-digit code),
    // then choose a password. signInWithOtp always sends the code — no
    // dependency on the project's "Confirm email" setting.
    const { error: sendErr } = await startEmailSignup(trimmed);
    setSubmitting(false);
    if (sendErr) { setError(sendErr); return; }
    setCode('');
    setVerifyFor('signup');
    setVerifyNotice('We sent a 6-digit code to');
    setResendIn(60);
    setStep('verify');
  }, [email, checkEmailExists, startEmailSignup]);

  const handleSignIn = useCallback(async () => {
    setError('');
    if (!password) {
      setError('Please enter your password');
      return;
    }
    setSubmitting(true);
    const { error: err } = await signIn(email, password);
    if (err) {
      // Account exists but the email was never confirmed — send a fresh
      // code and route to the verification screen instead of dead-ending.
      if (/confirm/i.test(err)) {
        void resendVerificationCode(email);
        setCode('');
        setVerifyFor('unconfirmed');
        setResendIn(60);
        setVerifyNotice('Your email still needs verifying — we sent a new code to');
        setError('');
        setStep('verify');
      } else {
        setError(err);
      }
    }
    setSubmitting(false);
  }, [email, password, signIn, resendVerificationCode]);

  const handleSetPassword = useCallback(async () => {
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setSubmitting(true);
    const { error: err } = await completePasswordSetup(password);
    if (err) setError(err);
    // Success clears needsPasswordSetup — App swaps to profile setup.
    setSubmitting(false);
  }, [password, completePasswordSetup]);

  const handleBack = useCallback(() => {
    setStep('email');
    setPassword('');
    setCode('');
    setError('');
    setResetNotice('');
  }, []);

  const handleForgotPassword = useCallback(async () => {
    if (resetSending) return;
    setError('');
    setResetNotice('');
    setResetSending(true);
    const { error: err } = await requestPasswordReset(email);
    setResetSending(false);
    if (err) setError(err);
    else setResetNotice(`We emailed a password-reset link to ${email}. Open it to choose a new password.`);
  }, [email, resetSending, requestPasswordReset]);

  const handleEmailCodeSignIn = useCallback(async () => {
    if (codeSending) return;
    setError('');
    setCodeSending(true);
    // The account exists (this screen is only reached when checkEmailExists
    // said 'yes'), so signInWithOtp just sends a sign-in code; the
    // shouldCreateUser flag in startEmailSignup is a no-op here.
    const { error: sendErr } = await startEmailSignup(email);
    setCodeSending(false);
    if (sendErr) { setError(sendErr); return; }
    setCode('');
    setVerifyFor('rescue');
    setVerifyNotice('We sent a 6-digit sign-in code to');
    setResendIn(60);
    setStep('verify');
  }, [email, codeSending, startEmailSignup]);

  const handleVerify = useCallback(async () => {
    setError('');
    if (code.length !== 6) { setError('Enter the 6-digit code from your email'); return; }
    setSubmitting(true);
    // Both the signup path and the rescue path end in the choose-password
    // screen: signup because the just-created account has none, rescue
    // because the person either lost theirs or never got one (the old flow's
    // skip bug). Typing the emailed code is the same proof of ownership the
    // recovery flow demands, so setting a password here is always safe.
    const expectSetup = verifyFor === 'signup' || verifyFor === 'rescue';
    const { error: err, passwordSetupNeeded } = await verifyEmailCode(
      email, code, expectSetup, verifyFor === 'rescue' ? 'recovery' : 'signup');
    if (err) {
      setError(/expired|invalid|token/i.test(err) ? 'That code is invalid or expired — tap resend for a new one.' : err);
    } else if (expectSetup && passwordSetupNeeded !== false) {
      setPassword('');
      setStep('setpassword');
    }
    // 'unconfirmed': the session lands and onAuthStateChange swaps to the app.
    setSubmitting(false);
  }, [email, code, verifyFor, verifyEmailCode]);

  const handleResend = useCallback(async () => {
    if (resendIn > 0) return;
    setError('');
    setResendIn(60);
    const { error: err } = verifyFor !== 'unconfirmed'
      ? await startEmailSignup(email)
      : await resendVerificationCode(email);
    if (err) setError(err);
  }, [email, resendIn, verifyFor, startEmailSignup, resendVerificationCode]);

  const handleOAuth = useCallback(async (provider: 'google' | 'apple') => {
    setError('');
    setOauthPending(provider);
    const { error: err } = await signInWithOAuth(provider);
    if (err) setError(err);
    // Web: on success the page is already navigating away, so this is moot.
    // Native: control returns here after success (onAuthStateChange then
    // swaps the screen) or after a cancel — either way clear the spinner.
    setOauthPending(null);
  }, [signInWithOAuth]);

  const sharedProps: SharedProps = {
    email, setEmail, password, setPassword, showPassword, setShowPassword,
    submitting, error,
    onEmailContinue: handleEmailContinue,
    onSignIn: handleSignIn,
    onSetPassword: handleSetPassword,
    onBack: handleBack,
    onOAuth: handleOAuth,
    oauthPending,
    onForgotPassword: () => { void handleForgotPassword(); },
    resetSending, resetNotice, passwordSetupMode,
    onEmailCodeSignIn: () => { void handleEmailCodeSignIn(); },
    codeSending,
    onBrowseAsGuest,
    code, setCode,
    onVerify: handleVerify,
    onResend: handleResend,
    resendIn, verifyNotice,
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
        {step === 'verify' && <StepVerify {...sharedProps} />}
        {step === 'setpassword' && <StepSetPassword {...sharedProps} />}
      </motion.div>
    </AnimatePresence>
  );

  // ── Desktop split layout ─────────────────────────────────────────────
  if (useDesktopLayout) {
    const headerRight =
      step === 'email' ? (
        <span className="text-on-surface/45">New to Gourmet Canvas?</span>
      ) : step === 'setpassword' ? (
        // Email is verified and the session exists — no going back from here.
        <span className="text-on-surface/45">One last step</span>
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
      <AuthShell headerRight={headerRight} panel={step === 'verify' || step === 'setpassword' ? 'signup' : step}>
        {stepContent}
      </AuthShell>
    );
  }

  // ── Mobile / phone-frame layout — the cream/terracotta onboarding ─────
  const emailDisplay = email.trim() || 'you@example.com';
  const pwOk = password.length >= 8;

  // Welcome
  if (step === 'email') {
    return (
      <OB.OnboardingScreen>
        <FadeStep stepKey="email">
          <OB.BrandMark size={54} />
          <div style={{ marginTop: 24 }}>
            <OB.Title>Welcome to<br />Gourmet Canvas</OB.Title>
            <OB.Subtitle>Enter your email — we'll sign you in, or set you up if you're new.</OB.Subtitle>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); handleEmailContinue(); }} style={{ marginTop: 28 }}>
            <OB.FieldLabel>Email</OB.FieldLabel>
            <OB.Field
              type="email" name="email" value={email} onChange={(v) => { setEmail(v); setError(''); }}
              placeholder="you@example.com" icon={<Mail size={18} strokeWidth={1.6} />}
              autoFocus autoComplete="email" inputMode="email" autoCapitalize="off"
            />
            {error && <OB.ErrorRow>{error}</OB.ErrorRow>}
            <div style={{ marginTop: 14 }}><OB.PrimaryButton type="submit" loading={submitting}>Continue</OB.PrimaryButton></div>
          </form>
          <OB.Divider>OR</OB.Divider>
          <div className="flex flex-col gap-3">
            <OB.SocialButton
              icon={oauthPending === 'apple' ? <Loader2 size={16} className="animate-spin" /> : <OB.AppleGlyph />}
              onClick={() => handleOAuth('apple')} disabled={oauthPending !== null}
            >Continue with Apple</OB.SocialButton>
            <OB.SocialButton
              icon={oauthPending === 'google' ? <Loader2 size={16} className="animate-spin" /> : <OB.GoogleGlyph />}
              onClick={() => handleOAuth('google')} disabled={oauthPending !== null}
            >Continue with Google</OB.SocialButton>
          </div>
          {onBrowseAsGuest && (
            <div style={{ marginTop: 'auto', paddingTop: 24 }} className="flex flex-col items-center">
              <OB.GhostButton onClick={onBrowseAsGuest} trailing>Browse without an account</OB.GhostButton>
            </div>
          )}
        </FadeStep>
      </OB.OnboardingScreen>
    );
  }

  // Sign in (returning)
  if (step === 'password') {
    return (
      <OB.OnboardingScreen>
        <FadeStep stepKey="password">
          <OB.RoundBackButton onClick={handleBack} />
          <div style={{ marginTop: 24 }}><OB.BrandMark size={50} /></div>
          <OB.Title size={30}>Welcome back</OB.Title>
          <div style={{ marginTop: 14 }}><OB.EmailPill email={emailDisplay} onClick={handleBack} /></div>
          <form onSubmit={(e) => { e.preventDefault(); handleSignIn(); }} style={{ marginTop: 24 }}>
            <OB.FieldLabel>Password</OB.FieldLabel>
            <OB.Field
              type={showPassword ? 'text' : 'password'} name="password" value={password}
              onChange={(v) => { setPassword(v); setError(''); }} placeholder="Enter your password"
              icon={<Lock size={16} strokeWidth={1.7} />} autoFocus autoComplete="current-password"
              rightSlot={<EyeToggle shown={showPassword} onClick={() => setShowPassword(!showPassword)} />}
              onSubmit={handleSignIn}
            />
            <div className="flex items-center justify-between" style={{ marginTop: 16 }}>
              <button
                type="button"
                onClick={() => { void handleEmailCodeSignIn(); }}
                disabled={codeSending}
                style={{ fontSize: 14.5, color: codeSending ? 'var(--ob-label)' : OB.TERRA, fontWeight: 600 }}
                className="cursor-pointer bg-transparent border-none p-0 disabled:cursor-default"
              >
                {codeSending ? 'Sending code…' : 'Email me a sign-in code'}
              </button>
              <button
                type="button"
                onClick={() => { void handleForgotPassword(); }}
                disabled={resetSending}
                style={{ fontSize: 14.5, color: resetSending ? 'var(--ob-label)' : OB.TERRA, fontWeight: 600 }}
                className="cursor-pointer bg-transparent border-none p-0 disabled:cursor-default"
              >
                {resetSending ? 'Sending reset link…' : 'Forgot password?'}
              </button>
            </div>
            {resetNotice && (
              <div className="flex items-start gap-2" style={{ marginTop: 12 }}>
                <svg className="flex-shrink-0" style={{ marginTop: 2 }} width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="var(--ob-success-dot)" /><path d="M5 8.2l2 2 4-4.4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--ob-success)', fontWeight: 500 }}>{resetNotice}</span>
              </div>
            )}
            {error && <OB.ErrorRow>{error}</OB.ErrorRow>}
            <div style={{ marginTop: 'auto', paddingTop: 28 }} className="flex-1 flex flex-col justify-end">
              <OB.PrimaryButton type="submit" loading={submitting} trailing="none">Sign in</OB.PrimaryButton>
            </div>
          </form>
        </FadeStep>
      </OB.OnboardingScreen>
    );
  }

  // Verify email — enter the emailed 6-digit code
  if (step === 'verify') {
    return (
      <OB.OnboardingScreen>
        <FadeStep stepKey="verify">
          <OB.RoundBackButton onClick={handleBack} />
          <div style={{ marginTop: 24 }}><OB.BrandMark size={50} /></div>
          <OB.Title size={30}>Check your email</OB.Title>
          <OB.Subtitle>{verifyNotice || 'We sent a 6-digit code to'}</OB.Subtitle>
          <div style={{ marginTop: 10 }}><OB.EmailPill email={emailDisplay} onClick={handleBack} /></div>
          <form onSubmit={(e) => { e.preventDefault(); handleVerify(); }} style={{ marginTop: 24 }} className="flex flex-1 flex-col">
            <OB.FieldLabel>Verification code</OB.FieldLabel>
            <input
              type="text"
              name="one-time-code"
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }}
              placeholder="123456"
              autoComplete="one-time-code"
              inputMode="numeric"
              autoFocus
              className="w-full rounded-2xl border text-center focus:outline-none"
              style={{
                padding: '14px 16px', fontSize: 24, fontWeight: 700, letterSpacing: '0.4em',
                background: 'var(--ob-field-bg, rgba(255,255,255,0.7))', borderColor: OB.BORDER, color: OB.INK,
              }}
            />
            {error && <OB.ErrorRow>{error}</OB.ErrorRow>}
            <div style={{ marginTop: 16 }}>
              <OB.PrimaryButton type="submit" loading={submitting} disabled={code.length !== 6} trailing="check">
                Verify email
              </OB.PrimaryButton>
            </div>
            <button
              type="button"
              onClick={() => { void handleResend(); }}
              disabled={resendIn > 0}
              className="bg-transparent border-none cursor-pointer disabled:cursor-default"
              style={{ marginTop: 16, fontSize: 14, fontWeight: 600, color: resendIn > 0 ? 'var(--ob-label)' : OB.TERRA }}
            >
              {resendIn > 0 ? `Resend code in ${resendIn}s` : "Didn't get it? Resend code"}
            </button>
          </form>
        </FadeStep>
      </OB.OnboardingScreen>
    );
  }

  // Choose a password (email already verified by code; session exists) —
  // also the set-NEW-password screen a forgot-password link lands on.
  return (
    <OB.OnboardingScreen>
      <FadeStep stepKey="setpassword">
        <div style={{ marginTop: 26 }}><OB.BrandMark size={50} /></div>
        <OB.Title size={30}>{passwordSetupMode === 'recovery' ? 'Set a new password' : 'Choose a password'}</OB.Title>
        {passwordSetupMode === 'recovery' ? (
          <div style={{ marginTop: 14, fontSize: 14, color: 'var(--ob-secondary)' }}>
            Pick a new password for <span style={{ color: OB.TERRA, fontWeight: 600 }}>{emailDisplay}</span>.
          </div>
        ) : (
          <div className="flex items-center gap-2" style={{ marginTop: 14 }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="var(--ob-success-dot)" /><path d="M5 8.2l2 2 4-4.4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span style={{ fontSize: 14, color: 'var(--ob-success)', fontWeight: 600 }}>{emailDisplay} verified</span>
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); handleSetPassword(); }} style={{ marginTop: 24 }} className="flex flex-1 flex-col">
          <OB.FieldLabel>Password</OB.FieldLabel>
          <OB.Field
            type={showPassword ? 'text' : 'password'} name="password" value={password}
            onChange={(v) => { setPassword(v); setError(''); }} placeholder="Choose a password"
            icon={<Lock size={16} strokeWidth={1.7} />} autoFocus autoComplete="new-password"
            rightSlot={<EyeToggle shown={showPassword} onClick={() => setShowPassword(!showPassword)} />}
            onSubmit={handleSetPassword}
          />
          <div className="flex items-center gap-2" style={{ marginTop: 11 }}>
            {pwOk ? (
              <>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="var(--ob-success-dot)" /><path d="M5 8.2l2 2 4-4.4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span style={{ fontSize: 13, color: 'var(--ob-success)', fontWeight: 500 }}>Strong enough to go</span>
              </>
            ) : (
              <>
                <span className="flex-shrink-0" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ob-radio-ring)' }} />
                <span style={{ fontSize: 13, color: 'var(--ob-secondary)' }}>Use at least 8 characters</span>
              </>
            )}
          </div>
          {error && <OB.ErrorRow>{error}</OB.ErrorRow>}
          <div style={{ marginTop: 'auto', paddingTop: 28 }}>
            <OB.PrimaryButton type="submit" loading={submitting} disabled={!pwOk} trailing="check">Continue</OB.PrimaryButton>
            <p style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--ob-label)', margin: '16px 0 0', lineHeight: 1.5 }}>
              By continuing you agree to our{' '}
              <button
                type="button"
                onClick={() => { void openExternalUrl(TERMS_URL); }}
                className="cursor-pointer bg-transparent border-none p-0"
                style={{ color: OB.TERRA, fontWeight: 600, fontSize: 'inherit', lineHeight: 'inherit' }}
              >Terms</button>
              {' '}&amp;{' '}
              <button
                type="button"
                onClick={() => { void openExternalUrl(PRIVACY_URL); }}
                className="cursor-pointer bg-transparent border-none p-0"
                style={{ color: OB.TERRA, fontWeight: 600, fontSize: 'inherit', lineHeight: 'inherit' }}
              >Privacy</button>.
            </p>
          </div>
        </form>
      </FadeStep>
    </OB.OnboardingScreen>
  );
};
