// "Import" tab of the Add Recipe modal — bring a recipe in from
// somewhere else: a web link, photos (cookbook page / screenshot /
// handwritten card), or pasted text. The import-recipe Edge Function
// transcribes the source with AI and the result lands on the Advanced
// builder's Review step as a fully editable draft.
//
// Shares the rcx- design language with the Advanced builder and the AI
// generator: same header, segmented tabs, and footer CTA.

import React, { useEffect, useRef, useState } from 'react';
import { X, Link2, Camera, ClipboardType, ClipboardPaste, Plus, Loader2, Download, AlertCircle, FileText } from 'lucide-react';
import { cn } from '../lib/utils';
import type { HomeMeal } from '../contexts/ListsContext';
import { importRecipe, compressImportPhoto, type ImportSource } from '../lib/import-recipe-client';
import './AdvancedRecipeBuilder.css';
import './RecipeBuilder.css';

type SourceTab = 'link' | 'photo' | 'text';

interface ImportRecipePanelProps {
  /** Called with the transcribed HomeMeal — the parent seeds the
   *  Advanced builder with it (Review step) for checking + publish. */
  onImported: (meal: HomeMeal) => void;
  /** Close the whole Add Recipe modal. */
  onClose: () => void;
  /** The Import / Builder / AI tab strip, injected by the parent. */
  tabSlot?: React.ReactNode;
  phoneMode?: boolean;
  /** Opens the legacy CSV / JSON bulk importer. */
  onOpenBulk?: () => void;
}

const MAX_PHOTOS = 3;

/** Accept "foodblog.com/carbonara" as well as a full URL. */
function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export const ImportRecipePanel: React.FC<ImportRecipePanelProps> = ({
  onImported,
  onClose,
  tabSlot,
  phoneMode,
  onOpenBulk,
}) => {
  const [tab, setTab] = useState<SourceTab>('link');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Elapsed-seconds ticker during the import so the user sees progress.
  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    const started = Date.now();
    setElapsed(0);
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [busy]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const normalizedUrl = normalizeUrl(url);
  const canSubmit =
    !busy && (
      tab === 'link' ? !!normalizedUrl :
      tab === 'photo' ? photos.length > 0 :
      text.trim().length > 0
    );

  const ctaLabel = busy
    ? 'Importing…'
    : tab === 'link' ? (normalizedUrl ? 'Import recipe' : 'Paste a recipe link')
    : tab === 'photo' ? (photos.length > 0 ? 'Import recipe' : 'Add at least one photo')
    : (text.trim() ? 'Import recipe' : 'Paste the recipe text');

  const loadingTitle =
    tab === 'photo'
      ? (elapsed >= 10 ? 'Almost there…' : 'Reading your photos…')
      : tab === 'link'
        ? (elapsed < 5 ? 'Fetching the page…' : elapsed >= 15 ? 'Almost there…' : 'Reading the recipe…')
        : (elapsed >= 15 ? 'Almost there…' : 'Reading the recipe…');

  const handlePasteClipboard = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip.trim()) {
        setUrl(clip.trim());
        setError(null);
      }
    } catch {
      /* Clipboard permission denied — user can paste manually. */
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_PHOTOS - photos.length;
    const picked = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, room);
    for (const f of picked) {
      try {
        const dataUrl = await compressImportPhoto(f);
        setPhotos((prev) => (prev.length < MAX_PHOTOS ? [...prev, dataUrl] : prev));
        setError(null);
      } catch {
        setError("Couldn't read one of those photos.");
      }
    }
  };

  const handleImport = async () => {
    if (!canSubmit) return;
    const source: ImportSource =
      tab === 'link' ? { url: normalizedUrl! } :
      tab === 'photo' ? { images: photos } :
      { text: text.trim() };
    setBusy(true);
    setError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const res = await importRecipe(source, controller.signal);
    if (controller.signal.aborted) return;
    setBusy(false);
    if (res.ok && res.meal) {
      onImported(res.meal);
    } else {
      setError(res.error || 'Something went wrong. Try again.');
    }
  };

  const tabs: { key: SourceTab; label: string; icon: React.ReactNode }[] = [
    { key: 'link', label: 'Web link', icon: <Link2 size={12} strokeWidth={2.2} /> },
    { key: 'photo', label: 'Photo', icon: <Camera size={12} strokeWidth={2.2} /> },
    { key: 'text', label: 'Text', icon: <ClipboardType size={12} strokeWidth={2.2} /> },
  ];

  return (
    <div className={`rcx${phoneMode ? ' is-phone' : ''}`}>
      {/* ── Header ── */}
      <div className="rcx-head">
        <div className="rcx-head-row">
          {tabSlot}
          <div className="rcx-head-actions">
            <button type="button" className="rcx-head-close" onClick={onClose} aria-label="Close">
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="rcx-title-row">
          <h2 className="rcx-step-title">Import a recipe</h2>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="rcx-body" style={{ paddingBottom: 'calc(120px + var(--kb-height, 0px))' }}>
        {busy ? (
          <div className="rcx-ai-loading">
            <div className="rcx-ai-orb"><FileText size={30} /></div>
            <div className="rcx-ai-loading-title">{loadingTitle}</div>
            <p className="rcx-ai-loading-sub">
              Transcribing the original faithfully — ingredients, steps, timings, and the author's notes.
            </p>
            {elapsed >= 3 && <span className="rcx-ai-loading-secs">{elapsed}s</span>}
          </div>
        ) : (
          <div className="rcx-step-anim rcx-ai-stack">
            <div className="rcx-src-seg" role="tablist">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  className={`rcx-src-btn${tab === t.key ? ' is-on' : ''}`}
                  onClick={() => { setTab(t.key); setError(null); }}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'link' && (
              <div>
                <div className="rcx-kicker">Recipe link</div>
                <div className="rcx-search">
                  <Link2 size={15} />
                  <input
                    value={url}
                    onChange={(e) => { setUrl(e.target.value); setError(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleImport(); } }}
                    placeholder="foodblog.com/best-carbonara"
                    inputMode="url"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  {url ? (
                    <button type="button" onClick={() => setUrl('')} aria-label="Clear">
                      <X size={13} />
                    </button>
                  ) : (
                    <button type="button" className="rcx-paste-btn" onClick={handlePasteClipboard}>
                      <ClipboardPaste size={12} strokeWidth={2.2} /> Paste
                    </button>
                  )}
                </div>
                <div className="rcx-hint">
                  Works with most recipe sites and food blogs — the page's own recipe data is used when it has it.
                </div>
              </div>
            )}

            {tab === 'photo' && (
              <div>
                <div className="rcx-kicker">
                  Photos<span className="rcx-kicker-opt"> · up to {MAX_PHOTOS}</span>
                </div>
                {photos.length === 0 ? (
                  <div
                    className="rcx-photo-slot"
                    onClick={() => fileRef.current?.click()}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="rcx-photo-slot-icon"><Camera size={18} /></span>
                    <span className="rcx-photo-slot-text"><strong>Add photos</strong> of the recipe</span>
                    <span className="rcx-photo-slot-sub">
                      A cookbook page, a screenshot, or a handwritten card all work.
                    </span>
                  </div>
                ) : (
                  <div className="rcx-import-thumbs">
                    {photos.map((p, i) => (
                      <div key={i} className="rcx-import-thumb">
                        <img src={p} alt={`Recipe photo ${i + 1}`} />
                        <button
                          type="button"
                          onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                          aria-label="Remove photo"
                        >
                          <X size={11} strokeWidth={2.6} />
                        </button>
                      </div>
                    ))}
                    {photos.length < MAX_PHOTOS && (
                      <button type="button" className="rcx-import-add" onClick={() => fileRef.current?.click()} aria-label="Add another photo">
                        <Plus size={16} strokeWidth={2.2} />
                      </button>
                    )}
                  </div>
                )}
                <div className="rcx-hint">
                  If the recipe continues on another page, add that photo too.
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => { void handleFiles(e.target.files); e.target.value = ''; }}
                />
              </div>
            )}

            {tab === 'text' && (
              <div>
                <div className="rcx-kicker">Recipe text</div>
                <textarea
                  className="rcx-prompt"
                  value={text}
                  onChange={(e) => { setText(e.target.value); setError(null); }}
                  placeholder={'Paste the whole thing — title, ingredients, and steps.\n\nGrandma\'s Sunday Ragù\n2 lbs beef chuck…'}
                  rows={8}
                />
              </div>
            )}

            {error && (
              <p className="rcx-modal-error" style={{ marginTop: -8 }}>
                <AlertCircle size={13} /> {error}
              </p>
            )}

            <p className="rcx-fineprint">
              The importer transcribes the original faithfully — nothing is invented or "improved".
              You'll review the draft and can edit anything before it's saved.
              {onOpenBulk && (
                <>
                  {' '}Moving a whole collection?{' '}
                  <button type="button" className="rcx-fineprint-link" onClick={onOpenBulk}>
                    Use the CSV / JSON bulk importer
                  </button>.
                </>
              )}
            </p>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="rcx-foot">
        <button
          type="button"
          className={cn('rcx-foot-cta', !canSubmit && !busy && 'is-disabled', (canSubmit || busy) && 'is-publish', busy && 'is-busy')}
          onClick={handleImport}
          disabled={busy}
        >
          {busy ? <Loader2 size={15} className="rcx-spin" /> : canSubmit ? <Download size={14} /> : null}
          {ctaLabel}
        </button>
      </div>
    </div>
  );
};
