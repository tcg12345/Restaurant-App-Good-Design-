/**
 * Editable primitives used inside the Guide Live Editor preview pane.
 *
 * - `<Editable>` is a contentEditable wrapper around any inline/block
 *   text node. The reference editor's caret-preservation trick is
 *   reproduced here: an internal `editing` ref blocks the textContent
 *   reset effect while the user is typing, so the caret never jumps.
 * - `<EditableImage>` renders an image with a click-to-replace overlay
 *   that opens a popover for the URL plus optional fit / position /
 *   brightness / saturation controls.
 * - `<EditableChips>` is a chip list with inline add + per-chip remove.
 * - `<EditableScore>` and `<EditablePrice>` are popover-based numeric/
 *   symbolic inline editors.
 * - `<SectionChrome>` is the hover toolbar that sits at the top of each
 *   major section in the editor and gives the user a settings + hide
 *   shortcut.
 *
 * All styles live in `GuideLiveEditor.css` under the `.gle-overlay`
 * scope, so the public reader (which mounts `GuideRender.css` only)
 * never picks them up.
 */
import React, { type CSSProperties, type ReactElement, useEffect, useRef, useState } from 'react';
import { Camera, X, Plus, ChevronDown, Settings, Eye, EyeOff } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ElementStyle } from '../../lib/supabase-guides';
import { computeTextStyle } from './GuideRender';

/* ────────────────────────────────────────────────────────────────
   Editable text
   ──────────────────────────────────────────────────────────────── */

export interface EditableProps {
  as: 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'div';
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  /** Dotted-path key used by the Element tab to identify this node. */
  styleKey: string;
  /** Map of overrides from `theme.textStyles`. Looked up via styleKey. */
  textStyles: Record<string, ElementStyle>;
  /** Called when the user focuses the node — the editor swaps the
   *  Inspector to the Element tab + records the selection key. */
  onFocus?: (key: string, el: HTMLElement) => void;
  baseStyle?: CSSProperties;
  multiline?: boolean;
  maxLength?: number;
  /** When true, the active orange dashed outline is drawn on this node. */
  selected?: boolean;
}

export const Editable: React.FC<EditableProps> = ({
  as, value, onChange,
  placeholder = '',
  className = '',
  styleKey, textStyles, onFocus,
  baseStyle, multiline = false, maxLength,
  selected = false,
}) => {
  const ref = useRef<HTMLElement | null>(null);
  const editing = useRef(false);
  const overrides = textStyles[styleKey];
  const computed = computeTextStyle(overrides);

  // Keep the DOM text in sync with the external `value` prop EXCEPT
  // while the user is typing — overwriting textContent then would
  // snap the caret to the start of the node. The `editing` ref flips
  // on focus and back off on blur.
  useEffect(() => {
    const el = ref.current;
    if (!el || editing.current) return;
    if (el.textContent !== (value || '')) {
      el.textContent = value || '';
    }
  });

  const handleKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!multiline && e.key === 'Enter') {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    }
    if (
      maxLength
      && ref.current
      && (ref.current.textContent?.length || 0) >= maxLength
      && e.key.length === 1
      && !e.ctrlKey
      && !e.metaKey
    ) {
      e.preventDefault();
    }
  };

  return React.createElement(as, {
    ref: (node: HTMLElement | null) => { ref.current = node; },
    contentEditable: true,
    suppressContentEditableWarning: true,
    spellCheck: false,
    'data-placeholder': placeholder,
    'data-style-key': styleKey,
    className: cn('gle-editable', overrides && 'has-override', selected && 'is-selected', className),
    style: { ...baseStyle, ...computed },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      editing.current = true;
      if (onFocus) onFocus(styleKey, e.currentTarget);
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      editing.current = false;
      onChange(e.currentTarget.textContent || '');
    },
    onKeyDown: handleKey,
  } as React.HTMLAttributes<HTMLElement> & { contentEditable: boolean; ref: (n: HTMLElement | null) => void });
};

/* ────────────────────────────────────────────────────────────────
   Editable image
   ──────────────────────────────────────────────────────────────── */

export interface ImageStyle {
  fit?: 'cover' | 'contain';
  posX?: number;
  posY?: number;
  brightness?: number;
  saturate?: number;
}

export interface EditableImageProps {
  src: string;
  onChange: (next: string) => void;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  label?: string;
  /** Show advanced fit/position/brightness/saturation controls inside
   *  the popover. Only sensible for hero / entry photos. */
  showAdvanced?: boolean;
  imgStyle?: ImageStyle;
  onStyleChange?: (next: ImageStyle) => void;
  imgClassName?: string;
}

export const EditableImage: React.FC<EditableImageProps> = ({
  src, onChange, alt = '', className, style, label = 'Replace photo',
  showAdvanced = false, imgStyle, onStyleChange, imgClassName,
}) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(src || '');
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setDraft(src || ''), [src]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const commit = () => onChange(draft.trim());

  const fit = imgStyle?.fit || 'cover';
  const posX = imgStyle?.posX ?? 50;
  const posY = imgStyle?.posY ?? 50;
  const bright = imgStyle?.brightness ?? 100;
  const sat = imgStyle?.saturate ?? 100;
  const filter = `brightness(${bright}%) saturate(${sat}%)`;
  const setStyle = (k: keyof ImageStyle, v: number | string) => onStyleChange?.({ ...(imgStyle || {}), [k]: v });

  return (
    <div className={cn('gle-img-wrap', className)} style={style}>
      {src ? (
        <img
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          className={imgClassName}
          style={{ objectFit: fit, objectPosition: `${posX}% ${posY}%`, filter }}
        />
      ) : (
        <div className="gle-img-empty">
          <Camera size={16} />
          <span>Add a photo</span>
        </div>
      )}

      <button type="button" className="gle-img-edit" onClick={() => setOpen((v) => !v)}>
        <Camera size={13} />
        <span>{label}</span>
      </button>

      {open && (
        <div className="gle-img-pop" ref={popRef} onMouseDown={(e) => e.stopPropagation()}>
          <div className="gle-pop-label">Image URL</div>
          <div className="gle-pop-row">
            <input
              className="gle-input"
              placeholder="https://images.unsplash.com/…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { commit(); setOpen(false); }
                if (e.key === 'Escape') setOpen(false);
              }}
              autoFocus
            />
            <button type="button" className="gle-mini primary" onClick={() => { commit(); setOpen(false); }}>
              Apply
            </button>
          </div>

          {showAdvanced && (
            <>
              <div className="gle-pop-divider" />
              <div className="gle-pop-label">Image fit</div>
              <div className="gle-seg">
                {(['cover', 'contain'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={cn('gle-seg-btn', fit === f && 'on')}
                    onClick={() => setStyle('fit', f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <PopSlider label="Position X" value={posX} min={0} max={100} suffix="%" onChange={(v) => setStyle('posX', v)} />
              <PopSlider label="Position Y" value={posY} min={0} max={100} suffix="%" onChange={(v) => setStyle('posY', v)} />
              <PopSlider label="Brightness" value={bright} min={40} max={140} suffix="%" onChange={(v) => setStyle('brightness', v)} />
              <PopSlider label="Saturation" value={sat} min={0} max={180} suffix="%" onChange={(v) => setStyle('saturate', v)} />
            </>
          )}

          <div className="gle-pop-foot">
            <button type="button" className="gle-mini ghost" onClick={() => { setDraft(''); onChange(''); setOpen(false); }}>
              Clear image
            </button>
            <button type="button" className="gle-mini" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const PopSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step = 1, suffix = '', onChange }) => (
  <div className="gle-pop-slider">
    <div className="gle-pop-slider-head">
      <span>{label}</span>
      <span className="gle-pop-slider-val">{value}{suffix}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
    />
  </div>
);

/* ────────────────────────────────────────────────────────────────
   Editable chips
   ──────────────────────────────────────────────────────────────── */

export interface EditableChipsProps {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  chipClass?: string;
}

export const EditableChips: React.FC<EditableChipsProps> = ({
  values, onChange,
  placeholder = 'Add…',
  chipClass = 'gle-chip',
}) => {
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (adding && inputRef.current) inputRef.current.focus();
  }, [adding]);

  const commit = () => {
    const t = draft.trim();
    if (t && !values.includes(t)) onChange([...values, t]);
    setDraft('');
    setAdding(false);
  };

  return (
    <div className="gle-chips">
      {values.map((v) => (
        <span key={v} className={chipClass}>
          <span>{v}</span>
          <button
            type="button"
            className="gle-chip-x"
            onClick={() => onChange(values.filter((x) => x !== v))}
            aria-label={`Remove ${v}`}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      {adding ? (
        <span className={cn(chipClass, 'is-input')}>
          <input
            ref={inputRef}
            className="gle-chip-inp"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') { setDraft(''); setAdding(false); }
            }}
            onBlur={commit}
            placeholder={placeholder}
          />
        </span>
      ) : (
        <button type="button" className="gle-chip-add" onClick={() => setAdding(true)}>
          <Plus size={11} />
          <span>Add</span>
        </button>
      )}
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────
   Editable score
   ──────────────────────────────────────────────────────────────── */

export const EditableScore: React.FC<{ value: number; onChange: (v: number) => void }> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const cls = value >= 8.5 ? 'high' : value >= 7 ? 'mid' : 'low';
  return (
    <span className="gle-score-wrap" ref={ref}>
      <button type="button" className={cn('gle-score-trigger', cls)} onClick={() => setOpen((v) => !v)}>
        {value.toFixed(1)}
      </button>
      {open && (
        <div className="gle-score-pop">
          <div className="gle-pop-label">Score</div>
          <div className="gle-score-pop-row">
            <input
              type="range" min="0" max="10" step="0.1" value={value}
              onChange={(e) => onChange(parseFloat(e.target.value))}
            />
            <span className={cn('gle-score-val', cls)}>{value.toFixed(1)}</span>
          </div>
        </div>
      )}
    </span>
  );
};

/* ────────────────────────────────────────────────────────────────
   Editable price
   ──────────────────────────────────────────────────────────────── */

export const EditablePrice: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <span className="gle-price-wrap" ref={ref}>
      <button type="button" className="gle-price-trigger" onClick={() => setOpen((v) => !v)}>
        {value || '$'}
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="gle-price-pop">
          {(['$', '$$', '$$$', '$$$$'] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={cn('gle-price-opt', value === p && 'on')}
              onClick={() => { onChange(p); setOpen(false); }}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </span>
  );
};

/* ────────────────────────────────────────────────────────────────
   Section chrome (hover toolbar)
   ──────────────────────────────────────────────────────────────── */

export interface SectionChromeProps {
  label: string;
  onOpenSettings?: () => void;
  hidden?: boolean;
  onToggleVisibility?: () => void;
}

export const SectionChrome: React.FC<SectionChromeProps> = ({ label, onOpenSettings, hidden, onToggleVisibility }) => (
  <div className="gle-section-chrome">
    <span className="gle-section-tag">{label}</span>
    {onToggleVisibility && (
      <button
        type="button"
        className="gle-sc-btn"
        onClick={onToggleVisibility}
        title={hidden ? 'Show section' : 'Hide section'}
      >
        {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    )}
    {onOpenSettings && (
      <button
        type="button"
        className="gle-sc-btn"
        onClick={onOpenSettings}
        title="Section settings"
      >
        <Settings size={13} />
      </button>
    )}
  </div>
);

/* ────────────────────────────────────────────────────────────────
   SectionHost — wraps a section so its hover chrome lands above it.
   ──────────────────────────────────────────────────────────────── */

export const SectionHost: React.FC<{
  label: string;
  onOpenSettings?: () => void;
  hidden?: boolean;
  onToggleVisibility?: () => void;
  className?: string;
  children: ReactElement;
}> = ({ label, onOpenSettings, hidden, onToggleVisibility, className, children }) => (
  <div className={cn('gle-section-host', className)}>
    <SectionChrome
      label={label}
      onOpenSettings={onOpenSettings}
      hidden={hidden}
      onToggleVisibility={onToggleVisibility}
    />
    {children}
  </div>
);
