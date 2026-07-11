/**
 * App-global verification outcome surface (mounted once in App.tsx).
 *
 * On profile load it checks the user's latest verification request:
 *   approved + !acknowledged → congratulations + MANDATORY status-line
 *     picker (the only dismiss path is saving a line, which acknowledges
 *     the request and refreshes the profile).
 *   denied + !acknowledged   → the outcome message with the reviewer's
 *     optional reason; "Apply again" or "Dismiss" (both acknowledge).
 *   grandfathered verified (no request row, no status line) → the same
 *     picker with softer copy, dismissible with "Later" (re-prompts next
 *     app open until a line is set).
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { VerifiedBadge } from './VerifiedBadge';
import { VerifiedStatusPicker } from './VerifiedStatusPicker';
import {
  getMyLatestVerificationRequest,
  acknowledgeVerificationRequest,
  type VerificationRequest,
} from '../lib/supabase-verification';

type Outcome =
  | { kind: 'approved'; request: VerificationRequest }
  | { kind: 'denied'; request: VerificationRequest }
  | { kind: 'grandfathered' };

export const VerificationOutcomeModal: React.FC = () => {
  const { user, profile, isGuest, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const checkedForUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id || !profile || isGuest) return;
    if (checkedForUserRef.current === user.id) return;
    checkedForUserRef.current = user.id;
    let cancelled = false;
    void getMyLatestVerificationRequest(user.id).then((req) => {
      if (cancelled) return;
      if (req && !req.acknowledged && (req.status === 'approved' || req.status === 'denied')) {
        setOutcome({ kind: req.status, request: req } as Outcome);
      } else if (profile.is_verified && !profile.verified_status) {
        // Grandfathered (or acknowledged approval that never finished the
        // picker) — nudge until a status line exists.
        setOutcome({ kind: 'grandfathered' });
      }
    });
    return () => { cancelled = true; };
  }, [user?.id, profile, isGuest]);

  // The approved profile may not be refreshed yet when the modal opens;
  // is_verified flips server-side at approval so the picker save is valid.
  if (!outcome || !user?.id) return null;

  const close = () => setOutcome(null);

  const finishPick = async (requestId?: string) => {
    if (requestId) await acknowledgeVerificationRequest(requestId);
    await refreshProfile();
    close();
  };

  const dismissDenied = async (reapply: boolean) => {
    if (outcome.kind === 'denied') {
      await acknowledgeVerificationRequest(outcome.request.id);
    }
    close();
    if (reapply) navigate('/verify/apply');
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[130] bg-black/55 backdrop-blur-sm flex items-center justify-center px-5"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md rounded-[28px] bg-surface p-6 pt-8 shadow-[0_30px_80px_-16px_rgba(0,0,0,0.45)] max-h-[85vh] overflow-y-auto"
        >
          {outcome.kind === 'denied' ? (
            <>
              <h2 className="font-serif font-bold text-[22px] leading-tight">
                About your verification request
              </h2>
              <p className="mt-2.5 text-[14px] leading-relaxed text-on-surface/65">
                We weren't able to approve your request this time.
              </p>
              {outcome.request.deny_reason && (
                <p className="mt-3 rounded-xl bg-on-surface/[0.04] px-3.5 py-3 text-[13.5px] leading-relaxed text-on-surface/75">
                  “{outcome.request.deny_reason}”
                </p>
              )}
              <p className="mt-3 text-[13px] leading-relaxed text-on-surface/50">
                You're welcome to apply again — adding more detail about your
                work and links to what you publish helps.
              </p>
              <div className="mt-6 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => void dismissDenied(false)}
                  className="flex-1 py-3 rounded-2xl border-2 border-on-surface/10 text-sm font-semibold text-on-surface/60"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  onClick={() => void dismissDenied(true)}
                  className="flex-[1.4] py-3 rounded-2xl bg-primary text-white text-sm font-semibold"
                >
                  Apply again
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-primary/[0.08] flex items-center justify-center">
                  <VerifiedBadge size={38} />
                </div>
              </div>
              <h2 className="mt-4 text-center font-serif font-bold text-[22px] leading-tight">
                {outcome.kind === 'approved' ? "You're verified!" : 'Add your verified status'}
              </h2>
              <p className="mt-2 text-center text-[14px] leading-relaxed text-on-surface/65">
                {outcome.kind === 'approved'
                  ? 'Your application was approved — the badge is now on your profile. One last thing: add the one-line status everyone will see.'
                  : 'Your account carries the verified badge. Add the one-line status shown to everyone on your profile.'}
              </p>
              <div className="mt-5">
                <VerifiedStatusPicker
                  userId={user.id}
                  initialValue={profile?.verified_status}
                  saveLabel={outcome.kind === 'approved' ? 'Save & show my badge' : 'Save status'}
                  onSaved={() => void finishPick(outcome.kind === 'approved' ? outcome.request.id : undefined)}
                />
              </div>
              {outcome.kind === 'grandfathered' && (
                <button
                  type="button"
                  onClick={close}
                  className="mt-3 w-full py-2 text-[13px] font-semibold text-on-surface/45 hover:text-on-surface/70"
                >
                  Later
                </button>
              )}
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
