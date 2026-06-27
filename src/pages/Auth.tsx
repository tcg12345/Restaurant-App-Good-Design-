import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mail, Lock, Eye, EyeOff, Loader2, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  OnboardingScreen, BrandMark, Title, Subtitle, FieldLabel, Field, PrimaryButton, GhostButton,
  SocialButton, Divider, RoundBackButton, ProgressHeader, EmailPill, ErrorRow,
  AppleGlyph, GoogleGlyph, TERRA,
} from '../components/onboarding/OnboardingKit';

type Step = 'email' | 'password' | 'signup';

const EyeToggle: React.FC<{ shown: boolean; onClick: () => void }> = ({ shown, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={shown ? 'Hide password' : 'Show password'}
    className="flex items-center justify-center cursor-pointer bg-transparent border-none p-0"
    style={{ width: 38, height: 38, color: '#8B817B' }}
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

export const Auth: React.FC<{ onBrowseAsGuest?: () => void }> = ({ onBrowseAsGuest }) => {
  const { signIn, signUp, signInWithOAuth, checkEmailExists } = useAuth();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [oauthPending, setOauthPending] = useState<'google' | 'apple' | null>(null);

  const emailDisplay = email.trim() || 'you@example.com';
  const pwOk = password.length >= 8;

  const handleEmailContinue = useCallback(async () => {
    setError('');
    const trimmed = email.trim();
    if (!trimmed) { setError('Please enter an email address'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setError('Please enter a valid email address'); return; }
    setEmail(trimmed);
    setSubmitting(true);
    const exists = await checkEmailExists(trimmed);
    setSubmitting(false);
    setStep(exists ? 'password' : 'signup');
  }, [email, checkEmailExists]);

  const handleSignIn = useCallback(async () => {
    setError('');
    if (!password) { setError('Please enter your password'); return; }
    setSubmitting(true);
    const { error: err } = await signIn(email, password);
    if (err) setError(err);
    setSubmitting(false);
  }, [email, password, signIn]);

  const handleSignUp = useCallback(async () => {
    setError('');
    if (password.length < 8) { setError('Use at least 8 characters'); return; }
    setSubmitting(true);
    const { error: err } = await signUp(email, password);
    if (err) setError(err);
    setSubmitting(false);
  }, [email, password, signUp]);

  const handleBack = useCallback(() => {
    setStep('email');
    setPassword('');
    setError('');
    setShowPassword(false);
  }, []);

  const handleOAuth = useCallback(async (provider: 'google' | 'apple') => {
    setError('');
    setOauthPending(provider);
    const { error: err } = await signInWithOAuth(provider);
    if (err) setError(err);
    setOauthPending(null);
  }, [signInWithOAuth]);

  /* ── Welcome ─────────────────────────────────────────────────────────── */
  if (step === 'email') {
    return (
      <OnboardingScreen>
        <FadeStep stepKey="email">
          <BrandMark size={54} />
          <div style={{ marginTop: 24 }}>
            <Title>Welcome to<br />Gourmet Canvas</Title>
            <Subtitle>Enter your email — we'll sign you in, or set you up if you're new.</Subtitle>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); handleEmailContinue(); }} style={{ marginTop: 28 }}>
            <FieldLabel>Email</FieldLabel>
            <Field
              type="email" name="email" value={email} onChange={(v) => { setEmail(v); setError(''); }}
              placeholder="you@example.com" icon={<Mail size={18} strokeWidth={1.6} />}
              autoFocus autoComplete="email" inputMode="email" autoCapitalize="off"
            />
            {error && <ErrorRow>{error}</ErrorRow>}
            <div style={{ marginTop: 14 }}>
              <PrimaryButton type="submit" loading={submitting}>Continue</PrimaryButton>
            </div>
          </form>

          <Divider>OR</Divider>
          <div className="flex flex-col gap-3">
            <SocialButton
              icon={oauthPending === 'apple' ? <Loader2 size={16} className="animate-spin" /> : <AppleGlyph />}
              onClick={() => handleOAuth('apple')} disabled={oauthPending !== null}
            >Continue with Apple</SocialButton>
            <SocialButton
              icon={oauthPending === 'google' ? <Loader2 size={16} className="animate-spin" /> : <GoogleGlyph />}
              onClick={() => handleOAuth('google')} disabled={oauthPending !== null}
            >Continue with Google</SocialButton>
          </div>

          {onBrowseAsGuest && (
            <div style={{ marginTop: 'auto', paddingTop: 24 }} className="flex flex-col items-center">
              <GhostButton onClick={onBrowseAsGuest} trailing>Browse without an account</GhostButton>
            </div>
          )}
        </FadeStep>
      </OnboardingScreen>
    );
  }

  /* ── Sign in (returning) ─────────────────────────────────────────────── */
  if (step === 'password') {
    return (
      <OnboardingScreen>
        <FadeStep stepKey="password">
          <RoundBackButton onClick={handleBack} />
          <div style={{ marginTop: 24 }}><BrandMark size={50} /></div>
          <Title size={30} >Welcome back</Title>
          <div style={{ marginTop: 14 }}><EmailPill email={emailDisplay} onClick={handleBack} /></div>

          <form onSubmit={(e) => { e.preventDefault(); handleSignIn(); }} style={{ marginTop: 24 }}>
            <FieldLabel>Password</FieldLabel>
            <Field
              type={showPassword ? 'text' : 'password'} name="password" value={password}
              onChange={(v) => { setPassword(v); setError(''); }} placeholder="Enter your password"
              icon={<Lock size={16} strokeWidth={1.7} />} autoFocus autoComplete="current-password"
              rightSlot={<EyeToggle shown={showPassword} onClick={() => setShowPassword(!showPassword)} />}
              onSubmit={handleSignIn}
            />
            <div className="flex items-center justify-between" style={{ marginTop: 16 }}>
              <button type="button" onClick={() => setKeepSignedIn(!keepSignedIn)} className="flex items-center gap-2.5 cursor-pointer bg-transparent border-none p-0">
                <span className="flex items-center justify-center flex-shrink-0" style={{ width: 22, height: 22, borderRadius: 6, background: keepSignedIn ? TERRA : 'transparent', border: keepSignedIn ? 'none' : '2px solid #D2C5BC' }}>
                  {keepSignedIn && <Check size={13} strokeWidth={2.6} color="#fff" />}
                </span>
                <span style={{ fontSize: 14.5, color: '#3A322E', fontWeight: 500 }}>Keep me signed in</span>
              </button>
              <button type="button" style={{ fontSize: 14.5, color: TERRA, fontWeight: 600 }} className="cursor-pointer bg-transparent border-none p-0">Forgot?</button>
            </div>
            {error && <ErrorRow>{error}</ErrorRow>}
            <div style={{ marginTop: 'auto', paddingTop: 28 }} className="flex-1 flex flex-col justify-end">
              <PrimaryButton type="submit" loading={submitting} trailing="none">Sign in</PrimaryButton>
            </div>
          </form>
        </FadeStep>
      </OnboardingScreen>
    );
  }

  /* ── Create account (Step 1 of 6) ────────────────────────────────────── */
  return (
    <OnboardingScreen>
      <FadeStep stepKey="signup">
        <ProgressHeader step={1} total={6} onBack={handleBack} />
        <div style={{ marginTop: 26 }}><BrandMark size={50} /></div>
        <Title size={30}>Create your account</Title>
        <div style={{ marginTop: 14 }}><EmailPill email={emailDisplay} onClick={handleBack} /></div>

        <form onSubmit={(e) => { e.preventDefault(); handleSignUp(); }} style={{ marginTop: 24 }} className="flex flex-1 flex-col">
          <FieldLabel>Password</FieldLabel>
          <Field
            type={showPassword ? 'text' : 'password'} name="password" value={password}
            onChange={(v) => { setPassword(v); setError(''); }} placeholder="Choose a password"
            icon={<Lock size={16} strokeWidth={1.7} />} autoFocus autoComplete="new-password"
            rightSlot={<EyeToggle shown={showPassword} onClick={() => setShowPassword(!showPassword)} />}
            onSubmit={handleSignUp}
          />
          <div className="flex items-center gap-2" style={{ marginTop: 11 }}>
            {pwOk ? (
              <>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="#1FA06D" /><path d="M5 8.2l2 2 4-4.4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span style={{ fontSize: 13, color: '#1B8A5E', fontWeight: 500 }}>Strong enough to go</span>
              </>
            ) : (
              <>
                <span className="flex-shrink-0" style={{ width: 7, height: 7, borderRadius: '50%', background: '#D2C5BC' }} />
                <span style={{ fontSize: 13, color: '#8B817B' }}>Use at least 8 characters</span>
              </>
            )}
          </div>
          {error && <ErrorRow>{error}</ErrorRow>}

          <div style={{ marginTop: 'auto', paddingTop: 28 }}>
            <PrimaryButton type="submit" loading={submitting}>Create account</PrimaryButton>
            <p style={{ textAlign: 'center', fontSize: 12.5, color: '#9A8F89', margin: '16px 0 0', lineHeight: 1.5 }}>
              By continuing you agree to our <span style={{ color: TERRA, fontWeight: 600 }}>Terms</span> &amp; <span style={{ color: TERRA, fontWeight: 600 }}>Privacy</span>.
            </p>
          </div>
        </form>
      </FadeStep>
    </OnboardingScreen>
  );
};
