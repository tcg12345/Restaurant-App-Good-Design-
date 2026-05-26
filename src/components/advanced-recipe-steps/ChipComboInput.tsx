// Reusable chip + autocomplete combobox. Used by the Advanced Recipe
// Builder's Equipment & Notes step for both the equipment input and
// the tags input. Behavior matches the attached functionality spec:
//
//   - Selected values render as rust-tinted chips inside a single
//     bordered "input" surface; each chip has an X to remove.
//   - Typing into the trailing input filters a catalogue of
//     suggestions ("MATCHING N" dropdown). Up/Down arrow keys
//     navigate; Enter selects the highlighted item.
//   - If the typed text doesn't match anything, Enter still adds it
//     as a custom value — the catalogue is a hint, not a constraint.
//   - Backspace on an empty input removes the last chip (standard
//     gmail-recipient-style behavior).
//   - Comma also commits the typed text (so paste-from-spreadsheet
//     works without a perfect match).
//
// Duplicate prevention: case-insensitive on the canonical value, but
// the chip displays whichever case the catalogue provides (or the
// user's original typing for customs).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus } from 'lucide-react';
import './ChipComboInput.css';

export interface ChipComboInputProps {
  /** Current selected values. Order matters and is preserved. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Catalogue of autocomplete suggestions. Free-form additions still
   *  allowed — the user can type anything and press Enter. */
  suggestions: string[];
  /** Placeholder shown only when the input is empty AND no chips. */
  placeholder?: string;
  /** Prefix prepended to chip text (e.g. "#" for tags). Display-only —
   *  the stored value never contains it. */
  chipPrefix?: string;
  /** Max number of suggestions shown at once. Default 10. */
  maxSuggestions?: number;
  /** Optional: catch a click-out by registering a global listener. */
  closeOnBlur?: boolean;
  /** Visible label rendered above the input (the spec shows the input
   *  as a clean card without a separate label, so this is optional). */
  ariaLabel?: string;
}

/** Normalize for dedupe + match — lowercase + trim. */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

export const ChipComboInput: React.FC<ChipComboInputProps> = ({
  value,
  onChange,
  suggestions,
  placeholder = '',
  chipPrefix = '',
  maxSuggestions = 10,
  closeOnBlur = true,
  ariaLabel,
}) => {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Already-selected set for dedupe (case-insensitive).
  const selectedSet = useMemo(() => new Set(value.map(norm)), [value]);

  // Filtered suggestions — substring match, dedupe against the
  // already-selected, cap to maxSuggestions. When the draft is empty
  // we show the top-of-catalogue list (still skipping selected ones).
  const filtered = useMemo(() => {
    const q = draft.trim().toLowerCase();
    const pool = suggestions.filter((s) => !selectedSet.has(norm(s)));
    if (!q) return pool.slice(0, maxSuggestions);
    return pool
      .filter((s) => s.toLowerCase().includes(q))
      .slice(0, maxSuggestions);
  }, [draft, suggestions, selectedSet, maxSuggestions]);

  // Reset active highlight when the filtered set changes shape so the
  // arrow keys don't point off the end.
  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(0);
  }, [filtered, activeIdx]);

  // Optional click-out close.
  useEffect(() => {
    if (!open || !closeOnBlur) return;
    const onDocClick = (e: MouseEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open, closeOnBlur]);

  const addValue = useCallback((raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (selectedSet.has(norm(trimmed))) {
      // Already there — just clear the draft so the user knows it
      // registered and can move on.
      setDraft('');
      return;
    }
    onChange([...value, trimmed]);
    setDraft('');
    setActiveIdx(0);
  }, [value, onChange, selectedSet]);

  const removeAt = useCallback((idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  }, [value, onChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && filtered[activeIdx]) {
        addValue(filtered[activeIdx]);
      } else if (draft.trim()) {
        addValue(draft);
      }
    } else if (e.key === ',' || e.key === 'Tab') {
      if (draft.trim()) {
        e.preventDefault();
        addValue(draft);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      // Pop the last chip — standard tag-input affordance.
      removeAt(value.length - 1);
    }
  };

  const handleSuggestionMouseDown = (s: string) => (e: React.MouseEvent) => {
    // mousedown (not click) so the blur-close doesn't beat the add.
    e.preventDefault();
    addValue(s);
    inputRef.current?.focus();
  };

  return (
    <div
      ref={rootRef}
      className={`chip-combo${open ? ' is-open' : ''}`}
      aria-label={ariaLabel}
    >
      <div
        className="chip-combo-field"
        onClick={() => inputRef.current?.focus()}
        role="textbox"
        tabIndex={-1}
      >
        {value.map((v, i) => (
          <span key={`${v}-${i}`} className="chip-combo-chip">
            <span className="chip-combo-chip-text">{chipPrefix}{v}</span>
            <button
              type="button"
              className="chip-combo-chip-remove"
              onClick={(e) => { e.stopPropagation(); removeAt(i); }}
              aria-label={`Remove ${v}`}
            >
              <X size={11} strokeWidth={2.5} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className="chip-combo-input"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? placeholder : ''}
        />
      </div>

      {open && (
        <div className="chip-combo-pop" role="listbox">
          <div className="chip-combo-pop-head">
            {filtered.length > 0
              ? `Matching ${filtered.length}`
              : draft.trim()
                ? 'No matches — press Enter to add'
                : 'Start typing or pick from below'}
          </div>
          {filtered.length > 0 && (
            <ul className="chip-combo-pop-list">
              {filtered.map((s, i) => {
                const isActive = i === activeIdx;
                return (
                  <li
                    key={s}
                    className={`chip-combo-pop-item${isActive ? ' is-active' : ''}`}
                    onMouseDown={handleSuggestionMouseDown(s)}
                    onMouseEnter={() => setActiveIdx(i)}
                    role="option"
                    aria-selected={isActive}
                  >
                    <span className="chip-combo-pop-item-text">{chipPrefix}{s}</span>
                    <Plus size={14} strokeWidth={2.2} />
                  </li>
                );
              })}
            </ul>
          )}
          {filtered.length === 0 && draft.trim() && (
            <div className="chip-combo-pop-empty">
              <span>"{draft.trim()}" isn't in the catalogue — press Enter to add it as a custom value.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
