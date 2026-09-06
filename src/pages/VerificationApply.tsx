/** A focused verification application with the shared Settings shell. */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
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

import { GlassButton } from '../lib/glass-buttons';
import { usePageBack } from '../lib/usePageBack';
import './SettingsPage.css';

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
  const back = usePageBack('/settings/verification');
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
    try {
      const res = await submitVerificationRequest(user.id, form);
      if (res.success) setSubmitted(true);
      else setError(res.error || 'Couldn’t submit. Please try again.');
    } catch { setError('Couldn’t submit. Please try again.'); }
    finally { setSubmitting(false); }
  };

  /* ── Section bodies (shared by wizard + desktop form) ── */
  const sectionBody = (key: SectionKey) => {
    switch (key) {
      case 'identity':
        return (
          <div className="space-y-3">
            <div>
              <OB.FieldLabel>Full name</OB.FieldLabel>
              <OB.Field value={form.fullName} onChange={(v) => set('fullName', v)} placeholder="Jane Doe" icon={<User size={17} strokeWidth={1.6} />} name="Full name" autoCapitalize="words" />
            </div>
            <div>
              <OB.FieldLabel>City</OB.FieldLabel>
              <OB.Field value={form.city} onChange={(v) => set('city', v)} placeholder="New York, NY" name="City" autoCapitalize="words" />
            </div>
          </div>
        );
      case 'professional':
        return (
          <div className="space-y-3">
            <div>
              <OB.FieldLabel>Occupation / role</OB.FieldLabel>
              <OB.Field value={form.occupation} onChange={(v) => set('occupation', v)} name="Occupation" placeholder="Head chef · Food critic · Recipe developer" icon={<Briefcase size={17} strokeWidth={1.6} />} />
            </div>
            <div>
              <OB.FieldLabel>Restaurant / publication / employer</OB.FieldLabel>
              <OB.Field value={form.affiliation} onChange={(v) => set('affiliation', v)} name="Affiliation" placeholder="Lilia · The Infatuation · Self-employed" />
            </div>
            <div>
              <OB.FieldLabel>Credentials (awards, press, notable work)</OB.FieldLabel>
              <textarea
                aria-label="Credentials" value={form.credentials}
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
                    aria-label="Platform" value={l.platform}
                    onChange={(e) => setLink(i, { platform: e.target.value })}
                    className="flex-1 rounded-xl border px-3 py-2 text-sm font-medium focus:outline-none bg-transparent"
                    style={{ borderColor: OB.BORDER, color: OB.INK }}
                  >
                    {LINK_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <input
                    aria-label="Followers" value={l.followers || ''}
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
                    aria-label="Profile link" value={l.url}
                    onChange={(e) => setLink(i, { url: e.target.value })}
                    placeholder="https://instagram.com/janedoe"
                    autoCapitalize="off" autoCorrect="off"
                    className="flex-1 min-w-0 text-sm focus:outline-none bg-transparent"
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
              aria-label="Why you should be verified" value={form.statement}
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

  const key = SECTIONS[step];
  const isLast = step === SECTIONS.length - 1;
  const status = profile?.is_verified ? 'verified' : submitted || existing?.status === 'pending' ? 'pending' : null;
  return <MotionConfig reducedMotion="user"><div className="settings-design settings-verification">
    <header className="settings-header"><GlassButton id="verification-back" className="settings-back" symbol="chevron.left" label="Back" onClick={() => !status && step > 0 ? setStep(s => s - 1) : back()}><ArrowLeft size={22} /></GlassButton><h1>Verification</h1></header>
    <main className="settings-scroll"><div className="settings-content">
      {!loaded ? <div className="settings-empty" role="status"><Loader2 className="animate-spin" /><p>Loading application…</p></div> : status ? <div className="settings-verification-status">
        {status === 'verified' ? <VerifiedBadge size={48} /> : <Clock size={40} />}
        <h2>{status === 'verified' ? 'You’re verified' : submitted ? 'Application received' : 'Under review'}</h2>
        <p>{status === 'verified' ? 'Your badge is live. Manage your public status in Verification settings.' : 'We’ll notify you in the app when your application has been reviewed.'}</p>
        <button className="settings-primary" onClick={back}>Done</button>
      </div> : <>
        <div className="settings-steps" aria-label={`Step ${step + 1} of 4`}>{SECTIONS.map((s, i) => <span key={s} data-active={i <= step} />)}</div>
        <AnimatePresence mode="wait" initial={false}><motion.section key={key} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: .2 }}>
          <p className="settings-note">Step {step + 1} of 4</p><h2 className="settings-title">{SECTION_TITLES[key]}</h2><p className="settings-intro">{SECTION_SUBTITLES[key]}</p>
          <div className="settings-verification-fields">{sectionBody(key)}</div>
        </motion.section></AnimatePresence>
        <div className="settings-verification-footer">{error && <p role="alert" className="text-red-500 text-sm mb-3">{error}</p>}<button className="settings-primary" disabled={submitting || !sectionComplete[key]} onClick={() => isLast ? void handleSubmit() : setStep(s => s + 1)}>{submitting ? 'Submitting…' : isLast ? 'Submit application' : 'Continue'}</button></div>
      </>}
    </div></main>
  </div></MotionConfig>;
};
