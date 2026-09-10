import { PhotoImage } from '../components/PhotoImage';
import React, { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePageBack } from '../lib/usePageBack';
import { FEEDBACK_FEATURES, FEEDBACK_STATUSES, FEEDBACK_TYPES, feedbackScreenshot, listFeedback, updateFeedbackStatus, type FeedbackItem, type FeedbackStatus } from '../lib/feedback';
import '../components/Feedback.css';

export function AdminFeedback() {
  const { isAdmin, adminChecked, loading } = useAuth();
  const back = usePageBack('/settings/support');
  if (loading || adminChecked === 'unknown') return <div className="feedback-empty">Checking access…</div>;
  if (!isAdmin) return <div className="feedback-empty">Page not found.</div>;
  return <FeedbackInbox onBack={back} />;
}
export function FeedbackInbox({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [feature, setFeature] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const selected = items.find(i => i.id === selectedId);
  useEffect(() => {
    let live = true; setLoading(true); setError('');
    const timer = setTimeout(() => {
      void listFeedback({ status, category, feature, search, page }).then(result => {
        if (!live) return; setItems(result.items); setTotal(result.total);
        if (page > 0 && !result.items.length) setPage(page - 1);
      }).catch(() => { if (live) { setError('Couldn’t load feedback. Try refreshing.'); setItems([]); } }).finally(() => { if (live) setLoading(false); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [status, category, feature, search, page, revision]);
  const change = (setter: (value: string) => void, value: string) => { setter(value); setPage(0); setSelectedId(null); setNotice(''); };
  const update = async (next: FeedbackStatus) => {
    if (!selected || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const saved = await updateFeedbackStatus(selected.id, next);
      setItems(rows => rows.map(row => row.id === saved.id ? saved : row));
      setNotice(`Moved to ${FEEDBACK_STATUSES[next]}.`);
      setRevision(value => value + 1);
    } catch { setError('Couldn’t update the status. Please try again.'); }
    finally { setSaving(false); }
  };
  return <main className="feedback-inbox" data-analytics-private>
    <header className="feedback-inbox-header"><button onClick={onBack} aria-label="Back to settings"><ArrowLeft size={20} /></button><div><p className="feedback-eyebrow">Listen. Improve. Repeat.</p><h1>Feedback inbox</h1><p>Ideas and observations from your community.</p></div><button className="feedback-refresh" onClick={() => setRevision(v => v + 1)} disabled={loading || saving} aria-label="Refresh feedback"><RefreshCw size={18} /></button></header>
    <div className="feedback-filters">
      <label>Search messages<input data-search-input="standalone" type="search" maxLength={200} placeholder="Find a phrase or recurring request…" value={search} onChange={e => change(setSearch, e.target.value)} /></label>
      <label>Status<select value={status} onChange={e => change(setStatus, e.target.value)}><option value="">All statuses</option>{Object.entries(FEEDBACK_STATUSES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Type<select value={category} onChange={e => change(setCategory, e.target.value)}><option value="">All types</option>{Object.entries(FEEDBACK_TYPES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Feature<select value={feature} onChange={e => change(setFeature, e.target.value)}><option value="">All features</option>{FEEDBACK_FEATURES.map(f => <option key={f}>{f}</option>)}</select></label>
    </div>
    {error && <p className="feedback-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className={`feedback-inbox-grid ${selected ? 'has-selection' : ''}`} aria-busy={loading}>
      <div className="feedback-list"><div className="feedback-queue">{loading ? <p className="feedback-empty">Loading feedback…</p> : !items.length ? <div className="feedback-empty">{search || status || category || feature ? 'No messages match these filters.' : 'Your inbox is ready. New submissions will appear here.'}</div> : items.map(item => <button className={`feedback-item ${selectedId === item.id ? 'is-selected' : ''}`} key={item.id} onClick={() => { setSelectedId(item.id); setNotice(''); }} aria-pressed={selectedId === item.id}><span className="feedback-item-head"><span>{item.feature}</span><span className="feedback-status">{FEEDBACK_STATUSES[item.status]}</span></span><p>{item.message}</p><small>{FEEDBACK_TYPES[item.category]} · {new Date(item.created_at).toLocaleDateString()}</small></button>)}</div>
        <div className="feedback-pagination"><button disabled={page === 0 || loading || saving} onClick={() => { setPage(p => p - 1); setSelectedId(null); }}>Previous</button><span>{total ? `${page * 25 + 1}–${Math.min((page + 1) * 25, total)} of ${total}` : '0 submissions'}</span><button disabled={(page + 1) * 25 >= total || loading || saving} onClick={() => { setPage(p => p + 1); setSelectedId(null); }}>Next</button></div>
      </div>
      <section className="feedback-detail" aria-label="Feedback details">{selected ? <>
        <button className="feedback-detail-close" onClick={() => setSelectedId(null)}>← All feedback</button>
        <p className="feedback-eyebrow">{FEEDBACK_TYPES[selected.category]}</p><h2>{selected.feature}</h2><small>{new Date(selected.created_at).toLocaleString()}</small>
        <p className="feedback-detail-message">{selected.message}</p>
        <label>Review status<select value={selected.status} disabled={saving || loading} onChange={e => void update(e.target.value as FeedbackStatus)}>{Object.entries(FEEDBACK_STATUSES).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <div className="feedback-detail-meta"><span>v{selected.app_version}</span><span>{selected.platform} · {selected.device_type}</span><span>{selected.browser}</span><span>Opened from {selected.source_page.replace(/_/g, ' ')}</span></div>
        <p className="feedback-contact-note">{selected.allow_contact && selected.contact_email ? <>Follow-up permitted: <a href={`mailto:${encodeURIComponent(selected.contact_email)}`}>{selected.contact_email}</a></> : 'The sender has not opted in to email follow-up.'}</p>
        <small>Account {selected.user_id}</small>
        {selected.screenshot_path && <FeedbackImage key={selected.screenshot_path} path={selected.screenshot_path} />}
      </> : <p className="feedback-empty">Select a message to read it and update its status.</p>}</section>
    </div>
  </main>;
}
const FeedbackImage: React.FC<{ path: string }> = ({ path }) => {
  const [url, setUrl] = useState(''); const [failed, setFailed] = useState(false); const [retry, setRetry] = useState(0);
  useEffect(() => { let live = true; setFailed(false); setUrl(''); void feedbackScreenshot(path).then(value => { if (live) setUrl(value); }).catch(() => { if (live) setFailed(true); }); return () => { live = false; }; }, [path, retry]);
  if (failed) return <button className="feedback-error" onClick={() => setRetry(v => v + 1)}>Screenshot unavailable. Try loading it again.</button>;
  if (!url) return <p className="feedback-context">Loading screenshot…</p>;
  return <a href={url} target="_blank" rel="noreferrer"><PhotoImage src={url} alt="Screenshot attached to this feedback" onError={() => setFailed(true)} /></a>;
}
