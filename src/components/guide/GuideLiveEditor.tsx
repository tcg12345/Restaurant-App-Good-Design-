/**
 * GuideLiveEditor — full-screen authoring surface for a guide.
 *
 * Launched from the Guide Creator wizard's footer ("Live edit") and
 * portaled to document.body so it sits above the wizard chrome. The
 * editor is fully controlled: `data` is the working Guide snapshot,
 * `onChange` is called with the next snapshot on every edit (theme +
 * content), `onSave` is the explicit save action, `onClose` returns
 * the user to the wizard.
 *
 * The preview uses the same `<GuideThemeScope>` + Hero/Intro/Entries/
 * Author/EndCap/TOC primitives as the public reader page — the editor
 * just supplies an `EditorAdapter` whose render functions wrap text
 * nodes in `<Editable>` (and similarly for image / chips / score /
 * price). That keeps the editor and reader visually identical.
 */
import React, { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, Layers, Palette, Type as TypeIcon, AlignLeft, AlignCenter, AlignRight, Italic, RotateCcw, X, Plus, PanelRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  GuideThemeScope, GuideHero, GuideIntro, GuideEntries, GuideAuthor, GuideEndCap, GuideTOC,
  ACCENT_SWATCHES, SURFACE_MAP, HEADING_FONT_MAP, BODY_FONT_MAP,
  entryDomId,
  type EditorAdapter, type RenderTextProps,
} from './GuideRender';
import {
  Editable, EditableImage, EditableChips, EditableScore, EditablePrice, SectionChrome,
} from './Editable';
import {
  DEFAULT_THEME, getTheme,
  type Guide, type GuideEntry, type GuideTheme, type GuideVisibilityMap, type ElementStyle,
} from '../../lib/supabase-guides';
import type { UserProfile } from '../../lib/supabase-community';

/* ──────────────────────────────────────────────────────────────── */

interface GuideLiveEditorProps {
  open: boolean;
  data: Guide;
  authorProfile: UserProfile | null;
  onChange: (next: Guide) => void;
  onClose: () => void;
  onSave: () => Promise<boolean>;
}

type InspectorTab = 'design' | 'layout' | 'element';

interface Selection {
  key: string;
  preview: string;
}

const TEXT_KEY_LABELS: Record<string, string> = {
  'title': 'Hero title',
  'subtitle': 'Hero subtitle',
  'intro': 'Intro paragraph',
  'author.name': 'Author name',
  'author.bio': 'Author bio',
};

const ENTRY_FIELD_LABELS: Record<string, string> = {
  name: 'Restaurant name',
  cuisine: 'Cuisine',
  neighborhood: 'Neighborhood',
  hours: 'Hours',
  blurb: 'Entry blurb',
  bestFor: 'Best for',
  tip: 'Insider tip',
};

function labelForSelection(key: string): string {
  if (TEXT_KEY_LABELS[key]) return TEXT_KEY_LABELS[key];
  const m = /^entry\.[^.]+\.(\w+)$/.exec(key);
  if (m) return (ENTRY_FIELD_LABELS[m[1]] || m[1]) + ' — entry';
  return 'Text element';
}

const TEXT_WEIGHTS: { label: string; value: 300 | 400 | 500 | 700 | 800 }[] = [
  { label: 'Light', value: 300 },
  { label: 'Reg',   value: 400 },
  { label: 'Med',   value: 500 },
  { label: 'Bold',  value: 700 },
  { label: 'X-Bold',value: 800 },
];

const TEXT_COLORS: { label: string; value: ElementStyle['color'] }[] = [
  { label: 'Auto',    value: 'auto' },
  { label: 'Accent',  value: 'accent' },
  { label: 'Muted',   value: 'muted' },
  { label: 'Inverse', value: 'inverse' },
];

/* ──────────────────────────────────────────────────────────────── */

export const GuideLiveEditor: React.FC<GuideLiveEditorProps> = ({
  open, data, authorProfile, onChange, onClose, onSave,
}) => {
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('design');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [savedHint, setSavedHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tocActive, setTocActive] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const theme = useMemo(() => getTheme(data), [data]);

  // Body scroll lock + Esc to close — same as the reference editor.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Scroll-spy — highlight the entry currently in view on the TOC.
  useEffect(() => {
    if (!open || !scrollRef.current) return;
    const main = scrollRef.current;
    const onScroll = () => {
      const items = (data.entries || []).map((_, i) => {
        const el = document.getElementById(entryDomId(i));
        return el ? el.getBoundingClientRect().top : Infinity;
      });
      const above = items.filter((t) => t <= 220);
      const idx = above.length ? above.length - 1 : 0;
      setTocActive(idx);
    };
    onScroll();
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => main.removeEventListener('scroll', onScroll);
  }, [open, data.entries]);

  /* ── Mutators ── */
  const setField = useCallback(<K extends keyof Guide>(k: K, v: Guide[K]) => {
    onChange({ ...data, [k]: v });
  }, [data, onChange]);

  const setTheme = useCallback((updater: GuideTheme | ((prev: GuideTheme) => GuideTheme)) => {
    const next = typeof updater === 'function' ? (updater as (prev: GuideTheme) => GuideTheme)(theme) : updater;
    onChange({ ...data, theme: next });
  }, [data, onChange, theme]);

  const setVisibility = useCallback(<K extends keyof GuideVisibilityMap>(k: K, v: boolean) => {
    setTheme((t) => ({ ...t, visibility: { ...t.visibility, [k]: v } }));
  }, [setTheme]);

  const setAuthorOverride = useCallback((k: keyof NonNullable<GuideTheme['authorOverrides']>, v: string) => {
    setTheme((t) => ({
      ...t,
      authorOverrides: { ...(t.authorOverrides || {}), [k]: v },
    }));
  }, [setTheme]);

  const setTextStyle = useCallback((key: string, patch: ElementStyle) => {
    setTheme((t) => ({
      ...t,
      textStyles: { ...t.textStyles, [key]: { ...(t.textStyles[key] || {}), ...patch } },
    }));
  }, [setTheme]);

  const clearTextStyle = useCallback((key: string) => {
    setTheme((t) => {
      const next = { ...t.textStyles };
      delete next[key];
      return { ...t, textStyles: next };
    });
  }, [setTheme]);

  const updateEntry = useCallback((id: string, next: GuideEntry) => {
    setField('entries', data.entries.map((e) => e.id === id ? next : e));
  }, [data.entries, setField]);

  const moveEntry = useCallback((id: string, dir: -1 | 1) => {
    const list = [...data.entries];
    const idx = list.findIndex((e) => e.id === id);
    const ni = idx + dir;
    if (ni < 0 || ni >= list.length) return;
    [list[idx], list[ni]] = [list[ni], list[idx]];
    setField('entries', list);
  }, [data.entries, setField]);

  const removeEntry = useCallback((id: string) => {
    setField('entries', data.entries.filter((e) => e.id !== id));
  }, [data.entries, setField]);

  const addEntry = useCallback(() => {
    const next: GuideEntry = {
      id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      refId: '',
      name: '',
      subtitle: '',
      image: '',
      score: undefined,
      notes: '',
      mustOrder: [],
      bestFor: '',
      insiderTip: '',
      cuisine: '',
      price: '$$',
      neighborhood: '',
      hours: '',
    };
    setField('entries', [...data.entries, next]);
    requestAnimationFrame(() => {
      const el = document.querySelector('.gle-entry:last-of-type');
      if (el && scrollRef.current) {
        const top = el.getBoundingClientRect().top + scrollRef.current.scrollTop - 120;
        scrollRef.current.scrollTo({ top, behavior: 'smooth' });
      }
    });
  }, [data.entries, setField]);

  const jumpToEntry = (idx: number) => {
    const el = document.getElementById(entryDomId(idx));
    if (el && scrollRef.current) {
      const top = el.getBoundingClientRect().top + scrollRef.current.scrollTop - 100;
      scrollRef.current.scrollTo({ top, behavior: 'smooth' });
    }
  };

  /* ── Element focus → flip Inspector to Element tab. ── */
  const onElementFocus = useCallback((key: string, el: HTMLElement) => {
    const preview = (el.textContent || '').trim().slice(0, 60);
    setSelection({ key, preview });
    setInspectorOpen(true);
    setInspectorTab('element');
  }, []);

  const handleSave = useCallback(async () => {
    setBusy(true);
    const ok = await onSave();
    setBusy(false);
    if (ok) {
      setSavedHint(true);
      window.setTimeout(() => setSavedHint(false), 1800);
    }
  }, [onSave]);

  /* ── Editor adapter — feeds every render-prop in GuideRender so the
        primitives wrap their text/images/chips in the editable
        equivalents. ── */
  const renderText = useCallback((p: RenderTextProps) => (
    <Editable
      as={p.as}
      value={p.value}
      onChange={(next) => {
        const k = p.styleKey;
        // Route the text edit back to the right Guide field.
        if (k === 'title') setField('title', next);
        else if (k === 'subtitle') setField('subtitle', next);
        else if (k === 'intro') setField('intro', next);
        else if (k === 'author.name') setAuthorOverride('name', next);
        else if (k === 'author.bio') setAuthorOverride('bio', next);
        else {
          const m = /^entry\.([^.]+)\.(\w+)$/.exec(k);
          if (m) {
            const [, entryId, field] = m;
            const entry = data.entries.find((e) => e.id === entryId);
            if (!entry) return;
            const fieldMap: Record<string, keyof GuideEntry> = {
              name: 'name', cuisine: 'cuisine', neighborhood: 'neighborhood',
              hours: 'hours', blurb: 'notes', bestFor: 'bestFor', tip: 'insiderTip',
            };
            const realField = fieldMap[field];
            if (realField) updateEntry(entryId, { ...entry, [realField]: next });
          }
        }
      }}
      styleKey={p.styleKey}
      textStyles={theme.textStyles}
      className={p.className}
      placeholder={p.placeholder}
      multiline={p.multiline}
      maxLength={p.maxLength}
      baseStyle={p.baseStyle}
      selected={selection?.key === p.styleKey}
      onFocus={onElementFocus}
    />
  ), [data.entries, onElementFocus, selection?.key, setAuthorOverride, setField, theme.textStyles, updateEntry]);

  const renderImage: NonNullable<EditorAdapter['renderImage']> = useCallback((props) => (
    <EditableImage
      src={props.src}
      onChange={(v) => props.onChange?.(v)}
      alt={props.alt}
      className={props.className}
      style={props.style}
      label={props.label || 'Replace photo'}
      showAdvanced={!!props.showAdvanced}
      imgStyle={props.imgStyle}
      onStyleChange={props.onChangeImgStyle}
      imgClassName={props.className}
    />
  ), []);

  const renderChips: NonNullable<EditorAdapter['renderChips']> = useCallback(({ values, onChange, placeholder, chipClass }) => (
    <EditableChips
      values={values}
      onChange={(next) => onChange?.(next)}
      placeholder={placeholder}
      chipClass={chipClass}
    />
  ), []);

  const renderScore: NonNullable<EditorAdapter['renderScore']> = useCallback(({ value, onChange }) => (
    <EditableScore value={value} onChange={(v) => onChange?.(v)} />
  ), []);

  const renderPrice: NonNullable<EditorAdapter['renderPrice']> = useCallback(({ value, onChange }) => (
    <EditablePrice value={value} onChange={(v) => onChange?.(v)} />
  ), []);

  const editor: EditorAdapter = useMemo(() => ({
    renderText,
    renderImage,
    renderChips,
    renderScore,
    renderPrice,
    entryMutators: {
      onMove: (id, dir) => moveEntry(id, dir),
      onDelete: removeEntry,
      onUpdate: updateEntry,
      canMove: (id, dir) => {
        const idx = data.entries.findIndex((e) => e.id === id);
        const ni = idx + dir;
        return ni >= 0 && ni < data.entries.length;
      },
    },
  }), [renderText, renderImage, renderChips, renderScore, renderPrice, moveEntry, removeEntry, updateEntry, data.entries]);

  /* ── Author for hero ── */
  const heroAuthor = useMemo(() => ({
    name: theme.authorOverrides?.name || authorProfile?.display_name || authorProfile?.username || 'You',
    handle: theme.authorOverrides?.handle || authorProfile?.username || '',
    avatar: theme.authorOverrides?.avatar || undefined,
  }), [authorProfile, theme.authorOverrides]);

  if (!open) return null;

  const V = theme.visibility;

  const overlay = (
    <div className={cn('gle-overlay', `density-${theme.density}`, inspectorOpen && 'has-insp', SURFACE_MAP[theme.surface]?.dark && 'is-dark')}>
      {/* ── Top chrome ── */}
      <header className="gle-chrome">
        <div className="gle-chrome-row">
          <div className="gle-chrome-left">
            <button type="button" className="gle-back" onClick={onClose}>
              <ArrowLeft size={14} />
              <span>Back to builder</span>
            </button>
            <span className="gle-chrome-divider" />
            <span className="gle-chrome-eyebrow">Live edit</span>
            <span className="gle-chrome-title">{data.title || 'Untitled guide'}</span>
          </div>
          <div className="gle-chrome-right">
            <span className={cn('gle-saved', savedHint && 'is-shown')}>
              <span className="gle-saved-dot"><Check size={11} strokeWidth={3} /></span>
              <span>All changes saved</span>
            </span>
            <button
              type="button"
              className={cn('gle-icon-toggle', inspectorOpen && 'on')}
              onClick={() => setInspectorOpen((v) => !v)}
              title={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
            >
              <PanelRight size={16} />
            </button>
            <button type="button" className="gle-btn gle-btn-ghost" onClick={onClose}>Done</button>
            <button type="button" className="gle-btn gle-btn-primary" disabled={busy} onClick={handleSave}>
              <span>Save guide</span>
              <Check size={14} strokeWidth={3} />
            </button>
          </div>
        </div>
        <ThemeMiniBar
          theme={theme}
          setTheme={setTheme}
          openInspectorTab={(t) => { setInspectorTab(t); setInspectorOpen(true); }}
        />
      </header>

      {/* ── Body split ── */}
      <div className="gle-split">
        <div className="gle-scroll" ref={scrollRef}>
          <GuideThemeScope theme={theme} className="gle-preview">
            <SectionHostEditor
              label="Hero"
              onOpenSettings={() => { setInspectorTab('layout'); setInspectorOpen(true); }}
            >
              <GuideHero
                guide={data}
                theme={theme}
                author={heroAuthor}
                eyebrow={{ type: data.type === 'recipes' ? 'Recipes' : 'Restaurants', tag: 'Editing draft' }}
                editor={editor}
                onChangeCover={(v) => setField('coverPhoto', v)}
                onChangeHeroImageStyle={(next) => setTheme((t) => ({
                  ...t,
                  heroImageFit: next.fit ?? t.heroImageFit,
                  heroImagePosX: next.posX ?? t.heroImagePosX,
                  heroImagePosY: next.posY ?? t.heroImagePosY,
                  heroImageBrightness: next.brightness ?? t.heroImageBrightness,
                  heroImageSaturation: next.saturate ?? t.heroImageSaturation,
                }))}
              />
            </SectionHostEditor>

            <div className={cn('gle-layout', !V.toc && 'no-toc')}>
              <div className="gle-main-col">
                {(data.intro || (data.tags?.length || 0) > 0 || true) && (
                  <SectionHostEditor
                    label="Intro"
                    onOpenSettings={() => { setInspectorTab('layout'); setInspectorOpen(true); }}
                  >
                    <GuideIntro
                      guide={data}
                      theme={theme}
                      editor={editor}
                      onTagsChange={(next) => setField('tags', next)}
                    />
                  </SectionHostEditor>
                )}

                <SectionHostEditor
                  label={`Entries · ${data.entries.length}`}
                  onOpenSettings={() => { setInspectorTab('layout'); setInspectorOpen(true); }}
                >
                  <>
                    <GuideEntries
                      guide={data}
                      theme={theme}
                      editor={editor}
                      trailing={
                        <button type="button" className="gle-add-entry" onClick={addEntry}>
                          <Plus size={14} />
                          <span>Add another spot</span>
                        </button>
                      }
                    />
                  </>
                </SectionHostEditor>

                {V.author && (
                  <SectionHostEditor
                    label="Author"
                    onOpenSettings={() => { setInspectorTab('layout'); setInspectorOpen(true); }}
                    onToggleVisibility={() => setVisibility('author', !V.author)}
                  >
                    <GuideAuthor
                      guide={data}
                      theme={theme}
                      authorProfile={authorProfile}
                      editor={editor}
                    />
                  </SectionHostEditor>
                )}

                {V.endCap && <GuideEndCap />}
              </div>

              {V.toc && (
                <GuideTOC
                  entries={data.entries}
                  activeIdx={tocActive}
                  onJump={jumpToEntry}
                  trailing={
                    <div className="gle-toc-cta">
                      <button type="button" onClick={addEntry}>
                        <Plus size={12} /><span>Add spot</span>
                      </button>
                    </div>
                  }
                />
              )}
            </div>
          </GuideThemeScope>
        </div>

        {inspectorOpen && (
          <Inspector
            theme={theme}
            setTheme={setTheme}
            setVisibility={setVisibility}
            tab={inspectorTab}
            setTab={setInspectorTab}
            selection={selection}
            setTextStyle={setTextStyle}
            clearTextStyle={clearTextStyle}
            onClose={() => setInspectorOpen(false)}
          />
        )}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
};

/* ────────────────────────────────────────────────────────────────
   Section host with the small hover toolbar.
   ──────────────────────────────────────────────────────────────── */

const SectionHostEditor: React.FC<{
  label: string;
  onOpenSettings?: () => void;
  onToggleVisibility?: () => void;
  hidden?: boolean;
  children: React.ReactNode;
}> = ({ label, onOpenSettings, onToggleVisibility, hidden, children }) => (
  <div className="gle-section-host">
    <SectionChrome
      label={label}
      onOpenSettings={onOpenSettings}
      onToggleVisibility={onToggleVisibility}
      hidden={hidden}
    />
    {children}
  </div>
);

/* ────────────────────────────────────────────────────────────────
   Theme mini bar
   ──────────────────────────────────────────────────────────────── */

const ThemeMiniBar: React.FC<{
  theme: GuideTheme;
  setTheme: (updater: (prev: GuideTheme) => GuideTheme) => void;
  openInspectorTab: (t: InspectorTab) => void;
}> = ({ theme, setTheme, openInspectorTab }) => (
  <div className="gle-mini-bar">
    <div className="gle-mb-group">
      <span className="gle-mb-label">Accent</span>
      <div className="gle-swatches inline">
        {ACCENT_SWATCHES.slice(0, 6).map((c) => (
          <button
            key={c}
            type="button"
            className={cn('gle-swatch', theme.accent === c && 'on')}
            style={{ background: c }}
            onClick={() => setTheme((t) => ({ ...t, accent: c }))}
            aria-label={`Accent ${c}`}
          />
        ))}
      </div>
    </div>
    <span className="gle-mb-sep" />
    <button type="button" className="gle-mb-link" onClick={() => openInspectorTab('design')}>
      <Palette size={13} /><span>Design</span>
    </button>
    <button type="button" className="gle-mb-link" onClick={() => openInspectorTab('layout')}>
      <Layers size={13} /><span>Layout</span>
    </button>
    <button type="button" className="gle-mb-link" onClick={() => openInspectorTab('element')}>
      <TypeIcon size={13} /><span>Element</span>
    </button>
  </div>
);

/* ────────────────────────────────────────────────────────────────
   Inspector
   ──────────────────────────────────────────────────────────────── */

const TABS: { key: InspectorTab; label: string; icon: React.ReactNode }[] = [
  { key: 'design',  label: 'Design',  icon: <Palette size={13} /> },
  { key: 'layout',  label: 'Layout',  icon: <Layers size={13} /> },
  { key: 'element', label: 'Element', icon: <TypeIcon size={13} /> },
];

const Inspector: React.FC<{
  theme: GuideTheme;
  setTheme: (updater: (prev: GuideTheme) => GuideTheme) => void;
  setVisibility: <K extends keyof GuideVisibilityMap>(k: K, v: boolean) => void;
  tab: InspectorTab;
  setTab: (t: InspectorTab) => void;
  selection: Selection | null;
  setTextStyle: (key: string, patch: ElementStyle) => void;
  clearTextStyle: (key: string) => void;
  onClose: () => void;
}> = ({ theme, setTheme, setVisibility, tab, setTab, selection, setTextStyle, clearTextStyle, onClose }) => {
  const set = <K extends keyof GuideTheme>(k: K, v: GuideTheme[K]) =>
    setTheme((t) => ({ ...t, [k]: v }));

  return (
    <aside className="gle-inspector">
      <div className="gle-insp-head">
        <span className="gle-insp-title">Inspector</span>
        <button type="button" className="gle-insp-close" onClick={onClose} title="Hide inspector">
          <X size={14} />
        </button>
      </div>
      <div className="gle-insp-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={cn('gle-insp-tab', tab === t.key && 'on')}
            onClick={() => setTab(t.key)}
          >
            <span className="gle-tab-ico">{t.icon}</span>
            <span>{t.label}</span>
            {t.key === 'element' && selection && <span className="gle-tab-dot" />}
          </button>
        ))}
      </div>
      <div className="gle-insp-body">
        {tab === 'design'  && <DesignTab theme={theme} set={set} setTheme={setTheme} />}
        {tab === 'layout'  && <LayoutTab theme={theme} set={set} setVisibility={setVisibility} />}
        {tab === 'element' && (
          <ElementTab
            theme={theme}
            selection={selection}
            setTextStyle={setTextStyle}
            clearTextStyle={clearTextStyle}
          />
        )}
      </div>
      <div className="gle-insp-foot">
        <button
          type="button"
          className="gle-insp-reset"
          onClick={() => setTheme(() => ({ ...DEFAULT_THEME }))}
          title="Reset all customization"
        >
          <RotateCcw size={13} /><span>Reset all</span>
        </button>
      </div>
    </aside>
  );
};

/* ── Reusable controls ── */

const InspectorGroup: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="gle-grp">
    <div className="gle-grp-head"><span>{label}</span></div>
    <div className="gle-grp-body">{children}</div>
  </div>
);

const SegRow: React.FC<{
  options: { label: string; value: string | number }[];
  value: string | number | null | undefined;
  onChange: (v: string | number) => void;
}> = ({ options, value, onChange }) => (
  <div className="gle-seg">
    {options.map((o) => (
      <button
        key={String(o.value)}
        type="button"
        className={cn('gle-seg-btn', o.value === value && 'on')}
        onClick={() => onChange(o.value)}
      >
        {o.label}
      </button>
    ))}
  </div>
);

const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void; label: string }> = ({ on, onChange, label }) => (
  <label className="gle-toggle">
    <span>{label}</span>
    <span className={cn('gle-toggle-track', on && 'on')} onClick={() => onChange(!on)}>
      <span className="gle-toggle-thumb" />
    </span>
  </label>
);

const SliderRow: React.FC<{
  label: string; value: number; min: number; max: number; step?: number; suffix?: string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step = 1, suffix = '', onChange }) => (
  <div className="gle-slider-row">
    <div className="gle-slider-head">
      <span>{label}</span>
      <span className="gle-slider-val">{value}{suffix}</span>
    </div>
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
    />
  </div>
);

/* ── Design tab ── */

const DesignTab: React.FC<{
  theme: GuideTheme;
  set: <K extends keyof GuideTheme>(k: K, v: GuideTheme[K]) => void;
  setTheme: (updater: (prev: GuideTheme) => GuideTheme) => void;
}> = ({ theme, set, setTheme }) => (
  <>
    <InspectorGroup label="Accent color">
      <div className="gle-swatches">
        {ACCENT_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            className={cn('gle-swatch', theme.accent === c && 'on')}
            style={{ background: c }}
            onClick={() => set('accent', c)}
            aria-label={c}
          />
        ))}
        <label className="gle-swatch-custom" title="Custom color">
          <input type="color" value={theme.accent} onChange={(e) => set('accent', e.target.value)} />
          <span>+</span>
        </label>
      </div>
      <div className="gle-hex-row">
        <span className="gle-hex-label">HEX</span>
        <input
          className="gle-input gle-hex-input"
          value={theme.accent}
          onChange={(e) => {
            const v = e.target.value;
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) set('accent', v);
          }}
        />
      </div>
    </InspectorGroup>

    <InspectorGroup label="Surface">
      <div className="gle-surf-grid">
        {(Object.entries(SURFACE_MAP) as [keyof typeof SURFACE_MAP, typeof SURFACE_MAP[keyof typeof SURFACE_MAP]][])
          .map(([key, info]) => (
            <button
              key={key}
              type="button"
              className={cn('gle-surf-card', theme.surface === key && 'on')}
              onClick={() => set('surface', key)}
            >
              <span className="gle-surf-prev" style={{ background: info.bg, color: info.ink }}>Aa</span>
              <span>{info.label}</span>
            </button>
          ))}
      </div>
    </InspectorGroup>

    <InspectorGroup label="Heading font">
      <div className="gle-font-list">
        {(Object.entries(HEADING_FONT_MAP) as [keyof typeof HEADING_FONT_MAP, typeof HEADING_FONT_MAP[keyof typeof HEADING_FONT_MAP]][])
          .map(([key, info]) => (
            <button
              key={key}
              type="button"
              className={cn('gle-font-row', theme.headingFont === key && 'on')}
              onClick={() => set('headingFont', key)}
              style={{ fontFamily: info.stack }}
            >
              <span className="gle-font-name">{info.label}</span>
              <span className="gle-font-sample">The best ramen</span>
            </button>
          ))}
      </div>
    </InspectorGroup>

    <InspectorGroup label="Body font">
      <div className="gle-font-list">
        {(Object.entries(BODY_FONT_MAP) as [keyof typeof BODY_FONT_MAP, typeof BODY_FONT_MAP[keyof typeof BODY_FONT_MAP]][])
          .map(([key, info]) => (
            <button
              key={key}
              type="button"
              className={cn('gle-font-row', theme.bodyFont === key && 'on')}
              onClick={() => set('bodyFont', key)}
              style={{ fontFamily: info.stack }}
            >
              <span className="gle-font-name">{info.label}</span>
              <span className="gle-font-sample">Quick brown fox</span>
            </button>
          ))}
      </div>
    </InspectorGroup>

    <InspectorGroup label="Density">
      <SegRow
        options={[{ label: 'Compact', value: 'compact' }, { label: 'Comfortable', value: 'comfortable' }, { label: 'Spacious', value: 'spacious' }]}
        value={theme.density}
        onChange={(v) => set('density', v as GuideTheme['density'])}
      />
    </InspectorGroup>

    <InspectorGroup label="Corners">
      <SegRow
        options={[{ label: 'Sharp', value: 'sharp' }, { label: 'Soft', value: 'soft' }, { label: 'Round', value: 'round' }]}
        value={theme.radius}
        onChange={(v) => set('radius', v as GuideTheme['radius'])}
      />
    </InspectorGroup>
  </>
);

/* ── Layout tab ── */

const LayoutTab: React.FC<{
  theme: GuideTheme;
  set: <K extends keyof GuideTheme>(k: K, v: GuideTheme[K]) => void;
  setVisibility: <K extends keyof GuideVisibilityMap>(k: K, v: boolean) => void;
}> = ({ theme, set, setVisibility }) => {
  const V = theme.visibility;
  return (
    <>
      <InspectorGroup label="Hero">
        <div className="gle-sub-label">Layout</div>
        <SegRow
          options={[{ label: 'Classic', value: 'classic' }, { label: 'Centered', value: 'centered' }, { label: 'Split', value: 'split' }, { label: 'Minimal', value: 'minimal' }]}
          value={theme.heroLayout}
          onChange={(v) => set('heroLayout', v as GuideTheme['heroLayout'])}
        />
        <div className="gle-sub-label">Text alignment</div>
        <SegRow
          options={[{ label: 'Left', value: 'left' }, { label: 'Center', value: 'center' }]}
          value={theme.heroAlign}
          onChange={(v) => set('heroAlign', v as GuideTheme['heroAlign'])}
        />
        <SliderRow label="Scrim darkness"    value={theme.heroScrim}            min={0}  max={100} suffix="%" onChange={(v) => set('heroScrim', v)} />
        <SliderRow label="Image brightness" value={theme.heroImageBrightness}  min={40} max={140} suffix="%" onChange={(v) => set('heroImageBrightness', v)} />
        <SliderRow label="Image saturation" value={theme.heroImageSaturation}  min={0}  max={180} suffix="%" onChange={(v) => set('heroImageSaturation', v)} />
        <SliderRow label="Image focal X"    value={theme.heroImagePosX}        min={0}  max={100} suffix="%" onChange={(v) => set('heroImagePosX', v)} />
        <SliderRow label="Image focal Y"    value={theme.heroImagePosY}        min={0}  max={100} suffix="%" onChange={(v) => set('heroImagePosY', v)} />
        <div className="gle-sub-label">Show</div>
        <Toggle on={V.heroEyebrow} onChange={(v) => setVisibility('heroEyebrow', v)} label="Eyebrow / breadcrumb" />
        <Toggle on={V.heroAuthor}  onChange={(v) => setVisibility('heroAuthor', v)}  label="Author chip" />
        <Toggle on={V.heroStats}   onChange={(v) => setVisibility('heroStats', v)}   label="Stats (spots, score)" />
        <Toggle on={V.heroActions} onChange={(v) => setVisibility('heroActions', v)} label="Action buttons" />
      </InspectorGroup>

      <InspectorGroup label="Intro">
        <div className="gle-sub-label">Style</div>
        <SegRow
          options={[{ label: 'Plain', value: 'plain' }, { label: 'Bordered', value: 'bordered' }, { label: 'Accent', value: 'accent' }]}
          value={theme.introStyle}
          onChange={(v) => set('introStyle', v as GuideTheme['introStyle'])}
        />
        <div className="gle-sub-label">Show</div>
        <Toggle on={V.introQuote} onChange={(v) => setVisibility('introQuote', v)} label="Quote mark" />
        <Toggle on={V.introTags}  onChange={(v) => setVisibility('introTags', v)}  label="Tag chips" />
      </InspectorGroup>

      <InspectorGroup label="Entries">
        <div className="gle-sub-label">Layout</div>
        <SegRow
          options={[{ label: 'Sidebar', value: 'sidebar' }, { label: 'Banner', value: 'banner' }, { label: 'Minimal', value: 'minimal' }]}
          value={theme.entryLayout}
          onChange={(v) => set('entryLayout', v as GuideTheme['entryLayout'])}
        />
        <Toggle on={theme.entryShowPhoto} onChange={(v) => set('entryShowPhoto', v)} label="Show entry photo" />
        <div className="gle-sub-label">Show fields</div>
        <Toggle on={V.entryScore}     onChange={(v) => setVisibility('entryScore', v)}     label="Score badge" />
        <Toggle on={V.entryMeta}      onChange={(v) => setVisibility('entryMeta', v)}      label="Cuisine · price · location" />
        <Toggle on={V.entryHours}     onChange={(v) => setVisibility('entryHours', v)}     label="Hours" />
        <Toggle on={V.entryActions}   onChange={(v) => setVisibility('entryActions', v)}   label="Save / add actions" />
        <Toggle on={V.entryMustOrder} onChange={(v) => setVisibility('entryMustOrder', v)} label="Must order" />
        <Toggle on={V.entryBestFor}   onChange={(v) => setVisibility('entryBestFor', v)}   label="Best for" />
        <Toggle on={V.entryTip}       onChange={(v) => setVisibility('entryTip', v)}       label="Insider tip" />
        <Toggle on={V.entryCta}       onChange={(v) => setVisibility('entryCta', v)}       label="View restaurant link" />
      </InspectorGroup>

      <InspectorGroup label="Other sections">
        <Toggle on={V.toc}    onChange={(v) => setVisibility('toc', v)}    label="Table of contents" />
        <Toggle on={V.author} onChange={(v) => setVisibility('author', v)} label="Author panel" />
        <Toggle on={V.endCap} onChange={(v) => setVisibility('endCap', v)} label="End cap" />
      </InspectorGroup>
    </>
  );
};

/* ── Element tab ── */

const ElementTab: React.FC<{
  theme: GuideTheme;
  selection: Selection | null;
  setTextStyle: (key: string, patch: ElementStyle) => void;
  clearTextStyle: (key: string) => void;
}> = ({ theme, selection, setTextStyle, clearTextStyle }) => {
  if (!selection) {
    return (
      <div className="gle-empty">
        <div className="gle-empty-ico"><TypeIcon size={22} /></div>
        <div className="gle-empty-title">No element selected</div>
        <div className="gle-empty-sub">Click any text in the guide preview to style it individually — size, weight, italic, color, alignment & family.</div>
      </div>
    );
  }
  const key = selection.key;
  const cur = theme.textStyles[key] || {};
  const setStyle = (patch: ElementStyle) => setTextStyle(key, patch);

  return (
    <>
      <div className="gle-elem-head">
        <div>
          <div className="gle-elem-eyebrow">Editing</div>
          <div className="gle-elem-label">{labelForSelection(key)}</div>
        </div>
        <button type="button" className="gle-mini ghost" onClick={() => clearTextStyle(key)} title="Clear overrides">
          <RotateCcw size={11} /><span>Reset</span>
        </button>
      </div>
      {selection.preview && <div className="gle-elem-sample">&ldquo;{selection.preview}&rdquo;</div>}

      <InspectorGroup label="Size">
        <SliderRow
          label="Scale"
          value={cur.size ?? 100}
          min={50} max={250} step={5} suffix="%"
          onChange={(v) => setStyle({ size: v })}
        />
      </InspectorGroup>

      <InspectorGroup label="Weight">
        <SegRow options={TEXT_WEIGHTS as { label: string; value: number }[]} value={cur.weight ?? null} onChange={(v) => setStyle({ weight: v as ElementStyle['weight'] })} />
      </InspectorGroup>

      <InspectorGroup label="Style">
        <div className="gle-row-pair">
          <button type="button" className={cn('gle-mini-toggle', cur.italic && 'on')}
            onClick={() => setStyle({ italic: !cur.italic })}>
            <Italic size={12} /><span>Italic</span>
          </button>
          <button type="button" className={cn('gle-mini-toggle', cur.family === 'serif' && 'on')}
            onClick={() => setStyle({ family: cur.family === 'serif' ? 'auto' : 'serif' })}>
            Serif
          </button>
          <button type="button" className={cn('gle-mini-toggle', cur.family === 'sans' && 'on')}
            onClick={() => setStyle({ family: cur.family === 'sans' ? 'auto' : 'sans' })}>
            Sans
          </button>
        </div>
      </InspectorGroup>

      <InspectorGroup label="Alignment">
        <div className="gle-align-row">
          <button type="button" className={cn('gle-mini-toggle', cur.align === 'left' && 'on')}
            onClick={() => setStyle({ align: 'left' })} aria-label="Align left"><AlignLeft size={14} /></button>
          <button type="button" className={cn('gle-mini-toggle', cur.align === 'center' && 'on')}
            onClick={() => setStyle({ align: 'center' })} aria-label="Align center"><AlignCenter size={14} /></button>
          <button type="button" className={cn('gle-mini-toggle', cur.align === 'right' && 'on')}
            onClick={() => setStyle({ align: 'right' })} aria-label="Align right"><AlignRight size={14} /></button>
        </div>
      </InspectorGroup>

      <InspectorGroup label="Color">
        <div className="gle-color-row">
          {TEXT_COLORS.map((c) => (
            <button
              key={String(c.value)}
              type="button"
              className={cn('gle-color-chip', (cur.color || 'auto') === c.value && 'on')}
              onClick={() => setStyle({ color: c.value })}
              data-tone={c.value as string}
            >
              <span className="gle-color-dot" />
              <span>{c.label}</span>
            </button>
          ))}
        </div>
        <div className="gle-hex-row">
          <label className="gle-color-pick" title="Pick a custom color">
            <input
              type="color"
              value={cur.color && cur.color.startsWith('#') ? cur.color : theme.accent}
              onChange={(e) => setStyle({ color: e.target.value as ElementStyle['color'] })}
            />
            <span style={{ background: cur.color && cur.color.startsWith('#') ? cur.color : 'transparent' } as CSSProperties} />
          </label>
          <input
            className="gle-input gle-hex-input"
            placeholder="#hex"
            value={cur.color && cur.color.startsWith('#') ? cur.color : ''}
            onChange={(e) => {
              const v = e.target.value;
              if (/^#[0-9a-fA-F]{0,6}$/.test(v) || v === '') setStyle({ color: (v || 'auto') as ElementStyle['color'] });
            }}
          />
        </div>
      </InspectorGroup>
    </>
  );
};
