/**
 * City autocomplete — Mapbox place suggestions under a text field.
 *
 * Shared by the profile-setup wizard (mobile) and the profile-setup form
 * (desktop); only the chrome differs, via `variant`. Free text still works —
 * callers geocode whatever was typed — but picking a suggestion is what pins
 * exact coordinates, so the field always shows what it is doing: it opens on
 * the first searchable keystroke and says whether it is searching or came
 * back empty, instead of looking like a plain text box until results land.
 *
 * Device location, wizard variant: if permission is ALREADY granted the
 * city resolves silently on mount and fills an untouched field — the
 * "automatically selects" case. If it has never been asked, a visible
 * "Use my location" button carries the ask, and only a tap on it fires
 * the OS dialog. The old behavior — firing the dialog the moment the
 * step appeared — ambushed people mid-form with a system prompt they
 * hadn't invited, which is how reflexive denials happen. The 'form'
 * variant (desktop signup) never prompts at all.
 */
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MapPin, LocateFixed, Loader2 } from 'lucide-react';
import { searchLocations, getCurrentHomeLocation, type HomeLocation } from './HomeLocationBar';
import * as OB from './onboarding/OnboardingKit';

/** "City, Region, Country" → [bold headline, muted rest] so a result reads
 *  at a glance instead of as one flat line of gray text. */
function splitLabel(label: string): [string, string] {
  const idx = label.indexOf(',');
  return idx === -1 ? [label, ''] : [label.slice(0, idx), label.slice(idx + 1).trim()];
}

const SuggestionRow: React.FC<{
  label: string;
  index: number;
  onPick: () => void;
  accent?: boolean;
  icon?: React.ReactNode;
  divider: boolean;
}> = ({ label, index, onPick, accent, icon, divider }) => {
  const [primary, secondary] = splitLabel(label);
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, delay: Math.min(index, 5) * 0.025 }}
      onMouseDown={(e) => { e.preventDefault(); onPick(); }}
      className="w-full flex items-center gap-3 text-left cursor-pointer border-none transition-colors"
      style={{ padding: '12.5px 16px', background: 'var(--ob-card)', borderTop: divider ? '1px solid var(--ob-divider)' : 'none' }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--ob-card-hover)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--ob-card)')}
    >
      <span
        className="flex items-center justify-center flex-shrink-0"
        style={{ width: 32, height: 32, borderRadius: 10, background: accent ? OB.TERRA : 'var(--ob-badge-bg)' }}
      >
        {icon ?? <MapPin size={15} strokeWidth={1.8} style={{ color: accent ? OB.ON_TERRA : OB.TERRA }} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate" style={{ fontSize: 15, fontWeight: 600, color: accent ? OB.TERRA : 'var(--ob-ink)' }}>
          {primary}
        </span>
        {secondary && (
          <span className="block truncate" style={{ fontSize: 12.5, marginTop: 1, color: 'var(--ob-label)' }}>{secondary}</span>
        )}
      </span>
    </motion.button>
  );
};

export const CityAutocomplete: React.FC<{
  value: string;
  onChange: (v: string) => void;
  onPick: (loc: HomeLocation) => void;
  onSubmit?: () => void;
  variant?: 'wizard' | 'form';
}> = ({ value, onChange, onPick, onSubmit, variant = 'wizard' }) => {
  const wizard = variant === 'wizard';
  const [suggestions, setSuggestions] = useState<HomeLocation[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNext = useRef(false);
  // Only the newest query may write results — a slow early request must not
  // land after a faster later one and repopulate the list with stale cities.
  const seq = useRef(0);

  // Device location: requested once, the moment this step mounts. Kept as
  // its own status rather than folded into `searching` — it drives a
  // different affordance (a helper line under the field, a pinned row in
  // the dropdown) that has nothing to do with a typed query.
  const [locateStatus, setLocateStatus] = useState<'idle' | 'locating' | 'done' | 'unavailable'>('idle');
  const [detected, setDetected] = useState<HomeLocation | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const runLocate = React.useCallback((silent: boolean) => {
    setLocateStatus('locating');
    getCurrentHomeLocation({ cityOnly: true })
      .then((loc) => {
        setDetected(loc);
        setLocateStatus('done');
        // Only autofill a field that's still exactly as it started —
        // resolving takes a second or two, and someone already typing a
        // city by hand must never be overwritten mid-keystroke.
        if (!valueRef.current.trim()) {
          skipNext.current = true;
          onChange(loc.label);
          onPick(loc);
        }
      })
      .catch(() => setLocateStatus(silent ? 'idle' : 'unavailable'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!wizard) return;
    let cancelled = false;
    // Silent path only: resolve on mount when the permission ALREADY
    // exists, so nothing here can ever surface the OS dialog uninvited.
    // The Permissions API is the only way to know without asking; where
    // it's missing (older WKWebViews), fall through to the button.
    const query = (navigator as Navigator & { permissions?: Permissions }).permissions?.query?.bind(navigator.permissions);
    if (!query) return;
    query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (cancelled) return;
        if (status.state === 'granted') runLocate(true);
        else if (status.state === 'denied') setLocateStatus('unavailable');
        // 'prompt' → stay idle; the button carries the ask.
      })
      .catch(() => { /* API missing or throwing — button path */ });
    return () => { cancelled = true; };
    // Intentionally once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard]);

  useEffect(() => {
    if (skipNext.current) { skipNext.current = false; return; }
    const q = value.trim();
    if (timer.current) clearTimeout(timer.current);
    if (q.length < 2) { setSuggestions([]); setSearching(false); setOpen(false); return; }
    const mine = ++seq.current;
    // Open on the FIRST keystroke that can search, showing "Searching…" —
    // waiting for results made the field look like a plain text box.
    setSearching(true);
    setOpen(true);
    timer.current = setTimeout(async () => {
      const res = await searchLocations(q);
      if (seq.current !== mine) return;
      setSuggestions(res);
      setSearching(false);
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value]);

  const pick = (loc: HomeLocation) => {
    skipNext.current = true;
    seq.current++; // invalidate anything still in flight
    onChange(loc.label);
    onPick(loc);
    setOpen(false);
    setSearching(false);
    setSuggestions([]);
  };

  // Only while the field is empty. Pinning the detected city ABOVE the
  // results of a query for a different one — "San Francisco" in accent
  // while you're typing "New York" — read as the search being wrong.
  const showDetectedRow = wizard && !!detected && !value.trim();
  const reopen = () => { if (searching || suggestions.length || showDetectedRow || locateStatus === 'locating') setOpen(true); };
  const close = () => { setTimeout(() => setOpen(false), 150); };
  const usingDetected = wizard && !!detected && value.trim() === detected.label.trim();

  return (
    <div className="relative">
      {wizard ? (
        <OB.Field
          value={value} onChange={onChange} placeholder="e.g. New York"
          icon={<MapPin size={16} strokeWidth={1.6} />} autoFocus autoCapitalize="words"
          autoComplete="off"
          onSubmit={onSubmit}
          onFocus={reopen}
          onBlur={close}
          rightSlot={locateStatus === 'locating' ? <Loader2 size={15} className="animate-spin" style={{ color: OB.LABEL_GREY }} /> : undefined}
        />
      ) : (
        <input
          type="text" value={value} placeholder="e.g. New York, NY"
          onChange={(e) => onChange(e.target.value)}
          onFocus={reopen}
          onBlur={close}
          autoCapitalize="words" autoCorrect="off" autoComplete="off"
          className="w-full px-4 py-3 rounded-2xl bg-white/70 backdrop-blur-sm border border-black/5 text-on-surface placeholder:text-on-surface/30 focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm"
        />
      )}

      {wizard && locateStatus === 'idle' && !value.trim() && (
        <div style={{ marginTop: 12 }}>
          <OB.SecondaryButton
            icon={<LocateFixed size={16} strokeWidth={2.2} />}
            onClick={() => runLocate(false)}
          >
            Use my location
          </OB.SecondaryButton>
        </div>
      )}
      {wizard && locateStatus === 'unavailable' && !value.trim() && (
        <div className="flex items-center gap-1.5" style={{ marginTop: 9, paddingLeft: 3 }}>
          <span style={{ fontSize: 12.5, color: 'var(--ob-label)' }}>
            Location is off for GoodEats — type your city instead.
          </span>
        </div>
      )}
      {wizard && (usingDetected || (locateStatus === 'locating' && !value.trim())) && (
        <div className="flex items-center gap-1.5" style={{ marginTop: 9, paddingLeft: 3 }}>
          {usingDetected ? (
            <>
              <LocateFixed size={12} strokeWidth={2.4} style={{ color: OB.TERRA }} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: OB.TERRA }}>Using your current location</span>
            </>
          ) : (
            <span style={{ fontSize: 12.5, color: 'var(--ob-label)' }}>Finding your location…</span>
          )}
        </div>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
            className="absolute left-0 right-0 z-20 overflow-y-auto overscroll-contain no-scrollbar"
            style={
              wizard
                // Capped and self-scrolling: the wizard's content pane is a
                // fixed-height scroll region, so an unbounded dropdown gets
                // clipped by it and the last result is unreachable.
                ? { top: 'calc(100% + 10px)', maxHeight: 316, borderRadius: 20, background: 'var(--ob-card)', border: `1px solid ${OB.BORDER}`, boxShadow: '0 20px 48px rgba(0,0,0,0.16)' }
                : { top: 'calc(100% + 6px)', maxHeight: 300, borderRadius: 16, background: 'var(--color-surface, #fff)', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 16px 40px rgba(0,0,0,0.12)' }
            }
          >
            {wizard ? (
              <>
                {showDetectedRow && (
                  <SuggestionRow
                    label={detected!.label}
                    index={0}
                    onPick={() => pick(detected!)}
                    accent
                    icon={<LocateFixed size={15} strokeWidth={2.2} style={{ color: OB.ON_TERRA }} />}
                    divider={false}
                  />
                )}
                {locateStatus === 'locating' && !detected && (
                  <div className="flex items-center gap-3" style={{ padding: '12.5px 16px' }}>
                    <span className="flex items-center justify-center flex-shrink-0" style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--ob-badge-bg)' }}>
                      <Loader2 size={15} className="animate-spin" style={{ color: OB.TERRA }} />
                    </span>
                    <span style={{ fontSize: 14, color: 'var(--ob-label)' }}>Finding your location…</span>
                  </div>
                )}
                {suggestions.map((s, i) => (
                  <SuggestionRow
                    key={`${s.label}-${i}`}
                    label={s.label}
                    index={i + 1}
                    onPick={() => pick(s)}
                    divider={i > 0 || showDetectedRow || (locateStatus === 'locating' && !detected)}
                  />
                ))}
              </>
            ) : (
              suggestions.map((s, i) => (
                <button
                  key={`${s.label}-${i}`}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); pick(s); }}
                  className="w-full flex items-center gap-2.5 text-left cursor-pointer border-none transition-colors"
                  style={{ padding: '12px 16px', background: 'transparent', borderTop: i === 0 ? 'none' : '1px solid var(--ob-divider)' }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.04)')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}
                >
                  <MapPin size={15} strokeWidth={1.6} style={{ color: OB.LABEL_GREY, flexShrink: 0 }} />
                  <span className="truncate" style={{ fontSize: 14.5, color: 'var(--ob-ink-soft)' }}>{s.label}</span>
                </button>
              ))
            )}
            {/* Status rows, so the field visibly IS a lookup even when Mapbox
                is slow or has nothing to offer. */}
            {searching && (
              <div className="flex items-center gap-2.5" style={{ padding: '12px 16px', borderTop: (suggestions.length || (wizard && showDetectedRow)) ? '1px solid var(--ob-divider)' : 'none' }}>
                <Loader2 size={14} className="animate-spin" style={{ color: OB.LABEL_GREY, flexShrink: 0 }} />
                <span style={{ fontSize: 14, color: 'var(--ob-label)' }}>Searching…</span>
              </div>
            )}
            {!searching && suggestions.length === 0 && value.trim().length >= 2 && (
              <div style={{ padding: '12px 16px', fontSize: 14, color: 'var(--ob-label)', borderTop: (wizard && showDetectedRow) ? '1px solid var(--ob-divider)' : 'none' }}>
                No matches — you can still type your city.
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
