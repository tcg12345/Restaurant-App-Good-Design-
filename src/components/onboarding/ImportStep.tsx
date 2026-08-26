import React, { useCallback, useRef, useState } from 'react';
import { Check, FileUp, Images, Loader2 } from 'lucide-react';
import * as OB from './OnboardingKit';
import { useLists } from '../../contexts/ListsContext';
import { loadLastSelectedLocation } from '../HomeLocationBar';
import {
  parseImportFile, readCapturesToRows, runRestaurantImport,
  looksLikeFivePointScale, scaleToTen, clampScore,
  type ParsedRestaurant, type ImportRow, type ImportSummary,
} from '../../lib/restaurant-import';

/**
 * "Bring your ratings with you" — the import step of the signup wizard.
 *
 * The same engine the Settings page runs (lib/restaurant-import), wearing
 * the onboarding kit instead of the app's surface palette. It is the
 * highest-leverage screen in the flow: one action fills the two tabs that
 * are otherwise empty on day one, and opens the recommendation ramp on
 * REAL ratings rather than stated priors.
 *
 * The state lives in a hook the wizard calls, not in the step body, and
 * that placement is load-bearing — see useOnboardingImport.
 */

export type ImportPhase = 'choose' | 'reading' | 'review' | 'running' | 'done';

export interface OnboardingImportState {
  phase: ImportPhase;
  rows: ImportRow[];
  label: string;
  error: string;
  stage: string;
  scalePrompt: boolean;
  summary: ImportSummary | null;
  /** Ratings this step actually created or corrected. Drives the branch
   *  that skips the manual rate step — wishlist-only imports don't count,
   *  because the user still has no scores and the rate step is what
   *  teaches the ladder. */
  ratedCount: number;
  pickCaptures: (files: File[]) => void;
  pickFile: (file: File) => void;
  applyScale: (double: boolean) => void;
  start: () => void;
}

/**
 * Owns the import for the wizard.
 *
 * ProfileSetup calls this, NOT the step body, because wizard steps render
 * inside an AnimatePresence and unmount on navigation — a resolve loop
 * owned by the body would keep running with its setState calls going
 * nowhere, and the user would return to a blank step with ratings
 * appearing from somewhere.
 *
 * Hoisting also makes background completion correct: ListsProvider sits
 * above the profile-setup branch in App, so a run still in flight when the
 * wizard finishes keeps landing its rateRestaurant calls.
 */
export function useOnboardingImport(
  homeBias: { lat: number; lng: number } | null,
): OnboardingImportState {
  const { ratings, wishlist, rateRestaurant, addToWishlist, cacheRestaurantMeta } = useLists();
  const [phase, setPhase] = useState<ImportPhase>('choose');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [stage, setStage] = useState('');
  const [scalePrompt, setScalePrompt] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [ratedCount, setRatedCount] = useState(0);

  // The loop reads context actions through a ref so a re-render mid-run
  // can't strand it on a stale closure.
  const depsRef = useRef({ ratings, wishlist, rateRestaurant, addToWishlist, cacheRestaurantMeta });
  depsRef.current = { ratings, wishlist, rateRestaurant, addToWishlist, cacheRestaurantMeta };

  const accept = useCallback((parsed: ParsedRestaurant[], from: string) => {
    setRows(parsed.map((r) => ({ restaurant: r, status: 'pending' as const })));
    setLabel(from);
    setScalePrompt(looksLikeFivePointScale(parsed));
    setPhase('review');
  }, []);

  const pickCaptures = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setError('');
    setStage('');
    setPhase('reading');
    void readCapturesToRows(files, { onStage: setStage }).then((res) => {
      setStage('');
      if (res.ok === false) {
        if (res.error) setError(res.error);
        setPhase('choose');
        return;
      }
      accept(res.rows, res.label);
    });
  }, [accept]);

  const pickFile = useCallback((file: File) => {
    setError('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const { rows: parsed, error: err } = parseImportFile(file.name, ev.target?.result as string);
      if (err) { setError(err); return; }
      accept(parsed, file.name);
    };
    reader.readAsText(file);
  }, [accept]);

  const applyScale = useCallback((double: boolean) => {
    setScalePrompt(false);
    if (!double) return;
    setRows((prev) => {
      const scaled = scaleToTen(prev.map((r) => r.restaurant));
      return prev.map((item, i) => ({ ...item, restaurant: scaled[i] }));
    });
  }, []);

  const start = useCallback(() => {
    setPhase('running');
    const d = depsRef.current;
    void runRestaurantImport(rows.map((r) => r.restaurant), {
      rateRestaurant: (r, o) => depsRef.current.rateRestaurant(r, o),
      addToWishlist: (w) => depsRef.current.addToWishlist(w),
      cacheRestaurantMeta: (m) => depsRef.current.cacheRestaurantMeta(m),
      existingRatings: d.ratings,
      existingWishlistIds: d.wishlist.map((w) => w.restaurantId),
      homeBias,
      silent: true,
      onRow: (i, patch) => setRows((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], ...patch };
        return next;
      }),
    }).then((s) => {
      setSummary(s);
      setRatedCount(s.rated + s.updated);
      setPhase('done');
    });
  }, [rows, homeBias]);

  return {
    phase, rows, label, error, stage, scalePrompt, summary, ratedCount,
    pickCaptures, pickFile, applyScale, start,
  };
}

/** Tap-to-act card in the wizard's language — RadioCard's shape without
 *  the radio, since these open a picker rather than select a value. */
const RouteCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  filled?: boolean;
  onClick: () => void;
}> = ({ icon, title, description, filled, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full flex items-center gap-3.5 rounded-2xl text-left active:opacity-85 transition-opacity"
    style={{
      padding: '14px 16px',
      background: filled ? OB.TERRA : 'var(--ob-card)',
      border: filled ? '1.5px solid transparent' : '1.5px solid var(--ob-border)',
    }}
  >
    <span
      className="flex-none flex items-center justify-center rounded-full"
      style={{
        width: 38, height: 38,
        background: filled ? 'rgba(255,255,255,0.18)' : 'color-mix(in srgb, var(--ob-terra) 10%, transparent)',
        color: filled ? '#fff' : OB.TERRA,
      }}
    >
      {icon}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block" style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', color: filled ? '#fff' : 'var(--ob-ink)' }}>
        {title}
      </span>
      <span className="block" style={{ fontSize: 12.5, marginTop: 2, lineHeight: 1.35, color: filled ? 'rgba(255,255,255,0.8)' : 'var(--ob-label)' }}>
        {description}
      </span>
    </span>
  </button>
);

/** Rows shown before importing. Capped, because the wizard's footer sits in
 *  normal flow — a hundred-row list would push the primary button below a
 *  very long scroll. */
const PREVIEW_LIMIT = 8;

export const ImportStep: React.FC<{ state: OnboardingImportState }> = ({ state }) => {
  const captureRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col">
      <input
        ref={captureRef} type="file" accept="image/*,video/*" multiple className="hidden"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files as ArrayLike<File>) : [];
          e.target.value = '';
          state.pickCaptures(files);
        }}
      />
      <input
        ref={fileRef} type="file" accept=".csv,.json,.txt" className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) state.pickFile(f);
        }}
      />

      {state.phase === 'choose' && (
        <div className="flex flex-col gap-2.5">
          <RouteCard
            filled
            icon={<Images size={18} strokeWidth={1.9} />}
            title="Screenshots or a recording"
            description="We'll read every place and every score."
            onClick={() => captureRef.current?.click()}
          />
          <RouteCard
            icon={<FileUp size={18} strokeWidth={1.9} />}
            title="Upload a CSV"
            description="Or JSON — anything with a name column."
            onClick={() => fileRef.current?.click()}
          />
          {state.error && <OB.ErrorRow>{state.error}</OB.ErrorRow>}
          <p style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--ob-label)', marginTop: 4 }}>
            You can bring a list over any time from Settings.
          </p>
        </div>
      )}

      {state.phase === 'reading' && (
        <div className="flex flex-col items-center text-center" style={{ paddingTop: 24 }}>
          <Loader2 size={26} className="animate-spin" style={{ color: OB.TERRA }} />
          <p style={{ fontSize: 15, fontWeight: 600, marginTop: 16, color: 'var(--ob-ink)' }}>
            Reading your list…
          </p>
          <p style={{ fontSize: 13, marginTop: 6, color: 'var(--ob-label)', minHeight: 18 }}>
            {state.stage || 'This takes a few seconds.'}
          </p>
        </div>
      )}

      {(state.phase === 'review' || state.phase === 'running') && (
        <div className="flex flex-col">
          <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--ob-ink)' }}>
            {state.rows.length} restaurant{state.rows.length === 1 ? '' : 's'} found
          </p>
          <p style={{ fontSize: 12.5, marginTop: 3, color: 'var(--ob-label)' }}>From {state.label}</p>

          {/* A Beli 4.3 imported as 4.3/10 would put the user's whole ladder
              at half value, and imports skip the settle so nothing
              downstream ever regrids it. This prompt is the only chance to
              catch it. */}
          {state.scalePrompt && state.phase === 'review' && (
            <div className="rounded-2xl" style={{ marginTop: 14, padding: '14px 16px', background: 'var(--ob-card)', border: `1.5px solid ${OB.TERRA}` }}>
              <p style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--ob-ink)' }}>
                These look like scores out of 5. Double them to match this app's 10-point scale?
              </p>
              <div className="flex gap-2" style={{ marginTop: 10 }}>
                <button
                  type="button" onClick={() => state.applyScale(true)}
                  className="rounded-full text-white" style={{ padding: '0 16px', height: 34, fontSize: 12.5, fontWeight: 700, background: OB.TERRA }}
                >Double to /10</button>
                <button
                  type="button" onClick={() => state.applyScale(false)}
                  className="rounded-full" style={{ padding: '0 16px', height: 34, fontSize: 12.5, fontWeight: 600, background: 'var(--ob-card)', border: '1.5px solid var(--ob-border)', color: 'var(--ob-ink)' }}
                >Keep as-is</button>
              </div>
            </div>
          )}

          <ul className="flex flex-col gap-2" style={{ marginTop: 14 }}>
            {state.rows.slice(0, PREVIEW_LIMIT).map((row, i) => (
              <li
                key={`${row.restaurant.name}-${i}`}
                className="flex items-center gap-3 rounded-2xl"
                style={{ padding: '10px 14px', background: 'var(--ob-card)', border: '1.5px solid var(--ob-border)' }}
              >
                <span className="flex-1 min-w-0">
                  <span className="block truncate" style={{ fontSize: 14, fontWeight: 600, color: 'var(--ob-ink)' }}>
                    {row.restaurant.name}
                  </span>
                  <span className="block truncate" style={{ fontSize: 11.5, marginTop: 2, color: 'var(--ob-label)' }}>
                    {[row.restaurant.city, row.restaurant.cuisine].filter(Boolean).join(' · ') || 'Looking it up…'}
                  </span>
                </span>
                {row.status === 'found' || row.status === 'updated' ? (
                  <Check size={15} strokeWidth={2.6} style={{ color: OB.TERRA }} />
                ) : row.restaurant.rating !== null ? (
                  <span
                    className="flex-none rounded-full"
                    style={{ padding: '3px 9px', fontSize: 12, fontWeight: 700, color: OB.TERRA, background: 'color-mix(in srgb, var(--ob-terra) 10%, transparent)' }}
                  >
                    {clampScore(row.restaurant.rating).toFixed(1)}
                  </span>
                ) : (
                  <span style={{ fontSize: 11.5, color: 'var(--ob-label)' }}>saved</span>
                )}
              </li>
            ))}
          </ul>
          {state.rows.length > PREVIEW_LIMIT && (
            <p style={{ fontSize: 12.5, marginTop: 10, color: 'var(--ob-label)' }}>
              +{state.rows.length - PREVIEW_LIMIT} more
            </p>
          )}
        </div>
      )}

      {state.phase === 'done' && state.summary && (
        <div className="flex flex-col items-center text-center" style={{ paddingTop: 18 }}>
          <span
            className="flex items-center justify-center rounded-full"
            style={{ width: 62, height: 62, background: OB.TERRA }}
          >
            <Check size={30} strokeWidth={3} color="#fff" />
          </span>
          <p style={{ fontSize: 19, fontWeight: 700, marginTop: 16, color: 'var(--ob-ink)' }}>
            {state.summary.rated + state.summary.updated + state.summary.wishlisted} places are in your list
          </p>
          <p style={{ fontSize: 13, marginTop: 6, lineHeight: 1.45, color: 'var(--ob-label)' }}>
            {[
              `${state.summary.rated + state.summary.updated} rated`,
              state.summary.wishlisted > 0 ? `${state.summary.wishlisted} saved` : '',
              state.summary.notFound > 0 ? `${state.summary.notFound} we couldn't match` : '',
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
      )}
    </div>
  );
};

/** The wizard's shared footer button, per import phase. */
export function importFooter(
  state: OnboardingImportState,
  next: () => void,
): { label: string; onClick: () => void; loading?: boolean; trailing: 'arrow' | 'check' | 'none' } {
  switch (state.phase) {
    case 'reading':
      return { label: 'Reading…', onClick: () => {}, loading: true, trailing: 'none' };
    case 'review':
      return { label: `Import all ${state.rows.length}`, onClick: state.start, trailing: 'arrow' };
    case 'running':
      // Continue is deliberately live: the run survives this step unmounting
      // (see useOnboardingImport), so nobody is held here for 60 seconds.
      return { label: 'Continue', onClick: next, trailing: 'arrow' };
    case 'done':
      return { label: 'Continue', onClick: next, trailing: 'arrow' };
    default:
      // No confirm, no warning, no guilt copy — starting fresh is a real
      // answer, not a skip.
      return { label: "I'm starting fresh", onClick: next, trailing: 'none' };
  }
}
