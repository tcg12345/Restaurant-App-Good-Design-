/**
 * Verification application — /verify/apply.
 *
 * A multi-section form (identity → professional → social presence →
 * statement) submitted to `verification_requests` for owner review on
 * /admin/verification. Phone renders it as an OnboardingKit wizard (one
 * section per step, same chrome as ProfileSetup); desktop renders the same
 * sections as one scrollable form.
 *
 * States handled up front: a pending application shows "under review"
 * instead of the form; a denied one pre-fills for resubmission.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Plus, X, Loader2, Briefcase, Link2, PenLine, User, Clock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { VerifiedBadge } from '../components/VerifiedBadge';
import * as OB from '../components/onboarding/OnboardingKit';
import {
  getMyLatestVerificationRequest,
  submitVerificationRequest,
  type VerificationForm,
  type VerificationLink,
  type VerificationRequest,
} from '../lib/supabase-verification';

const LINK_PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'X / Twitter', 'Website', 'Press'];

type SectionKey = 'identity' | 'professional' | 'social' | 'statement';
const SECTIONS: SectionKey[] = ['identity', 'professional', 'social', 'statement'];
const SECTION_TITLES: Record<SectionKey, string> = {
  identity: 'About you',
  professional: 'What you do',
  social: 'Where people find you',
  statement: 'Why verify you?',
};
const SECTION_SUBTITLES: Record<SectionKey, string> = {
  identity: 'Your real name and city help us confirm who you are.',
  professional: 'Your role in food — chef, critic, writer, creator, restaurateur.',
  social: 'Links that show your work and audience. Optional, but they help.',
  statement: 'A few sentences on why you should carry the verified badge.',
};

const emptyForm = (profileName: string, profileCity: string): VerificationForm => ({
  fullName: profileName,
  city: profileCity,
  occupation: '',
  affiliation: '',
  credentials: '',
  links: [{ platform: 'Instagram', url: '', followers: '' }],
  statement: '',
});

export const VerificationApply: React.FC = () => {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { phoneMode } = useSettings();

  const [existing, setExisting] = useState<VerificationRequest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<VerificationForm>(() =>
    emptyForm(profile?.display_name || '', profile?.home_city || ''));
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // Load the latest request: pending → blocked state; denied → pre-fill.
  useEffect(() => {
    if (!user?.id) { setLoaded(true); return; }
    let cancelled = false;
    void getMyLatestVerificationRequest(user.id).then((req) => {
      if (cancelled) return;
      setExisting(req);
      if (req && req.status === 'denied') {
        setForm({
          fullName: req.full_name || profile?.display_name || '',
          city: req.city || profile?.home_city || '',
          occupation: req.occupation || '',
          affiliation: req.affiliation || '',
          credentials: req.credentials || '',
          links: req.links?.length ? req.links : [{ platform: 'Instagram', url: '', followers: '' }],
          statement: req.statement || '',
        });
      }
      setLoaded(true);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const set = <K extends keyof VerificationForm>(key: K, value: VerificationForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setLink = (i: number, patch: Partial<VerificationLink>) =>
    setForm((f) => ({ ...f, links: f.links.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));

  const sectionComplete: Record<SectionKey, boolean> = useMemo(() => ({
    identity: form.fullName.trim().length > 1,
    professional: form.occupation.trim().length > 1,
    social: true, // optional
    statement: form.statement.trim().length > 19,
  }), [form]);

  const allComplete = SECTIONS.every((k) => sectionComplete[k]);

  const handleSubmit = async () => {
    if (!user?.id || submitting || !allComplete) return;
    setSubmitting(true);
    setError('');
    const res = await submitVerificationRequest(user.id, form);
    setSubmitting(false);
    if (res.success) setSubmitted(true);
    else setError(res.error || 'Something went wrong — please try again.');
  };

  /* ── Section bodies (shared by wizard + desktop form) ── */
  const sectionBody = (key: SectionKey) => {
    switch (key) {
      case 'identity':
        return (
          <div className="space-y-3">
            <div>
              <OB.FieldLabel>Full name</OB.FieldLabel>
              <OB.Field value={form.fullName} onChange={(v) => set('fullName', v)} placeholder="Jane Doe" icon={<User size={17} strokeWidth={1.6} />} autoCapitalize="words" />
            </div>
            <div>
              <OB.FieldLabel>City</OB.FieldLabel>
              <OB.Field value={form.city} onChange={(v) => set('city', v)} placeholder="New York, NY" autoCapitalize="words" />
            </div>
          </div>
        );
      case 'professional':
        return (
          <div className="space-y-3">
            <div>
              <OB.FieldLabel>Occupation / role</OB.FieldLabel>
              <OB.Field value={form.occupation} onChange={(v) => set('occupation', v)} placeholder="Head chef · Food critic · Recipe developer" icon={<Briefcase size={17} strokeWidth={1.6} />} />
            </div>
            <div>
              <OB.FieldLabel>Restaurant / publication / employer</OB.FieldLabel>
              <OB.Field value={form.affiliation} onChange={(v) => set('affiliation', v)} placeholder="Lilia · The Infatuation · Self-employed" />
            </div>
            <div>
              <OB.FieldLabel>Credentials (awards, press, notable work)</OB.FieldLabel>
              <textarea
                value={form.credentials}
                onChange={(e) => set('credentials', e.target.value)}
                placeholder="James Beard nominee 2024 · Featured in Eater NY…"
                rows={3}
                className="w-full rounded-2xl border px-4 py-3 text-[15px] focus:outline-none resize-none"
                style={{ background: 'var(--ob-field)', borderColor: OB.BORDER, color: OB.INK }}
              />
            </div>
          </div>
        );
      case 'social':
        return (
          <div className="space-y-3">
            {form.links.map((l, i) => (
              <div key={i} className="rounded-2xl border p-3 space-y-2" style={{ borderColor: OB.BORDER }}>
                <div className="flex items-center gap-2">
                  <select
                    value={l.platform}
                    onChange={(e) => setLink(i, { platform: e.target.value })}
                    className="flex-1 rounded-xl border px-3 py-2 text-sm font-medium focus:outline-none bg-transparent"
                    style={{ borderColor: OB.BORDER, color: OB.INK }}
                  >
                    {LINK_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <input
                    value={l.followers || ''}
                    onChange={(e) => setLink(i, { followers: e.target.value })}
                    placeholder="Followers (e.g. 120k)"
                    className="w-36 rounded-xl border px-3 py-2 text-sm focus:outline-none bg-transparent"
                    style={{ borderColor: OB.BORDER, color: OB.INK }}
                  />
                  {form.links.length > 1 && (
                    <button type="button" aria-label="Remove link" onClick={() => set('links', form.links.filter((_, idx) => idx !== i))}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-on-surface/40 hover:text-red-500 flex-shrink-0">
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: OB.BORDER }}>
                  <Link2 size={14} className="flex-shrink-0" style={{ color: OB.LABEL_GREY }} />
                  <input
                    value={l.url}
                    onChange={(e) => setLink(i, { url: e.target.value })}
                    placeholder="https://instagram.com/janedoe"
                    autoCapitalize="off" autoCorrect="off"
                    className="flex-1 text-sm focus:outline-none bg-transparent"
                    style={{ color: OB.INK }}
                  />
                </div>
              </div>
            ))}
            {form.links.length < 5 && (
              <button type="button" onClick={() => set('links', [...form.links, { platform: 'Website', url: '', followers: '' }])}
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: OB.TERRA }}>
                <Plus size={14} /> Add another link
              </button>
            )}
          </div>
        );
      case 'statement':
        return (
          <div className="space-y-2">
            <textarea
              value={form.statement}
              onChange={(e) => set('statement', e.target.value)}
              placeholder="Tell us why you should be verified — your role in the food world, what you publish, and why diners should trust your picks. (At least a couple of sentences.)"
              rows={6}
              autoFocus={!phoneMode}
              className="w-full rounded-2xl border px-4 py-3 text-[15px] leading-relaxed focus:outline-none resize-none"
              style={{ background: 'var(--ob-field)', borderColor: OB.BORDER, color: OB.INK }}
            />
            <p className="text-[12px]" style={{ color: OB.LABEL_GREY }}>{form.statement.trim().length}/20 characters minimum</p>
          </div>
        );
    }
  };

  /* ── Terminal / blocked states ── */
  if (!loaded) {
    return (
      <OB.OnboardingScreen>
        <div className="flex flex-1 items-center justify-center"><Loader2 size={22} className="animate-spin" style={{ color: OB.LABEL_GREY }} /></div>
      </OB.OnboardingScreen>
    );
  }

  if (profile?.is_verified) {
    return (
      <StatusShell
        icon={<VerifiedBadge size={54} />}
        title="You're already verified"
        body="Your verified badge is live. You can edit your public status line any time in Settings → Account."
        onDone={() => navigate(-1)}
      />
    );
  }

  if (submitted || existing?.status === 'pending') {
    return (
      <StatusShell
        icon={<Clock size={44} style={{ color: OB.TERRA }} />}
        title={submitted ? 'Application received' : 'Application under review'}
        body="Thanks — we look at every application personally. You'll get a message here in the app as soon as it's decided."
        onDone={() => navigate('/')}
      />
    );
  }

  /* ── Phone: wizard ── */
  if (phoneMode) {
    const key = SECTIONS[step];
    const isLast = step === SECTIONS.length - 1;
    return (
      <OB.OnboardingScreen>
        <OB.ProgressHeader step={step + 1} total={SECTIONS.length} onBack={() => (step === 0 ? navigate(-1) : setStep((s) => s - 1))} />
        <div className="flex flex-1 flex-col">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={key}
              initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-1 flex-col"
            >
              <div style={{ marginTop: 40 }}>
                <OB.Eyebrow>Verification · {SECTION_TITLES[key]}</OB.Eyebrow>
                <div style={{ marginTop: 13 }}><OB.Title size={30}>{SECTION_TITLES[key]}</OB.Title></div>
                <OB.Subtitle>{SECTION_SUBTITLES[key]}</OB.Subtitle>
              </div>
              <div style={{ marginTop: 26 }}>{sectionBody(key)}</div>
            </motion.div>
          </AnimatePresence>
          <div style={{ paddingTop: 24 }}>
            {error && <div style={{ marginBottom: 12 }}><OB.ErrorRow>{error}</OB.ErrorRow></div>}
            <OB.PrimaryButton
              onClick={() => (isLast ? void handleSubmit() : setStep((s) => s + 1))}
              loading={submitting}
              disabled={!sectionComplete[key]}
              trailing={isLast ? 'check' : 'arrow'}
            >
              {isLast ? 'Submit application' : 'Continue'}
            </OB.PrimaryButton>
          </div>
        </div>
      </OB.OnboardingScreen>
    );
  }

  /* ── Desktop: one sectioned form ── */
  return (
    <div className="min-h-screen bg-surface pb-24">
      <div className="max-w-2xl mx-auto px-6 pt-10">
        <button type="button" onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-sm text-on-surface/55 hover:text-on-surface transition-colors mb-6">
          <ArrowLeft size={15} /> Back
        </button>
        <div className="flex items-center gap-3 mb-2">
          <VerifiedBadge size={28} />
          <h1 className="font-serif font-bold text-3xl tracking-tight">Request verification</h1>
        </div>
        <p className="text-sm text-on-surface/55 mb-8 leading-relaxed">
          For chefs, critics, writers, and creators. Every application is reviewed personally —
          the more you share, the easier it is to say yes.
        </p>
        <div className="space-y-8">
          {SECTIONS.map((key, i) => (
            <section key={key} className="rounded-3xl border border-on-surface/[0.08] bg-paper p-6">
              <div className="flex items-center gap-2.5 mb-1">
                <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[12px] font-bold flex items-center justify-center">{i + 1}</span>
                <h2 className="font-serif font-bold text-[19px]">{SECTION_TITLES[key]}</h2>
              </div>
              <p className="text-[12.5px] text-on-surface/50 mb-4 ml-[34px]">{SECTION_SUBTITLES[key]}</p>
              {sectionBody(key)}
            </section>
          ))}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-xl">{error}</p>
          )}
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!allComplete || submitting}
            className="w-full py-3.5 bg-primary text-on-primary rounded-2xl text-[15px] font-semibold shadow-lg shadow-primary/25 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 size={16} className="animate-spin" />}
            <PenLine size={16} /> Submit application
          </button>
          {!allComplete && (
            <p className="text-center text-[12px] text-on-surface/40 -mt-4">
              Fill in your name, occupation, and a 20+ character statement to submit.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

/** Shared centered status screen (already verified / received / under review). */
const StatusShell: React.FC<{ icon: React.ReactNode; title: string; body: string; onDone: () => void }> = ({ icon, title, body, onDone }) => (
  <OB.OnboardingScreen glow="center">
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-1 flex-col items-center text-center" style={{ paddingTop: 60 }}
    >
      <div className="flex items-center justify-center" style={{ width: 88, height: 88, borderRadius: '50%', background: 'var(--ob-badge-bg, rgba(166,55,29,0.08))' }}>
        {icon}
      </div>
      <div style={{ marginTop: 26 }}><OB.Title>{title}</OB.Title></div>
      <p style={{ fontSize: 15.5, lineHeight: 1.55, color: OB.SECONDARY, margin: '12px 0 0', maxWidth: 300 }}>{body}</p>
      <div style={{ marginTop: 'auto', paddingTop: 34, width: '100%' }}>
        <OB.PrimaryButton onClick={onDone}>Done</OB.PrimaryButton>
      </div>
    </motion.div>
  </OB.OnboardingScreen>
);
