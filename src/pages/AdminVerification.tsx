import { usePageBack } from '../lib/usePageBack';
/**
 * Admin verification review — /admin/verification.
 *
 * Owner-only queue of verification applications: pending / approved /
 * denied tabs, expandable cards with every application field, Approve and
 * Deny (with an optional one-line reason). The page renders a not-found
 * state for non-admins; the real enforcement is server-side (RLS read
 * policy + is_app_admin() checks inside the approve/deny RPCs).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, Loader2, Link2, MapPin, Briefcase, Award, Check, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { GlassButton } from '../lib/glass-buttons';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { VerifiedBadge } from '../components/VerifiedBadge';
import {
  adminListVerificationRequests,
  approveVerificationRequest,
  denyVerificationRequest,
  type AdminVerificationRequest,
  type VerificationStatus,
} from '../lib/supabase-verification';

const TABS: { key: VerificationStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'denied', label: 'Denied' },
];

export const AdminVerification: React.FC = () => {
  const { isAdmin, adminChecked, loading: authLoading } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const goBack = usePageBack('/settings');

  const [tab, setTab] = useState<VerificationStatus>('pending');
  const [requests, setRequests] = useState<AdminVerificationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Per-request in-flight + deny-reason UI state
  const [acting, setActing] = useState<string | null>(null);
  const [denyFor, setDenyFor] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState('');

  const load = useCallback(async (status: VerificationStatus) => {
    setLoading(true);
    const rows = await adminListVerificationRequests(status);
    setRequests(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isAdmin) void load(tab);
  }, [isAdmin, tab, load]);

  const handleApprove = async (id: string) => {
    if (acting) return;
    setActing(id);
    const res = await approveVerificationRequest(id);
    setActing(null);
    if (res.success) {
      showToast('Approved — they’re verified now', { variant: 'success' });
      void load(tab);
    } else {
      showToast(res.error || 'Approve failed');
    }
  };

  const handleDeny = async (id: string) => {
    if (acting) return;
    setActing(id);
    const res = await denyVerificationRequest(id, denyReason.trim() || undefined);
    setActing(null);
    setDenyFor(null);
    setDenyReason('');
    if (res.success) {
      showToast('Request denied');
      void load(tab);
    } else {
      showToast(res.error || 'Deny failed');
    }
  };

  // The allowlist probe resolves asynchronously AFTER the profile loads —
  // gating on !isAdmin alone flashed this screen at genuine admins on slow
  // networks. Spin while 'unknown'; not-found only when definitively false.
  if (authLoading || adminChecked === 'unknown') {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 size={22} className="text-primary animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-6 text-center">
        <p className="text-sm font-medium text-on-surface/50">This page isn't available.</p>
        <button type="button" onClick={() => navigate('/')} className="mt-4 text-sm font-semibold text-primary">Go home</button>
      </div>
    );
  }

  // Presentation-only role tag the reference design wears on each row —
  // derived from the free-text occupation, never stored.
  const roleTag = (occupation?: string | null): string => {
    const o = (occupation || '').toLowerCase();
    if (o.includes('chef') || o.includes('cook')) return 'chef';
    if (o.includes('critic') || o.includes('writer') || o.includes('journalist') || o.includes('editor')) return 'critic';
    return 'creator';
  };

  return (
    <div className="min-h-screen bg-surface pb-32">
      <div className="sticky top-0 z-20 bg-surface/95 backdrop-blur border-b border-on-surface/[0.08]">
        <div className="max-w-2xl mx-auto px-5 pt-safe-4 pb-3.5 flex items-center gap-3">
          <GlassButton
            id="admin-verif-back"
            symbol="chevron.left"
            label="Back"
            onClick={() => goBack()}
            className="hit-44 flex-none w-11 h-11 -ml-1 rounded-full flex items-center justify-center text-on-surface bg-on-surface/[0.05] active:scale-95 transition-transform"
          >
            <ArrowLeft size={18} />
          </GlassButton>
          <h1 className="flex-1 min-w-0 font-serif font-bold text-[19px] leading-tight tracking-[-0.025em] truncate">Verification requests</h1>
          <VerifiedBadge size={19} />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-5">
        {/* Tabs — ink pill for the active state, outlined for the rest. */}
        <div className="flex gap-2 pt-4 overflow-x-auto no-scrollbar">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'flex-none px-4 py-2.5 rounded-full text-[12.5px] font-bold border transition-colors',
                tab === t.key
                  ? 'bg-on-surface text-surface border-on-surface'
                  : 'bg-transparent text-on-surface border-on-surface/20 active:bg-on-surface/[0.06]',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="text-on-surface/30 animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2.5 text-center">
            <span className="w-[46px] h-[46px] rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Check size={21} strokeWidth={2.1} />
            </span>
            <p className="font-serif font-bold text-[14.5px] tracking-[-0.02em] text-on-surface">
              No {tab} applications
            </p>
          </div>
        ) : (
          <ul>
            {requests.map((r, idx) => {
              const name = r.user_profiles?.display_name || r.full_name || 'Unknown';
              const username = r.user_profiles?.username;
              const open = expanded === r.id;
              const tag = roleTag(r.occupation);
              return (
                <li key={r.id} className={cn(idx > 0 && 'border-t border-on-surface/[0.08]')}>
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : r.id)}
                    className="w-full flex items-start gap-3 py-4 text-left active:opacity-70 transition-opacity"
                  >
                    <span className="flex-none w-10 h-10 rounded-full bg-on-surface/[0.07] text-on-surface/70 flex items-center justify-center font-serif font-bold text-[15px]">
                      {(name[0] || '?').toUpperCase()}
                    </span>
                    <span className="flex-1 min-w-0 block">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="font-serif font-bold text-[15px] leading-tight tracking-[-0.02em] text-on-surface truncate">{name}</span>
                        <span className={cn(
                          'flex-none rounded-full px-2 py-[5px] text-[9.5px] font-bold uppercase tracking-[0.1em]',
                          tag === 'chef' ? 'bg-primary/10 text-primary' : 'bg-on-surface/[0.06] text-on-surface/70',
                        )}>
                          {tag}
                        </span>
                      </span>
                      <span className="block mt-1.5 text-[12.5px] leading-snug text-on-surface/55 truncate">
                        {[r.occupation, r.affiliation].filter(Boolean).join(', ') || 'No role given'}
                        {username ? ` · @${username}` : ''}
                      </span>
                      <span className="block mt-1.5 text-[11.5px] text-on-surface/40">
                        Applied {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {(r.links?.filter((l) => l.url).length || 0) > 0
                          ? ` · ${r.links.filter((l) => l.url).length} proof${r.links.filter((l) => l.url).length === 1 ? '' : 's'}`
                          : ''}
                      </span>
                    </span>
                    <ChevronDown size={16} className={cn('flex-none mt-3 text-on-surface/35 transition-transform', open && 'rotate-180')} />
                  </button>

                  {/* Expanded application */}
                  {open && (
                    <div className="pb-5 pl-[52px] space-y-3">
                      <DetailRow icon={<MapPin size={13} />} label="City" value={r.city} />
                      <DetailRow icon={<Briefcase size={13} />} label="Occupation" value={r.occupation} />
                      <DetailRow icon={<Briefcase size={13} />} label="Affiliation" value={r.affiliation} />
                      <DetailRow icon={<Award size={13} />} label="Credentials" value={r.credentials} multiline />
                      {r.links?.filter((l) => l.url).length > 0 && (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Links</p>
                          <div className="space-y-1.5">
                            {r.links.filter((l) => l.url).map((l, i) => (
                              <a key={i} href={/^https?:\/\//.test(l.url) ? l.url : `https://${l.url}`}
                                target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-2 text-[13px] font-medium text-primary hover:underline break-all">
                                <Link2 size={12} className="flex-shrink-0" />
                                <span className="truncate">{l.platform}{l.followers ? ` · ${l.followers}` : ''} — {l.url}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                      <DetailRow label="Statement" value={r.statement} multiline />
                      {username && (
                        <Link to={`/user/${username}`} className="inline-block text-[13px] font-bold text-primary">
                          View profile →
                        </Link>
                      )}
                      {r.status === 'denied' && r.deny_reason && (
                        <p className="text-[12.5px] text-on-surface/55">Denied with reason: “{r.deny_reason}”</p>
                      )}

                      {/* Actions — pending only */}
                      {r.status === 'pending' && (
                        denyFor === r.id ? (
                          <div className="pt-1 space-y-2.5">
                            <input
                              type="text"
                              value={denyReason}
                              onChange={(e) => setDenyReason(e.target.value)}
                              maxLength={140}
                              placeholder="Optional reason the applicant will see"
                              autoFocus
                              className="w-full rounded-2xl border border-on-surface/[0.14] bg-on-surface/[0.035] py-3 px-4 text-[14px] font-medium focus:outline-none placeholder:text-on-surface/30"
                            />
                            <div className="flex gap-2">
                              <button type="button" onClick={() => { setDenyFor(null); setDenyReason(''); }}
                                className="flex-none px-4 py-2.5 rounded-full border border-on-surface/20 text-[12.5px] font-bold text-on-surface active:bg-on-surface/[0.06]">
                                Cancel
                              </button>
                              <button type="button" disabled={acting === r.id} onClick={() => void handleDeny(r.id)}
                                className="flex-none px-4 py-2.5 rounded-full bg-red-600 text-white text-[12.5px] font-bold disabled:opacity-50 flex items-center justify-center gap-1.5 active:opacity-85">
                                {acting === r.id ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                                Confirm deny
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-2 pt-1">
                            <button type="button" disabled={!!acting} onClick={() => void handleApprove(r.id)}
                              className="flex-none px-4 py-2.5 rounded-full bg-on-surface text-surface text-[12.5px] font-bold disabled:opacity-50 flex items-center justify-center gap-1.5 active:opacity-85">
                              {acting === r.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                              Approve
                            </button>
                            <button type="button" disabled={!!acting} onClick={() => setDenyFor(r.id)}
                              className="flex-none px-4 py-2.5 rounded-full border border-on-surface/20 text-[12.5px] font-bold text-on-surface active:bg-on-surface/[0.06] transition-colors">
                              Deny
                            </button>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

const DetailRow: React.FC<{ icon?: React.ReactNode; label: string; value?: string; multiline?: boolean }> = ({ icon, label, value, multiline }) => {
  if (!value?.trim()) return null;
  return (
    <div>
      <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1">
        {icon}{label}
      </p>
      <p className={cn('text-[13.5px] text-on-surface/80', multiline ? 'whitespace-pre-wrap leading-relaxed' : 'truncate')}>{value}</p>
    </div>
  );
};
