/**
 * City autocomplete — Mapbox place suggestions under a text field.
 *
 * Shared by the profile-setup wizard (mobile) and the profile-setup form
 * (desktop); only the chrome differs, via `variant`. Free text still works —
 * callers geocode whatever was typed — but picking a suggestion is what pins
 * exact coordinates, so the field always shows what it is doing: it opens on
 * the first searchable keystroke and says whether it is searching or came
 * back empty, instead of looking like a plain text box until results land.
 */
import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { searchLocations, type HomeLocation } from './HomeLocationBar';
import * as OB from './onboarding/OnboardingKit';

export const CityAutocomplete: React.FC<{
  value: string;
  onChange: (v: string) => void;
  onPick: (loc: HomeLocation) => void;
  onSubmit?: () => void;
  variant?: 'wizard' | 'form';
}> = ({ value, onChange, onPick, onSubmit, variant = 'wizard' }) => {
  const [suggestions, setSuggestions] = useState<HomeLocation[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNext = useRef(false);
  // Only the newest query may write results — a slow early request must not
  // land after a faster later one and repopulate the list with stale cities.
  const seq = useRef(0);

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

  const reopen = () => { if (searching || suggestions.length) setOpen(true); };
  const close = () => { setTimeout(() => setOpen(false), 150); };
  const wizard = variant === 'wizard';

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
      {open && (
        <div
          className="absolute left-0 right-0 z-20 overflow-hidden"
          style={
            wizard
              ? { top: 'calc(100% + 8px)', borderRadius: 15, background: 'var(--ob-card)', border: `1.5px solid ${OB.BORDER}`, boxShadow: '0 16px 40px rgba(40,24,14,0.14)' }
              : { top: 'calc(100% + 6px)', borderRadius: 16, background: 'var(--color-surface, #fff)', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 16px 40px rgba(0,0,0,0.12)' }
          }
        >
          {suggestions.map((s, i) => (
            <button
              key={`${s.label}-${i}`}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              className="w-full flex items-center gap-2.5 text-left cursor-pointer border-none transition-colors"
              style={{ padding: '12px 16px', background: wizard ? 'var(--ob-card)' : 'transparent', borderTop: i === 0 ? 'none' : '1px solid var(--ob-divider)' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = wizard ? 'var(--ob-card-hover)' : 'rgba(0,0,0,0.04)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = wizard ? 'var(--ob-card)' : 'transparent')}
            >
              <MapPin size={15} strokeWidth={1.6} style={{ color: OB.LABEL_GREY, flexShrink: 0 }} />
              <span className="truncate" style={{ fontSize: 14.5, color: 'var(--ob-ink-soft)' }}>{s.label}</span>
            </button>
          ))}
          {/* Status rows, so the field visibly IS a lookup even when Mapbox
              is slow or has nothing to offer. */}
          {searching && (
            <div className="flex items-center gap-2.5" style={{ padding: '12px 16px', borderTop: suggestions.length ? '1px solid var(--ob-divider)' : 'none' }}>
              <Loader2 size={14} className="animate-spin" style={{ color: OB.LABEL_GREY, flexShrink: 0 }} />
              <span style={{ fontSize: 14, color: 'var(--ob-label)' }}>Searching…</span>
            </div>
          )}
          {!searching && suggestions.length === 0 && (
            <div style={{ padding: '12px 16px', fontSize: 14, color: 'var(--ob-label)' }}>
              No matches — you can still type your city.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
