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
  const { isAdmin, loading: authLoading } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

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

  if (!authLoading && !isAdmin) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-6 text-center">
        <p className="text-sm font-medium text-on-surface/50">This page isn't available.</p>
        <button type="button" onClick={() => navigate('/')} className="mt-4 text-sm font-semibold text-primary">Go home</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface pb-32">
      <div className="max-w-2xl mx-auto px-4 pt-safe-5">
        {/* Header */}
        <div className="flex items-center gap-3 py-3">
          <button type="button" onClick={() => navigate(-1)} aria-label="Back"
            className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center text-on-surface/65 flex-shrink-0">
            <ArrowLeft size={16} />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <VerifiedBadge size={20} />
            <h1 className="font-serif font-bold text-[22px] leading-none truncate">Verification requests</h1>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mt-2 mb-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'px-4 h-9 rounded-full text-[13px] font-semibold transition-colors',
                tab === t.key ? 'bg-primary text-white' : 'bg-on-surface/[0.05] text-on-surface/60 hover:bg-on-surface/[0.09]',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="text-on-surface/30 animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <VerifiedBadge size={32} className="opacity-30" />
            <p className="mt-3 text-sm font-medium text-on-surface/45">
              {tab === 'pending' ? 'No pending applications' : `No ${tab} applications`}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {requests.map((r) => {
              const name = r.user_profiles?.display_name || r.full_name || 'Unknown';
              const username = r.user_profiles?.username;
              const open = expanded === r.id;
              return (
                <li key={r.id} className="rounded-2xl border border-on-surface/[0.08] bg-paper overflow-hidden">
                  {/* Card header */}
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : r.id)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-bold text-on-surface truncate">
                        {name}
                        {username && <span className="ml-1.5 font-medium text-on-surface/45">@{username}</span>}
                      </p>
                      <p className="text-[12px] text-on-surface/50 truncate mt-0.5">
                        {[r.occupation, r.affiliation].filter(Boolean).join(' · ') || 'No role given'}
                        {'  ·  '}
                        {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                    <ChevronDown size={16} className={cn('flex-shrink-0 text-on-surface/35 transition-transform', open && 'rotate-180')} />
                  </button>

                  {/* Expanded application */}
                  {open && (
                    <div className="px-4 pb-4 space-y-3 border-t border-on-surface/[0.06] pt-3">
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
                        <Link to={`/user/${username}`} className="inline-block text-[13px] font-semibold text-primary hover:underline">
                          View profile →
                        </Link>
                      )}
                      {r.status === 'denied' && r.deny_reason && (
                        <p className="text-[12.5px] text-on-surface/55">Denied with reason: “{r.deny_reason}”</p>
                      )}

                      {/* Actions — pending only */}
                      {r.status === 'pending' && (
                        denyFor === r.id ? (
                          <div className="pt-1 space-y-2">
                            <input
                              type="text"
                              value={denyReason}
                              onChange={(e) => setDenyReason(e.target.value)}
                              maxLength={140}
                              placeholder="Optional reason the applicant will see"
                              autoFocus
                              className="w-full bg-on-surface/5 rounded-xl py-2.5 px-3.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                            <div className="flex gap-2">
                              <button type="button" onClick={() => { setDenyFor(null); setDenyReason(''); }}
                                className="flex-1 py-2.5 rounded-xl border-2 border-on-surface/10 text-[13px] font-semibold text-on-surface/60">
                                Cancel
                              </button>
                              <button type="button" disabled={acting === r.id} onClick={() => void handleDeny(r.id)}
                                className="flex-[1.4] py-2.5 rounded-xl bg-red-500 text-white text-[13px] font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5">
                                {acting === r.id ? <Loader2 size={13} className="animate-spin" /> : <X size={14} />}
                                Confirm deny
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-2 pt-1">
                            <button type="button" disabled={!!acting} onClick={() => setDenyFor(r.id)}
                              className="flex-1 py-2.5 rounded-xl border-2 border-on-surface/10 text-[13px] font-semibold text-on-surface/60 hover:border-red-300 hover:text-red-500 transition-colors">
                              Deny
                            </button>
                            <button type="button" disabled={!!acting} onClick={() => void handleApprove(r.id)}
                              className="flex-[1.4] py-2.5 rounded-xl bg-primary text-white text-[13px] font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5">
                              {acting === r.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
                              Approve
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
