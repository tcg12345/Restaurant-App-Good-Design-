import React, { useMemo, useState } from 'react';
import { ChevronDown, Check, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { VERIFIED_STATUS_TEMPLATES, saveVerifiedStatusLine } from '../lib/supabase-verification';

/**
 * The one-line public status editor for verified users ("Head chef at Lilia",
 * "Influencer · 120k followers"). A template dropdown + fill-in composes the
 * final line; "Custom…" frees the whole line. Used by the approval
 * congratulations modal (mandatory pick) and the Settings › Account
 * "Verification" block (edit later).
 *
 * Calls `saveVerifiedStatusLine` on save and reports success upward so the
 * caller can refreshProfile / acknowledge / close.
 */
export const VerifiedStatusPicker: React.FC<{
  userId: string;
  /** Pre-fill from the profile's current status when editing. */
  initialValue?: string | null;
  saveLabel?: string;
  onSaved: (line: string) => void;
}> = ({ userId, initialValue, saveLabel = 'Save', onSaved }) => {
  // Try to reverse-match an existing status to a template so editing feels
  // continuous; otherwise start on Custom with the raw line.
  const initial = useMemo(() => {
    const line = (initialValue || '').trim();
    if (!line) return { template: VERIFIED_STATUS_TEMPLATES[0], fill: '' };
    for (const t of VERIFIED_STATUS_TEMPLATES) {
      if (t === 'Custom…') continue;
      const [prefix, suffix = ''] = t.split('___');
      if (line.startsWith(prefix) && line.endsWith(suffix) && line.length > prefix.length + suffix.length) {
        return { template: t, fill: line.slice(prefix.length, line.length - suffix.length || undefined) };
      }
    }
    return { template: 'Custom…', fill: line };
  }, [initialValue]);

  const [template, setTemplate] = useState(initial.template);
  const [fill, setFill] = useState(initial.fill);
  const [menuOpen, setMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isCustom = template === 'Custom…';
  const composed = isCustom
    ? fill.trim()
    : template.replace('___', fill.trim());
  const complete = isCustom ? fill.trim().length > 2 : fill.trim().length > 0;

  const handleSave = async () => {
    if (!complete || saving) return;
    setSaving(true);
    setError('');
    const res = await saveVerifiedStatusLine(userId, composed);
    setSaving(false);
    if (res.success) onSaved(composed);
    else setError(res.error || 'Could not save — try again.');
  };

  return (
    <div className="space-y-2.5">
      {/* Template dropdown */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 bg-on-surface/5 rounded-xl py-2.5 px-3.5 text-sm font-medium text-on-surface/80"
        >
          <span className="truncate">{template.replace('___', '…')}</span>
          <ChevronDown size={14} className={cn('flex-shrink-0 text-on-surface/40 transition-transform', menuOpen && 'rotate-180')} />
        </button>
        {menuOpen && (
          <div className="absolute z-20 mt-1.5 w-full max-h-56 overflow-y-auto rounded-2xl border border-on-surface/10 bg-paper shadow-[0_16px_44px_rgba(0,0,0,0.18)]">
            {VERIFIED_STATUS_TEMPLATES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTemplate(t); setMenuOpen(false); if (t === 'Custom…' && !isCustom) setFill(''); }}
                className={cn(
                  'w-full flex items-center justify-between px-3.5 py-2.5 text-left text-sm font-medium transition-colors',
                  t === template ? 'text-primary bg-primary/5' : 'text-on-surface/75 hover:bg-on-surface/[0.04]',
                )}
              >
                {t.replace('___', '…')}
                {t === template && <Check size={14} className="text-primary flex-shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Fill-in */}
      <input
        type="text"
        value={fill}
        onChange={(e) => setFill(e.target.value)}
        maxLength={isCustom ? 80 : 60}
        placeholder={isCustom ? 'Your status, e.g. James Beard Award winner' : 'Fill in the blank, e.g. Lilia'}
        className="w-full bg-on-surface/5 rounded-xl py-2.5 px-3.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface/30"
      />

      {/* Live preview of the final line */}
      {complete && (
        <p className="text-[12.5px] text-on-surface/55 px-1">
          Shown on your profile: <span className="font-semibold text-on-surface/80">{composed}</span>
        </p>
      )}
      {error && <p className="text-[12px] text-red-600 px-1">{error}</p>}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={!complete || saving}
        className="w-full py-2.5 bg-primary text-on-primary rounded-xl text-xs font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
      >
        {saving && <Loader2 size={13} className="animate-spin" />}
        {saveLabel}
      </button>
    </div>
  );
};
