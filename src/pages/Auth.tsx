import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Eye, EyeOff, Loader2, Lock, Mail, Phone } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { PRIVACY_URL, TERMS_URL, openExternalUrl } from '../lib/external-links';
import { logOnboardingEvent } from '../lib/onboarding-events';
import { toE164, deviceRegion, type CountryCode } from '../lib/phone';
// A shared responsive presentation for every sign-in method.
import * as OB from '../components/onboarding/OnboardingKit';

type Step = 'email' | 'password' | 'verify' | 'setpassword';
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

/** The consent line. It used to live only on the choose-password screen,
 *  which an Apple or Google signup never sees — so a third of new accounts
 *  agreed to nothing. Now on the identifier screen too, under every way in. */
const TermsNote: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <p style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--ob-label)', margin: '16px 0 0', lineHeight: 1.5, ...style }}>
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
);

const FadeStep: React.FC<{ stepKey: string; children: React.ReactNode }> = ({ stepKey, children }) => (

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

);

export const Auth: React.FC<{
  onBrowseAsGuest?: () => void;
  /** Reached via "Sign in" (not "Get started"): an identifier with no
   *  account behind it must error instead of quietly starting a signup —
   *  someone who says they have an account and mistypes their email must
   *  not end up with a second, empty account. Escapable in place via
   *  "Create an account". */
  signInOnly?: boolean;
  /** True when arriving from the pre-auth taste flow's "Save my taste
   *  profile" CTA — the email step then speaks to what they just built
   *  instead of a generic welcome. */
  saveTasteFraming?: boolean;
}> = ({ onBrowseAsGuest, saveTasteFraming, signInOnly }) => {
  const {
    signIn, signInWithOAuth, checkEmailExists,
    startEmailSignup, verifyEmailCode, resendVerificationCode,
    signInWithPhonePassword, checkPhoneExists,
    startPhoneSignup, verifyPhoneCode, resendPhoneCode,
    completePasswordSetup, needsPasswordSetup, passwordSetupMode,
    requestPasswordReset, isSignedIn, user,
  } = useAuth();
  useEffect(() => { logOnboardingEvent('auth_shown'); }, []);

  // A relaunch mid-signup (code verified, password not yet chosen) reopens
  // straight on the choose-password step.
  const [step, setStep] = useState<Step>(() => (isSignedIn && needsPasswordSetup ? 'setpassword' : 'email'));
  // On a mid-signup relaunch the identifier input was never typed this
  // session — seed it from the verified session so the header can show it.
  // Either field may be the one that exists: a phone signup has no email.
  const [email, setEmail] = useState(() => (isSignedIn && needsPasswordSetup ? user?.email ?? '' : ''));
  /* ── Channel ────────────────────────────────────────────────────────
     Which identifier this run of the flow is using. A third axis on the
     existing machine rather than new steps: every step (identifier →
     password / verify → setpassword) is the same screen either way, so
     only the send, the probe and the copy differ. A relaunch mid-signup
     resumes on whichever channel the session actually has. */
  const [channel, setChannel] = useState<'email' | 'phone'>(
    () => (isSignedIn && needsPasswordSetup && !user?.email && user?.phone ? 'phone' : 'email'),
  );
  const [phone, setPhone] = useState(() => (isSignedIn && needsPasswordSetup ? user?.phone ?? '' : ''));
  /* "Sign in" holds until the user explicitly says they're new — a local
     unlock rather than navigation, so their typed identifier survives. */
  const [signupUnlocked, setSignupUnlocked] = useState(false);
  const lockedToSignIn = !!signInOnly && !signupUnlocked;
  const unlockSignup = useCallback(() => { setSignupUnlocked(true); setError(''); }, []);
  const [region, setRegion] = useState<CountryCode>(() => deviceRegion());
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

  /* The typed number in the one format Supabase and contact matching both
     require, or null while it isn't yet a real number. Everything that
     talks to the server uses this — never the raw input. */
  const phoneE164 = useMemo(() => toE164(phone, region), [phone, region]);
  /* What the code screen and the password header should show. Falls back
     to the raw input so a half-typed number still appears rather than
     blanking the header. */
  const identifier = channel === 'email' ? email : (phoneE164 ?? phone);

  // Resend cooldown ticker
  React.useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  const authAction = useRef(false);

  const handleIdentifierContinue = useCallback(async () => {
    if (authAction.current) return;
    authAction.current = true;
    try {
    setError('');

    /* Phone and email answer the same three questions — is this a real
       identifier, does an account already exist, and if not send a code —
       so the shape below is deliberately identical; only the validator,
       the probe and the wording differ. */
    if (channel === 'phone') {
      // toE164 returns null for anything not dialable. Stopping here is the
      // point: an invalid number sent to Supabase would spend a slot
      // against the project's SMS rate limit (the real spend ceiling) on a
      // number that can never receive the code.
      const e164 = phoneE164;
      if (!e164) {
        setError(phone.trim() ? 'Please enter a valid phone number' : 'Please enter a phone number');
        return;
      }
      setSubmitting(true);
      const exists = await checkPhoneExists(e164);
      if (exists === 'yes') {
        setSubmitting(false);
        setStep('password');
        return;
      }
      if (exists === 'unknown') {
        setSubmitting(false);
        setError("We couldn't check that number just now — please try again.");
        return;
      }
      if (lockedToSignIn) {
        // They said they have an account; this number doesn't. Starting a
        // signup here would hand a mistyped digit a brand-new empty
        // account instead of the one they meant.
        setSubmitting(false);
        setError('No account found with that number. Check it, or create an account below.');
        return;
      }
      const { error: sendErr } = await startPhoneSignup(e164);
      setSubmitting(false);
      if (sendErr) { setError(sendErr); return; }
      setCode('');
      setVerifyFor('signup');
      setVerifyNotice('We sent a 6-digit code to');
      setResendIn(60);
      setStep('verify');
      return;
    }

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
    if (lockedToSignIn) {
      setSubmitting(false);
      setError('No account found with that email. Check it, or create an account below.');
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
    } catch {
      setError('Couldn’t connect. Please try again.');
    } finally {
      authAction.current = false;
      setSubmitting(false);
      setOauthPending(null);
      setCodeSending(false);
      setResetSending(false);
    }
  }, [channel, phone, phoneE164, email, lockedToSignIn, checkEmailExists, checkPhoneExists, startEmailSignup, startPhoneSignup]);

  const handleSignIn = useCallback(async () => {
    if (authAction.current) return;
    authAction.current = true;
    try {
    setError('');
    if (!password) {
      setError('Please enter your password');
      return;
    }
    setSubmitting(true);
    const { error: err } = channel === 'phone' && phoneE164
      ? await signInWithPhonePassword(phoneE164, password)
      : await signIn(email, password);
    if (err) {
      // Account exists but the email was never confirmed — send a fresh
      // code and route to the verification screen instead of dead-ending.
      // Phone accounts can't reach this state: the number is confirmed by
      // the OTP that created the account.
      if (channel === 'email' && /confirm/i.test(err)) {
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
    } catch {
      setError('Couldn’t connect. Please try again.');
    } finally {
      authAction.current = false;
      setSubmitting(false);
      setOauthPending(null);
      setCodeSending(false);
      setResetSending(false);
    }
  }, [channel, phoneE164, email, password, signIn, signInWithPhonePassword, resendVerificationCode]);

  const handleSetPassword = useCallback(async () => {
    if (authAction.current) return;
    authAction.current = true;
    try {
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
    } catch {
      setError('Couldn’t connect. Please try again.');
    } finally {
      authAction.current = false;
      setSubmitting(false);
      setOauthPending(null);
      setCodeSending(false);
      setResetSending(false);
    }
  }, [password, completePasswordSetup]);

  const handleBack = useCallback(() => {
    if (authAction.current) return;
    setStep('email');
    setPassword('');
    setCode('');
    setError('');
    setResetNotice('');
  }, []);

  const handleForgotPassword = useCallback(async () => {
    if (authAction.current) return;
    authAction.current = true;
    try {
    if (resetSending) return;
    setError('');
    setResetNotice('');
    setResetSending(true);
    const { error: err } = await requestPasswordReset(email);
    setResetSending(false);
    if (err) setError(err);
    else setResetNotice(`We emailed a password-reset link to ${email}. Open it to choose a new password.`);
    } catch {
      setError('Couldn’t connect. Please try again.');
    } finally {
      authAction.current = false;
      setSubmitting(false);
      setOauthPending(null);
      setCodeSending(false);
      setResetSending(false);
    }
  }, [email, resetSending, requestPasswordReset]);

  const handleCodeSignIn = useCallback(async () => {
    if (authAction.current) return;
    authAction.current = true;
    try {
    if (codeSending) return;
    setError('');
    setCodeSending(true);
    // The account exists (this screen is only reached when the existence
    // probe said 'yes'), so this just sends a sign-in code; the
    // shouldCreateUser flag is a no-op here.
    //
    // For phone this is also the ONLY password-recovery route — Supabase
    // has no resetPasswordForEmail equivalent for SMS, and it doesn't need
    // one: typing a texted code proves control of the number exactly the
    // way an emailed link proves control of the inbox.
    const { error: sendErr } = channel === 'phone' && phoneE164
      ? await startPhoneSignup(phoneE164)
      : await startEmailSignup(email);
    setCodeSending(false);
    if (sendErr) { setError(sendErr); return; }
    setCode('');
    setVerifyFor('rescue');
    setVerifyNotice('We sent a 6-digit sign-in code to');
    setResendIn(60);
    setStep('verify');
    } catch {
      setError('Couldn’t connect. Please try again.');
    } finally {
      authAction.current = false;
      setSubmitting(false);
      setOauthPending(null);
      setCodeSending(false);
      setResetSending(false);
    }
  }, [channel, phoneE164, email, codeSending, startEmailSignup, startPhoneSignup]);

  const handleVerify = useCallback(async () => {
    if (authAction.current) return;
    authAction.current = true;
    try {
    setError('');
    if (code.length !== 6) {
      setError(channel === 'phone'
        ? 'Enter the 6-digit code from your text message'
        : 'Enter the 6-digit code from your email');
      return;
    }
    setSubmitting(true);
    // Both the signup path and the rescue path end in the choose-password
    // screen: signup because the just-created account has none, rescue
    // because the person either lost theirs or never got one (the old flow's
    // skip bug). Typing the emailed code is the same proof of ownership the
    // recovery flow demands, so setting a password here is always safe.
    const expectSetup = verifyFor === 'signup' || verifyFor === 'rescue';
    const setupMode = verifyFor === 'rescue' ? 'recovery' : 'signup';
    const { error: err, passwordSetupNeeded } = channel === 'phone' && phoneE164
      ? await verifyPhoneCode(phoneE164, code, expectSetup, setupMode)
      : await verifyEmailCode(email, code, expectSetup, setupMode);
    if (err) {
      setError(/expired|invalid|token/i.test(err) ? 'That code is invalid or expired — tap resend for a new one.' : err);
    } else if (expectSetup && passwordSetupNeeded !== false) {
      setPassword('');
      setStep('setpassword');
    }
    // 'unconfirmed': the session lands and onAuthStateChange swaps to the app.
    setSubmitting(false);
    } catch {
      setError('Couldn’t connect. Please try again.');
    } finally {
      authAction.current = false;
      setSubmitting(false);
      setOauthPending(null);
      setCodeSending(false);
      setResetSending(false);
    }
  }, [channel, phoneE164, email, code, verifyFor, verifyEmailCode, verifyPhoneCode]);

  const handleResend = useCallback(async () => {
    if (authAction.current) return;
    authAction.current = true;
    try {
    if (resendIn > 0) return;
    setError('');
    setResendIn(60);
    const { error: err } = channel === 'phone' && phoneE164
      ? (verifyFor !== 'unconfirmed'
        ? await startPhoneSignup(phoneE164)
        : await resendPhoneCode(phoneE164))
      : (verifyFor !== 'unconfirmed'
        ? await startEmailSignup(email)
        : await resendVerificationCode(email));
    if (err) setError(err);
    } catch {
      setError('Couldn’t connect. Please try again.');
    } finally {
      authAction.current = false;
      setSubmitting(false);
      setOauthPending(null);
      setCodeSending(false);
      setResetSending(false);
    }
  }, [channel, phoneE164, email, resendIn, verifyFor, startEmailSignup, resendVerificationCode, startPhoneSignup, resendPhoneCode]);

  /* A phone account has no emailed reset link to send, so "forgot
     password" IS the code path — same screen, same proof of ownership
     (a texted code proves control of the number the way an emailed link
     proves control of the inbox). Branching here rather than inside each
     layout keeps the two password screens identical.

     Defined after handleCodeSignIn on purpose: a useCallback dependency
     array is evaluated immediately, so referencing it any earlier is a
     temporal-dead-zone crash rather than a hoisted function. */
  const handleForgotPasswordForChannel = useCallback(() => {
    if (channel === 'phone') void handleCodeSignIn();
    else void handleForgotPassword();
  }, [channel, handleCodeSignIn, handleForgotPassword]);

  const handleOAuth = useCallback(async (provider: 'google' | 'apple') => {
    if (authAction.current) return;
    authAction.current = true;
    try {
    setError('');
    setOauthPending(provider);
    const { error: err } = await signInWithOAuth(provider);
    if (err) setError(err);
    // Web: on success the page is already navigating away, so this is moot.
    // Native: control returns here after success (onAuthStateChange then
    // swaps the screen) or after a cancel — either way clear the spinner.
    setOauthPending(null);
    } catch {
      setError('Couldn’t connect. Please try again.');
    } finally {
      authAction.current = false;
      setSubmitting(false);
      setOauthPending(null);
      setCodeSending(false);
      setResetSending(false);
    }
  }, [signInWithOAuth]);

  /* Whichever identifier is in play — a phone signup has no email at
     all, so keying every screen off `email` left them blank. */
  const identifierDisplay = channel === 'phone'
    ? (identifier.trim() || 'your number')
    : (email.trim() || 'you@example.com');
  const pwOk = password.length >= 8;

  // Welcome
  if (step === 'email') {
    return (
      <OB.OnboardingScreen>
        <FadeStep stepKey="email">
          <OB.BrandMark size={54} />
          <div style={{ marginTop: 24 }}>
            {saveTasteFraming ? (
              <>
                <OB.Title>Save your<br /><em>taste profile</em></OB.Title>
                <OB.Subtitle>Create a free account to keep your picks and start rating — or sign in.</OB.Subtitle>
              </>
            ) : (
              <>
                <OB.Title>{lockedToSignIn ? <>Welcome <em>back</em></> : <>Welcome to <em>GoodEats</em></>}</OB.Title>
                <OB.Subtitle>
                  {lockedToSignIn
                    ? (channel === 'phone'
                      ? 'Sign in with your phone number.'
                      : 'Sign in with your email.')
                    : channel === 'phone'
                      ? "Enter your phone number — we'll sign you in, or set you up if you're new."
                      : "Enter your email — we'll sign you in, or set you up if you're new."}
                </OB.Subtitle>
              </>
            )}
          </div>
          <div className="flex flex-col gap-3" style={{ marginTop:22 }}>
            {/* Sits with the other "continue another way" options rather
                than under the field, because that is what it is. */}
            <OB.SocialButton
              icon={oauthPending === 'apple' ? <Loader2 size={16} className="animate-spin" /> : <OB.AppleGlyph />}
              onClick={() => handleOAuth('apple')} disabled={oauthPending !== null || submitting}
            >Continue with Apple</OB.SocialButton>
            <OB.SocialButton
              icon={oauthPending === 'google' ? <Loader2 size={16} className="animate-spin" /> : <OB.GoogleGlyph />}
              onClick={() => handleOAuth('google')} disabled={oauthPending !== null || submitting}
            >Continue with Google</OB.SocialButton>
          </div>
          <OB.Divider>OR</OB.Divider>
          <form onSubmit={(e) => { e.preventDefault(); handleIdentifierContinue(); }} style={{ marginTop: 28 }}>
            {channel === 'phone' ? (
              <>
                <OB.FieldLabel>Phone number</OB.FieldLabel>
                <OB.Field
                  type="tel" name="phone" value={phone} onChange={(v) => { setPhone(v); setError(''); }}
                  placeholder="(555) 123-4567" icon={<Phone size={18} strokeWidth={1.6} />}
                  autoComplete="tel" inputMode="tel" autoCapitalize="off"
                />
              </>
            ) : (
              <>
                <OB.FieldLabel>Email</OB.FieldLabel>
                <OB.Field
                  type="email" name="email" value={email} onChange={(v) => { setEmail(v); setError(''); }}
                  placeholder="you@example.com" icon={<Mail size={18} strokeWidth={1.6} />}
                  autoComplete="email" inputMode="email" autoCapitalize="off"
                />
              </>
            )}
            {error && <OB.ErrorRow>{error}</OB.ErrorRow>}
            <div style={{ marginTop: 14 }}><OB.PrimaryButton type="submit" loading={submitting}>Continue</OB.PrimaryButton></div>
          </form>
          <OB.GhostButton onClick={() => { if (!authAction.current) { setChannel(channel === 'phone' ? 'email' : 'phone'); setError(''); } }}>
            {channel === 'phone' ? 'Use email instead' : 'Use phone instead'}
          </OB.GhostButton>
          <TermsNote style={{ marginTop: 18 }} />
          {lockedToSignIn && (
            <div style={{ marginTop: 6 }}>
              <OB.GhostButton onClick={unlockSignup}>New to GoodEats? Create an account</OB.GhostButton>
            </div>
          )}
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
          <OB.Title size={30}>Welcome <em>back</em></OB.Title>
          <div style={{ marginTop: 14 }}><OB.EmailPill email={identifierDisplay} onClick={handleBack} /></div>
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
                onClick={() => { void handleCodeSignIn(); }}
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

  // Verify — enter the 6-digit code we emailed or texted
  if (step === 'verify') {
    return (
      <OB.OnboardingScreen>
        <FadeStep stepKey="verify">
          <OB.RoundBackButton onClick={handleBack} />
          <div style={{ marginTop: 24 }}><OB.BrandMark size={50} /></div>
          <OB.Title size={30}>Check your <em>{channel === 'phone' ? 'texts' : 'email'}</em></OB.Title>
          <OB.Subtitle>{verifyNotice || 'We sent a 6-digit code to'}</OB.Subtitle>
          <div style={{ marginTop: 10 }}><OB.EmailPill email={identifierDisplay} onClick={handleBack} /></div>
          <form onSubmit={(e) => { e.preventDefault(); handleVerify(); }} style={{ marginTop: 24 }} className="flex flex-1 flex-col">
            <OB.FieldLabel>Verification code</OB.FieldLabel>
            <input
              type="text"
              name="one-time-code"
              aria-label="Verification code"
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }}
              placeholder="123456"
              autoComplete="one-time-code"
              inputMode="numeric"
              autoFocus
              className="w-full rounded-2xl border text-center focus:outline-none"
              // The kit's own field fill. This read `--ob-field-bg`, a token
              // that never existed, so it fell back to a 70% white box — on
              // the dark theme, near-white ink on a near-white field.
              style={{
                padding: '14px 16px', fontSize: 24, fontWeight: 700, letterSpacing: '0.4em',
                background: 'var(--ob-field)', borderColor: 'transparent', color: OB.INK,
              }}
            />
            {error && <OB.ErrorRow>{error}</OB.ErrorRow>}
            <div style={{ marginTop: 16 }}>
              <OB.PrimaryButton type="submit" loading={submitting} disabled={code.length !== 6} trailing="check">
                {channel === 'phone' ? 'Verify number' : 'Verify email'}
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
        <OB.Title size={30}>{passwordSetupMode === 'recovery' ? <>Set a new <em>password</em></> : <>Choose a <em>password</em></>}</OB.Title>
        {passwordSetupMode === 'recovery' ? (
          <div style={{ marginTop: 14, fontSize: 14, color: 'var(--ob-secondary)' }}>
            Pick a new password for <span style={{ color: OB.TERRA, fontWeight: 600 }}>{identifierDisplay}</span>.
          </div>
        ) : (
          <div className="flex items-center gap-2" style={{ marginTop: 14 }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="var(--ob-success-dot)" /><path d="M5 8.2l2 2 4-4.4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span style={{ fontSize: 14, color: 'var(--ob-success)', fontWeight: 600 }}>{identifierDisplay} verified</span>
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
                <span style={{ fontSize: 13, color: 'var(--ob-success)', fontWeight: 500 }}>At least 8 characters</span>
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
            <TermsNote />
          </div>
        </form>
      </FadeStep>
    </OB.OnboardingScreen>
  );
};
