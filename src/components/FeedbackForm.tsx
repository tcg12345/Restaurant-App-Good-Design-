import { PhotoImage } from './PhotoImage';
import React, { useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, Lightbulb, MessageSquare, Send, Wrench, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { FEEDBACK_FEATURES, FEEDBACK_TYPES, submitFeedback, validateScreenshot, type FeedbackDraft, type FeedbackType } from '../lib/feedback';
import pkg from '../../package.json';
import './Feedback.css';

type Context = Pick<FeedbackDraft, 'user_id' | 'platform' | 'device_type' | 'app_version' | 'browser' | 'source_page'>;
const icons = { problem: Wrench, feedback: MessageSquare, suggestion: Lightbulb, other: MessageSquare };
export function FeedbackForm() {
  const { user } = useAuth();
  const { isNative, phoneMode } = useSettings();
  const ua = navigator.userAgent;
  const browser = isNative ? 'iOS app' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  if (!user) return <p>Sign in to send feedback.</p>;
  return <FeedbackComposer key={user.id} email={user.email || ''} context={{ user_id: user.id, platform: isNative ? 'ios' : 'web', device_type: phoneMode ? (window.innerWidth >= 600 ? 'tablet' : 'phone') : 'desktop', app_version: pkg.version, browser, source_page: 'settings' }} onSubmit={submitFeedback} />;
}

export const FeedbackComposer: React.FC<{ email?: string; context: Context; onSubmit: typeof submitFeedback }> = ({ email = '', context, onSubmit }) => {
  const [category, setCategory] = useState<FeedbackType>('feedback');
  const [feature, setFeature] = useState('General');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState(false);
  const [contactEmail, setContactEmail] = useState(email);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState<FeedbackDraft | null>(null);
  const lock = useRef(false);
  const success = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => { if (sent) success.current?.focus(); }, [sent]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    if (message.trim().length < 10) { setError('Tell us a little more—at least 10 characters.'); return; }
    const draft = pending || { ...context, id: crypto.randomUUID(), category, feature, message: message.trim(), allow_contact: contact, contact_email: contact ? contactEmail.trim() : null };
    lock.current = true; setBusy(true); setError(''); setPending(draft);
    try { await onSubmit(draft, file); setSent(true); setFile(null); }
    catch (err) {
      const code = (err as { code?: string })?.code;
      setError(code === 'P0001' ? 'You’ve sent several messages recently. Please try again in an hour.' : 'We couldn’t confirm your submission. Your message is still here; retry to check and send it safely.');
    } finally { lock.current = false; setBusy(false); }
  };
  if (sent) return <section className="feedback-success" data-analytics-private>
    <span className="feedback-mark"><Check size={28} /></span>
    <p className="feedback-eyebrow">Message received</p>
    <h2 ref={success} tabIndex={-1}>Thanks for helping GoodEats grow.</h2>
    <p>Your feedback is in our review inbox.{contact ? ' You’ve given us permission to follow up at your email address.' : ''}</p>
    <button className="feedback-primary" onClick={() => { setSent(false); setMessage(''); setPending(null); setError(''); }}>Send another message</button>
  </section>;
  return <div className="feedback-form" data-analytics-private>
    <div className="feedback-intro"><span className="feedback-mark"><MessageSquare size={25} /></span><div><p className="feedback-eyebrow">A better GoodEats, together</p><h2>What’s on your mind?</h2><p>A rough edge, a small improvement, or your next big idea. We’re listening.</p></div></div>
    <form onSubmit={submit}>
      <fieldset disabled={busy || !!pending}>
        <legend>What would you like to share?</legend>
        <div className="feedback-types">{Object.entries(FEEDBACK_TYPES).map(([key, title]) => {
          const Icon = icons[key as FeedbackType];
          return <label key={key} className={category === key ? 'is-selected' : ''}><input type="radio" name="feedback-type" value={key} checked={category === key} onChange={() => setCategory(key as FeedbackType)} /><Icon size={19} /><span>{title}</span></label>;
        })}</div>
        <label className="feedback-field">Feature or area<select value={feature} onChange={e => setFeature(e.target.value)}>{FEEDBACK_FEATURES.map(f => <option key={f}>{f}</option>)}</select></label>
        <label className="feedback-field">Your message<textarea required minLength={10} maxLength={5000} rows={6} value={message} onChange={e => setMessage(e.target.value)} placeholder={category === 'problem' ? 'What were you trying to do? What happened, and what did you expect?' : 'Tell us what works, what could be better, or what you’d love to see.'} /></label>
        <div className="feedback-hint"><span>Only you and the GoodEats team can view your submission.</span><span>{message.length.toLocaleString()} / 5,000</span></div>
        <div className="feedback-attachment"><label className="feedback-upload"><ImagePlus size={20} /><span>{file ? 'Change screenshot' : 'Add a screenshot'}<small>Optional · PNG, JPEG, WebP · up to 5 MB</small></span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const next = e.target.files?.[0]; if (!next) return; const invalid = validateScreenshot(next); setError(invalid || ''); if (!invalid) setFile(next); e.target.value = ''; }} /></label>
          {file && <div className="feedback-preview"><PhotoImage src={preview} alt="Your screenshot attachment" /><span>{file.name}</span><button type="button" aria-label="Remove screenshot" onClick={() => setFile(null)}><X size={18} /></button></div>}
        </div>
        <label className="feedback-contact"><input type="checkbox" checked={contact} onChange={e => setContact(e.target.checked)} /><span>You can contact me about this<small>We’ll use your email only to follow up on this feedback.</small></span></label>
        {contact && <label className="feedback-field">Contact email<input type="email" required maxLength={254} value={contactEmail} onChange={e => setContactEmail(e.target.value)} autoComplete="email" /></label>}
      </fieldset>
      <p className="feedback-context">Included to help us troubleshoot: app version {context.app_version}, {context.browser}, {context.device_type}, and the Settings page.</p>
      {error && <p className="feedback-error" role="alert">{error}</p>}
      <button className="feedback-primary" type="submit" disabled={busy}>{busy ? 'Sending…' : pending ? 'Retry submission' : 'Send feedback'}<Send size={17} /></button>
    </form>
  </div>;
}
