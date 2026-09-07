// "Import" flow of the Add Recipe modal — bring a recipe in from
// somewhere else: a web link, photos (cookbook page / screenshot /
// handwritten card), or pasted text. The import-recipe Edge Function
// transcribes the source with AI and the result lands on the Advanced
// builder's Review step as a fully editable draft.
//
// On phone each source is its own page — the method chooser routes
// straight into it, so there's no in-page tab switcher. On desktop the
// three sources stay as a segmented control for quick switching.
//
// Shares the rcx- design language with the Advanced builder and the AI
// generator: same header and footer CTA.

import React, { useEffect, useRef, useState } from 'react';
import { GlassButton } from '../lib/glass-buttons';
import { X, Link2, Camera, ClipboardType, ClipboardPaste, Plus, Loader2, Download, AlertCircle, FileText } from 'lucide-react';
import { cn } from '../lib/utils';
import { usePaywall } from '../contexts/PaywallContext';
import { QuotaMeter } from './pro/QuotaMeter';
import type { HomeMeal } from '../contexts/ListsContext';
import { importRecipe, compressImportPhoto, type ImportSource } from '../lib/import-recipe-client';
import './AdvancedRecipeBuilder.css';
import './RecipeBuilder.css';
import { RecipeGeneration, RecipeSourceIntro } from './RecipeGeneration';
import './RecipeCreation.css';

type SourceTab = 'link' | 'photo' | 'text';

interface ImportRecipePanelProps {
  /** Called with the transcribed HomeMeal — the parent seeds the
   *  Advanced builder with it (Review step) for checking + publish. */
  onImported: (meal: HomeMeal) => void;
  /** Close the whole Add Recipe modal. */
  onClose: () => void;
  /** Header-left slot (the "back to methods" chip), injected by the parent. */
  tabSlot?: React.ReactNode;
  phoneMode?: boolean;
  /** Which source tab to open on — set by the method chooser. */
  initialTab?: 'link' | 'photo' | 'text';
}

const MAX_PHOTOS = 3;

/** Phone-mode page title per source (desktop keeps the tabs + generic title). */
const TITLE_BY_TAB: Record<SourceTab, string> = {
  link: 'Import from a link',
  photo: 'Scan a recipe',
  text: 'Import from text',
};

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
  initialTab,
}) => {
  const [tab, setTab] = useState<SourceTab>(initialTab || 'link');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { handleAiError } = usePaywall();

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

  const cancelImport = () => { abortRef.current?.abort(); abortRef.current = null; setBusy(false); };

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
      const feature = 'url' in source && source.url ? 'recipe-import-link' : 'images' in source && source.images?.length ? 'recipe-import-photo' : 'recipe-import-text';
      if (!handleAiError(feature, res)) setError(res.error || 'Something went wrong. Try again.');
    }
  };

  const tabs: { key: SourceTab; label: string; icon: React.ReactNode }[] = [
    { key: 'link', label: 'Web link', icon: <Link2 size={12} strokeWidth={2.2} /> },
    { key: 'photo', label: 'Photo', icon: <Camera size={12} strokeWidth={2.2} /> },
    { key: 'text', label: 'Text', icon: <ClipboardType size={12} strokeWidth={2.2} /> },
  ];

  return (
    <div className={`rcx recipe-create recipe-import${phoneMode ? ' is-phone' : ''}`}>
      {/* ── Header ── */}
      <div className="rcx-head">
        <div className="rcx-head-row">
          {tabSlot}
          <div className="rcx-head-actions">
            <GlassButton
              id="recipe-import-close"
              symbol="xmark"
              label="Close"
              onClick={onClose}
              className="rcx-head-close"
            >
              <X size={14} />
            </GlassButton>
          </div>
        </div>
        <div className="rcx-title-row">
          <h2 className="rcx-step-title">{phoneMode ? TITLE_BY_TAB[tab] : 'Import a recipe'}</h2>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="rcx-body">
        {busy ? (
          <RecipeGeneration kind={tab} elapsed={elapsed} onCancel={cancelImport} />
        ) : (
          <div className="rcx-step-anim rcx-ai-stack">
            {/* Desktop keeps the source switcher; on phone each source is
                its own page reached from the method chooser. */}
            {!phoneMode && (
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
            )}

            <RecipeSourceIntro source={tab} />
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
                    aria-label="Recipe web link"
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
                  Paste a direct link to the recipe. You can review everything before saving.
                </div>
              </div>
            )}

            {tab === 'photo' && (
              <div>
                <div className="rcx-kicker">
                  Photos<span className="rcx-kicker-opt"> · up to {MAX_PHOTOS}</span>
                </div>
                {photos.length === 0 ? (
                  <button type="button"
                    className="rcx-photo-slot"
                    onClick={() => fileRef.current?.click()}
                  >
                    <span className="rcx-photo-slot-icon"><Camera size={18} /></span>
                    <span className="rcx-photo-slot-text"><strong>Add photos</strong> of the recipe</span>
                    <span className="rcx-photo-slot-sub">
                      A cookbook page, a screenshot, or a handwritten card all work.
                    </span>
                  </button>
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
                  aria-label="Recipe text"
                  value={text}
                  onChange={(e) => { setText(e.target.value); setError(null); }}
                  placeholder={'Recipe name\n\nIngredients…\n\nHow to make it…'}
                  rows={8}
                />
              </div>
            )}

            {error && (
              <p className="rcx-modal-error" style={{ marginTop: -8 }}>
                <AlertCircle size={13} /> {error}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      {!busy && <div className="rcx-foot">
        {tab !== 'photo' && <QuotaMeter feature={tab === 'link' ? 'recipe-import-link' : 'recipe-import-text'} className="rcx-foot-meter" />}
        <button
          type="button"
          className={cn('rcx-foot-cta', !canSubmit && !busy && 'is-disabled', (canSubmit || busy) && 'is-publish', busy && 'is-busy')}
          onClick={handleImport}
          disabled={!canSubmit}
        >
          {busy ? <Loader2 size={15} className="rcx-spin" /> : canSubmit ? <Download size={14} /> : null}
          {ctaLabel}
        </button>
      </div>}
    </div>
  );
};
