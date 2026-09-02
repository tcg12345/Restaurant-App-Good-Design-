/**
 * GuideRender — shared visual primitives used by both the public
 * `/guides/:id` reader page and the Live Editor's preview pane.
 *
 * Every primitive is "read-only" by default — they render plain text.
 * The Live Editor swaps the inner text nodes for <Editable> instances
 * via the `renderText` prop, so the same hero / intro / entry layout
 * code drives both surfaces and customization stays single-sourced.
 *
 * <GuideThemeScope> emits all theme tokens as CSS custom properties on
 * its root element, plus variant classes (`hero-classic`, `entry-banner`,
 * `intro-accent`, `radius-soft`, `density-comfortable`, `is-dark`, …) so
 * the CSS in GuideRender.css can target each variant without prop
 * threading. Token tables (SURFACE_MAP, HEADING_FONT_MAP, BODY_FONT_MAP)
 * live here as exported constants so the Inspector can iterate them.
 */
import React, { type CSSProperties, type ReactNode } from 'react';
import { Bookmark, MapIcon, ChefHat, BookOpen, Plus, Clock, MapPin, Check, ArrowUpRight } from 'lucide-react';
import { ShareIcon } from '../icons/ShareIcon';
import { cn } from '../../lib/utils';
import { Logo } from '../Logo';
import { ScoreBadge } from '../ScoreBadge';
import {
  getTheme, DEFAULT_THEME,
  type Guide, type GuideEntry, type GuideTheme, type ElementStyle, type CustomSection,
} from '../../lib/supabase-guides';
import { useSettings } from '../../contexts/SettingsContext';
import type { UserProfile } from '../../lib/supabase-community';

/* ─────────────────────────────────────────────────────────────────
   Token tables — single source of truth for surface palettes and
   font families. Exported so the Inspector's Design tab can render
   the same cards / font samples without duplicating the values.
   ───────────────────────────────────────────────────────────────── */

export const SURFACE_MAP: Record<GuideTheme['surface'], {
  label: string;
  bg: string;
  card: string;
  ink: string;
  inkMuted: string;
  line: string;
  dark: boolean;
}> = {
  cream: {
    label: 'Cream',
    bg: '#f4f2ec', card: '#fbfaf6', ink: '#1e1b1a',
    inkMuted: 'rgba(30,27,26,0.55)', line: 'rgba(30,27,26,0.08)',
    dark: false,
  },
  paper: {
    label: 'Paper',
    bg: '#ffffff', card: '#fafaf8', ink: '#1e1b1a',
    inkMuted: 'rgba(30,27,26,0.55)', line: 'rgba(30,27,26,0.08)',
    dark: false,
  },
  sand: {
    label: 'Sand',
    bg: '#f5ede1', card: '#fbf5ea', ink: '#2a2520',
    inkMuted: 'rgba(42,37,32,0.55)', line: 'rgba(42,37,32,0.10)',
    dark: false,
  },
  mist: {
    label: 'Mist',
    bg: '#eef2f1', card: '#f8faf9', ink: '#1e1b1a',
    inkMuted: 'rgba(30,27,26,0.55)', line: 'rgba(30,27,26,0.08)',
    dark: false,
  },
  slate: {
    label: 'Slate',
    bg: '#1c1a18', card: '#252220', ink: '#f4ede4',
    inkMuted: 'rgba(244,237,228,0.65)', line: 'rgba(244,237,228,0.12)',
    dark: true,
  },
};

export const HEADING_FONT_MAP: Record<GuideTheme['headingFont'], { label: string; stack: string }> = {
  'noto-serif': { label: 'Noto Serif', stack: '"Noto Serif", "Times New Roman", Georgia, serif' },
  'playfair':   { label: 'Playfair',   stack: '"Playfair Display", "Times New Roman", Georgia, serif' },
  'fraunces':   { label: 'Fraunces',   stack: '"Fraunces", "Times New Roman", Georgia, serif' },
  'dm-serif':   { label: 'DM Serif',   stack: '"DM Serif Display", "Times New Roman", Georgia, serif' },
};

export const BODY_FONT_MAP: Record<GuideTheme['bodyFont'], { label: string; stack: string }> = {
  'manrope':  { label: 'Manrope',  stack: '"Manrope", system-ui, sans-serif' },
  'inter':    { label: 'Inter',    stack: '"Inter", system-ui, sans-serif' },
  'ibm-plex': { label: 'IBM Plex', stack: '"IBM Plex Sans", system-ui, sans-serif' },
};

export const ACCENT_SWATCHES = [
  '#1C1A19', '#C9B48E', '#B45309', '#5C6144', '#1F5C3F',
  '#1F3A5F', '#2F4858', '#6B2D5C', '#7C2D12', '#1e1b1a',
];

/* Convert an ElementStyle override into an inline-style object. Mirrors
   the reference's `computeTextStyle` 1:1; both the editor and the reader
   call this so the same overrides produce identical text. */
export function computeTextStyle(s: ElementStyle | undefined): CSSProperties | undefined {
  if (!s) return undefined;
  const out: CSSProperties = {};
  if (s.size && s.size !== 100) out.fontSize = `${s.size}%`;
  if (s.weight) out.fontWeight = s.weight;
  if (s.italic) out.fontStyle = 'italic';
  if (s.align) out.textAlign = s.align;
  if (s.family === 'serif') out.fontFamily = 'var(--gle-font-serif)';
  else if (s.family === 'sans') out.fontFamily = 'var(--gle-font-sans)';
  if (s.color && s.color !== 'auto') {
    if (s.color === 'accent') out.color = 'var(--gle-accent)';
    else if (s.color === 'muted') out.color = 'var(--gle-ink-muted)';
    else if (s.color === 'inverse') out.color = 'var(--gle-surface)';
    else out.color = s.color;
  }
  if (s.letterSpacing !== undefined) out.letterSpacing = `${s.letterSpacing}em`;
  return out;
}

/* ─────────────────────────────────────────────────────────────────
   Theme scope — root container that emits CSS variables and variant
   classes. Wrap a guide rendering tree in this and every primitive
   below picks up the theme.
   ───────────────────────────────────────────────────────────────── */

export const GuideThemeScope: React.FC<{
  theme?: GuideTheme;
  className?: string;
  children: ReactNode;
}> = ({ theme: themeIn, className, children }) => {
  const settings = useSettings();
  const baseTheme: GuideTheme = themeIn ?? DEFAULT_THEME;
  // Surface always follows the app's light / dark mode, never the
  // saved theme. The `surface` field is kept on GuideTheme for
  // backwards compat with already-persisted guides, but it's ignored
  // at render time so the same guide reads cleanly for both a
  // light-mode and a dark-mode viewer.
  const surfaceKey: GuideTheme['surface'] = settings?.darkMode ? 'slate' : 'cream';
  const theme: GuideTheme = { ...baseTheme, surface: surfaceKey };
  const surface = SURFACE_MAP[surfaceKey];
  const heading = HEADING_FONT_MAP[theme.headingFont as keyof typeof HEADING_FONT_MAP] || HEADING_FONT_MAP['noto-serif'];
  const body = BODY_FONT_MAP[theme.bodyFont as keyof typeof BODY_FONT_MAP] || BODY_FONT_MAP['manrope'];

  const style: CSSProperties & Record<string, string> = {
    '--gle-accent': theme.accent,
    '--gle-surface': surface.bg,
    '--gle-card': surface.card,
    '--gle-ink': surface.ink,
    '--gle-ink-muted': surface.inkMuted,
    '--gle-line': surface.line,
    '--gle-font-serif': heading.stack,
    '--gle-font-sans': body.stack,
    color: surface.ink,
    fontFamily: body.stack,
  };

  return (
    <div
      className={cn(
        'gle-scope',
        `hero-${theme.heroLayout}`,
        `entry-${theme.entryLayout}`,
        `intro-${theme.introStyle}`,
        `radius-${theme.radius}`,
        `density-${theme.density}`,
        `align-${theme.heroAlign}`,
        surface.dark && 'is-dark',
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────
   Render helpers
   ───────────────────────────────────────────────────────────────── */

/** Resolve an entry's display cuisine and price either from the new
 *  standalone fields or by parsing the legacy "cuisine · price ·
 *  neighborhood" subtitle string. The Live Editor writes the fields
 *  directly; older entries still round-trip via subtitle. */
export function readEntryMeta(entry: GuideEntry): { cuisine: string; price: string } {
  if (entry.cuisine || entry.price) {
    return { cuisine: entry.cuisine || '', price: entry.price || '' };
  }
  const parts = (entry.subtitle || '').split(/\s·\s/).map((s) => s.trim()).filter(Boolean);
  let cuisine = '';
  let price = '';
  for (const p of parts) {
    if (/^\$+$/.test(p)) price = p;
    else if (!cuisine) cuisine = p;
  }
  return { cuisine, price };
}

/** Stable DOM id for an entry within the rendering tree, used by both
 *  the public reader's scroll-spy and the editor's TOC scroll-spy. */
export function entryDomId(idx: number): string {
  return `guide-entry-${idx}`;
}

const numLabel = (n: number) => n.toString().padStart(2, '0');

/* ─────────────────────────────────────────────────────────────────
   Editor adapter — primitives accept these optional callbacks to
   enable inline editing. When omitted (the default for the public
   reader), every text becomes a plain element.

   `renderText` lets the editor swap a span/p/h2/h3 for an <Editable>
   without the primitives knowing anything about contentEditable.
   ───────────────────────────────────────────────────────────────── */

export interface RenderTextProps {
  as: 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'div';
  value: string;
  styleKey: string;
  className?: string;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  baseStyle?: CSSProperties;
  /** When true, the rendered node is selectable for per-element
   *  styling (Element tab) but cannot have its text edited. */
  readOnly?: boolean;
}

export type RenderTextFn = (props: RenderTextProps) => ReactNode;

const defaultRenderText: RenderTextFn = ({ as, value, styleKey, className, baseStyle }) => {
  const style = baseStyle ? { ...baseStyle } : undefined;
  return React.createElement(as, { className, style, 'data-style-key': styleKey }, value);
};

/** Per-image style knobs that the editor can persist. Hero passes
 *  these from `theme.hero*`; entry photos don't use them. */
export interface ImageStyleProps {
  fit?: 'cover' | 'contain';
  posX?: number;
  posY?: number;
  brightness?: number;
  saturate?: number;
}

export interface RenderImageProps {
  src: string;
  onChange?: (next: string) => void;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  imgStyle?: ImageStyleProps;
  onChangeImgStyle?: (next: ImageStyleProps) => void;
  label?: string;
  showAdvanced?: boolean;
}

export interface EditorAdapter {
  /** Override the rendering of editable text nodes. Default renders a
   *  plain element with the given tag (read-only). */
  renderText?: RenderTextFn;
  /** Used by the editor to inline-replace an image with an editable
   *  wrapper. Defaults to a plain <img>. */
  renderImage?: (props: RenderImageProps) => ReactNode;
  /** When provided, the entry's number column shows reorder + delete
   *  affordances (editor mode). */
  entryMutators?: {
    onMove: (id: string, dir: -1 | 1) => void;
    onDelete: (id: string) => void;
    onUpdate: (id: string, next: GuideEntry) => void;
    canMove: (id: string, dir: -1 | 1) => boolean;
  };
  /** Override the chip list renderer (editor mode adds inline add/remove). */
  renderChips?: (props: { values: string[]; onChange?: (next: string[]) => void; placeholder?: string; chipClass?: string; readOnly: boolean }) => ReactNode;
  /** Override the score inline renderer. */
  renderScore?: (props: { value: number; onChange?: (v: number) => void; readOnly: boolean }) => ReactNode;
}

const defaultImage: NonNullable<EditorAdapter['renderImage']> = ({ src, alt, className, style }) => (
  src ? <img src={src} alt={alt || ''} referrerPolicy="no-referrer" className={className} style={style} /> : null
);

const defaultChips: NonNullable<EditorAdapter['renderChips']> = ({ values, chipClass }) => (
  <ul className="gle-chip-list">
    {values.map((v, i) => <li key={`${v}-${i}`} className={chipClass || 'gle-chip'}>{v}</li>)}
  </ul>
);

const defaultScore: NonNullable<EditorAdapter['renderScore']> = ({ value }) =>
  <span className="gle-score-num">{value.toFixed(1)}</span>;

/* ─────────────────────────────────────────────────────────────────
   Hero
   ───────────────────────────────────────────────────────────────── */

export interface HeroAuthor {
  name: string;
  handle: string;
  avatar?: string;
}

export const GuideHero: React.FC<{
  guide: Guide;
  theme: GuideTheme;
  author: HeroAuthor;
  /** Read-only label that sits where breadcrumb usually lives. */
  eyebrow?: { type: string; tag?: string };
  topChrome?: ReactNode;        // back arrow + owner controls
  ctaChrome?: ReactNode;        // Save / Share / View map buttons
  editor?: EditorAdapter;
  /** Editor-only: change handler for the cover photo URL. */
  onChangeCover?: (next: string) => void;
  /** Editor-only: change handler for hero image style (fit / pos / etc). */
  onChangeHeroImageStyle?: (next: ImageStyleProps) => void;
}> = ({ guide, theme, author, eyebrow, topChrome, ctaChrome, editor, onChangeCover, onChangeHeroImageStyle }) => {
  const V = theme.visibility;
  const renderText = editor?.renderText || defaultRenderText;
  const renderImg = editor?.renderImage || defaultImage;
  const minimal = theme.heroLayout === 'minimal';
  const split = theme.heroLayout === 'split';
  const isOverlay = !minimal && !split;
  const titleClass = cn('gle-hero-title', isOverlay && 'dark');
  const subClass = cn('gle-hero-sub', isOverlay && 'dark');
  const spots = guide.entries.length;
  const avg = guide.avgScore;

  // In editor mode the EditableImage applies the fit/posX/posY/filter
  // itself via the imgStyle prop. In read-only the inline style does it.
  const heroImageStyle: CSSProperties = editor?.renderImage ? {} : {
    objectFit: theme.heroImageFit,
    objectPosition: `${theme.heroImagePosX}% ${theme.heroImagePosY}%`,
    filter: `brightness(${theme.heroImageBrightness}%) saturate(${theme.heroImageSaturation}%)`,
  };

  return (
    <section className="gle-hero">
      {topChrome && <div className="gle-hero-top">{topChrome}</div>}

      {!minimal && (
        <div className="gle-hero-art">
          {guide.coverPhoto || onChangeCover
            ? renderImg({
                src: guide.coverPhoto,
                onChange: onChangeCover,
                alt: '',
                className: 'gle-hero-img',
                style: heroImageStyle,
                label: 'Replace cover',
                showAdvanced: true,
                imgStyle: {
                  fit: theme.heroImageFit,
                  posX: theme.heroImagePosX,
                  posY: theme.heroImagePosY,
                  brightness: theme.heroImageBrightness,
                  saturate: theme.heroImageSaturation,
                },
                onChangeImgStyle: onChangeHeroImageStyle,
              })
            : <div className="gle-hero-fallback" />}
          <div
            className="gle-hero-scrim"
            style={{
              background: `linear-gradient(180deg, rgba(0,0,0,${0.04 + theme.heroScrim / 250}) 0%, rgba(0,0,0,${theme.heroScrim / 200}) 40%, rgba(0,0,0,${theme.heroScrim / 110}) 100%), linear-gradient(90deg, rgba(0,0,0,${theme.heroScrim / 180}) 0%, rgba(0,0,0,0) 60%)`,
            }}
          />
        </div>
      )}

      <div className="gle-hero-content">
        {V.heroEyebrow && eyebrow && (
          <div className={cn('gle-hero-eyebrow', isOverlay && 'dark')}>
            <span>Guides</span>
            <span className="gle-crumb-sep">/</span>
            <span>{eyebrow.type}</span>
            {eyebrow.tag && (
              <>
                <span className="gle-crumb-sep">·</span>
                <span>{eyebrow.tag}</span>
              </>
            )}
          </div>
        )}

        {renderText({
          as: 'h1',
          value: guide.title || '',
          styleKey: 'title',
          className: titleClass,
          placeholder: 'Your guide title',
          multiline: true,
        })}

        {guide.subtitle != null && renderText({
          as: 'p',
          value: guide.subtitle,
          styleKey: 'subtitle',
          className: subClass,
          placeholder: 'One line that tells readers what this guide is.',
          multiline: true,
          maxLength: 200,
        })}

        {(V.heroAuthor || V.heroStats) && (
          <div className="gle-hero-meta">
            {V.heroAuthor && (
              <div className={cn('gle-author-chip', isOverlay && 'dark')}>
                <div className="gle-author-avatar">
                  {author.avatar
                    ? <img src={author.avatar} alt="" referrerPolicy="no-referrer" />
                    : <span>{(author.name || 'A')[0].toUpperCase()}</span>}
                </div>
                <div className="gle-author-id">
                  {renderText({
                    as: 'div',
                    value: author.name || '',
                    styleKey: 'author.name',
                    className: 'gle-author-name',
                    placeholder: 'Your name',
                  })}
                  {author.handle && (
                    <div className="gle-author-handle">@{author.handle}</div>
                  )}
                </div>
              </div>
            )}
            {V.heroStats && (
              <>
                {V.heroAuthor && <span className="gle-dot" />}
                <div className={cn('gle-stat', isOverlay && 'dark')}>
                  <span className="gle-stat-num">{spots}</span>
                  <span className="gle-stat-lbl">{guide.type === 'recipes' ? 'recipes' : 'spots'}</span>
                </div>
                {avg != null && (
                  <>
                    <span className="gle-dot" />
                    <div className={cn('gle-stat', isOverlay && 'dark')}>
                      <span className="gle-stat-num">{avg.toFixed(1)}</span>
                      <span className="gle-stat-lbl">avg</span>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {V.heroActions && ctaChrome && (
          <div className="gle-hero-actions">{ctaChrome}</div>
        )}
      </div>
    </section>
  );
};

/* Default hero CTAs used by the public reader. The editor renders its
   own disabled-looking buttons inline. */
export const DefaultHeroCtas: React.FC<{
  saved: boolean;
  onToggleSave: () => void;
  onShare: () => void;
  showMap: boolean;
  mapHref?: string;
}> = ({ saved, onToggleSave, onShare, showMap, mapHref }) => (
  <>
    <button
      type="button"
      onClick={onToggleSave}
      className={cn('gle-pill-cta', saved && 'is-on')}
    >
      <Bookmark size={14} fill={saved ? 'currentColor' : 'none'} />
      <span>{saved ? 'Saved' : 'Save guide'}</span>
    </button>
    <button type="button" onClick={onShare} className="gle-pill-ghost">
      <ShareIcon size={14} />
      <span>Share</span>
    </button>
    {showMap && mapHref && (
      <a href={mapHref} className="gle-pill-ghost">
        <MapIcon size={14} />
        <span>View map</span>
      </a>
    )}
  </>
);

/* ─────────────────────────────────────────────────────────────────
   Intro
   ───────────────────────────────────────────────────────────────── */

export const GuideIntro: React.FC<{
  guide: Guide;
  theme: GuideTheme;
  editor?: EditorAdapter;
  onTagsChange?: (next: string[]) => void;
}> = ({ guide, theme, editor, onTagsChange }) => {
  const V = theme.visibility;
  const renderText = editor?.renderText || defaultRenderText;
  const renderChips = editor?.renderChips || defaultChips;
  if (!guide.intro && (guide.tags?.length || 0) === 0) return null;
  return (
    <section className="gle-intro">
      {V.introQuote && <div className="gle-intro-quote">&ldquo;</div>}
      {renderText({
        as: 'p',
        value: guide.intro || '',
        styleKey: 'intro',
        className: 'gle-intro-body',
        placeholder: 'Two to four sentences. Plain spoken. What is this guide, why does it exist, what do you hope readers do with it.',
        multiline: true,
        maxLength: 800,
      })}
      {V.introTags && (guide.tags?.length || 0) > 0 && (
        <div className="gle-tags-row">
          {renderChips({
            values: guide.tags || [],
            onChange: onTagsChange,
            placeholder: 'Add a tag…',
            chipClass: 'gle-tag-chip',
            readOnly: !onTagsChange,
          })}
        </div>
      )}
    </section>
  );
};

/* ─────────────────────────────────────────────────────────────────
   Entries
   ───────────────────────────────────────────────────────────────── */

const scoreCls = (s: number) => s >= 8.5 ? 'high' : s >= 7 ? 'mid' : 'low';

export interface EntryActionAdapter {
  onView?: (entry: GuideEntry) => void;
  /** Save-to-wishlist toggle for restaurant entries (bookmark). */
  onSave?: (entry: GuideEntry) => void;
  onAdd?: (entry: GuideEntry) => void;
  isSaved?: (entry: GuideEntry) => boolean;
}

interface EntryCardProps {
  entry: GuideEntry;
  index: number;
  total: number;
  guide: Guide;
  theme: GuideTheme;
  editor?: EditorAdapter;
  actions?: EntryActionAdapter;
}

const EntryCard: React.FC<EntryCardProps> = ({ entry, index, total, guide, theme, editor, actions }) => {
  const V = theme.visibility;
  const layout = theme.entryLayout;
  const renderText = editor?.renderText || defaultRenderText;
  const renderImg = editor?.renderImage || defaultImage;
  const renderChips = editor?.renderChips || defaultChips;
  const renderScore = editor?.renderScore || defaultScore;
  const isRestaurant = guide.type === 'restaurants';
  const ek = `entry.${entry.id}`;
  const orderedFields = isRestaurant ? entry.mustOrder : entry.keyIngredients;
  const orderedLabel = isRestaurant ? 'Must Order' : 'Key Ingredients';
  const { cuisine, price } = readEntryMeta(entry);
  const score = typeof entry.score === 'number' ? entry.score : null;
  const set = (k: keyof GuideEntry, v: unknown) => editor?.entryMutators?.onUpdate(entry.id, { ...entry, [k]: v } as GuideEntry);

  return (
    <article
      id={entryDomId(index)}
      className={cn('gle-entry', `layout-${layout}`)}
      data-entry-id={entry.id}
    >
      {layout === 'sidebar' && (
        <aside className="gle-rank-col">
          <div className="gle-rank">{numLabel(index + 1)}</div>
          <div className="gle-rank-of">of {total}</div>
          {editor?.entryMutators && (
            <EntryReorderTools
              entryId={entry.id}
              mutators={editor.entryMutators}
              tone="sidebar"
            />
          )}
        </aside>
      )}

      <div className="gle-entry-body">
        {layout === 'banner' && (
          <div className="gle-entry-banner">
            <div className="gle-banner-rank">
              {numLabel(index + 1)}
              <span>of {total}</span>
            </div>
            {editor?.entryMutators && (
              <EntryReorderTools entryId={entry.id} mutators={editor.entryMutators} tone="banner" />
            )}
          </div>
        )}
        {layout === 'minimal' && (
          <div className="gle-entry-minirank">
            <span className="gle-mini-rank">{numLabel(index + 1)}</span>
            <span className="gle-mini-rank-of">/ {total}</span>
            <span className="gle-mini-spacer" />
            {editor?.entryMutators && (
              <EntryReorderTools entryId={entry.id} mutators={editor.entryMutators} tone="minimal" />
            )}
          </div>
        )}

        {theme.entryShowPhoto && (
          <div className="gle-entry-photo">
            {entry.image || editor?.entryMutators
              ? renderImg({
                  src: entry.image,
                  onChange: editor?.entryMutators ? ((v) => set('image', v)) : undefined,
                  alt: '',
                  className: 'gle-entry-img',
                  label: 'Photo',
                  showAdvanced: false,
                })
              : <div className="gle-entry-img-empty">{isRestaurant ? <BookOpen size={28} /> : <ChefHat size={28} />}</div>}
            {V.entryScore && score != null && score > 0 && (
              <div className="gle-entry-photo-score">
                {/* Editor mode routes through renderScore so the badge is
                    editable — the read-only ScoreBadge left photo-layout
                    scores untouchable in the editor. */}
                {editor?.entryMutators
                  ? renderScore({ value: score, onChange: (v) => set('score', v), readOnly: false })
                  : <ScoreBadge rating={score} size="lg" />}
              </div>
            )}
            {V.entryScore && score == null && editor?.entryMutators && (
              <div className="gle-entry-photo-score">
                <button type="button" className="gle-score-addstub" onClick={() => set('score', 8)}>
                  ★ Add score
                </button>
              </div>
            )}
          </div>
        )}

        <div className="gle-entry-head">
          <div className="gle-entry-titleblock">
            {V.entryScore && score != null && !theme.entryShowPhoto && (
              <div className={cn('gle-score-row', scoreCls(score))}>
                <span className="gle-star">★</span>
                {renderScore({ value: score, onChange: (v) => set('score', v), readOnly: !editor?.entryMutators })}
                <span className="gle-of">/ 10</span>
                <span className="gle-rule" />
              </div>
            )}
            {/* Places-sourced entries arrive without a score — give the
                editor an affordance to add one (readers see nothing). */}
            {V.entryScore && score == null && !theme.entryShowPhoto && editor?.entryMutators && (
              <div className="gle-score-row">
                <button type="button" className="gle-score-addstub" onClick={() => set('score', 8)}>
                  ★ Add score
                </button>
              </div>
            )}
            {/* Entry name is read-only: the value comes from the
                source rating / recipe and renaming it inside the guide
                would desync the two. Click still selects it for
                per-element styling via the Inspector's Element tab. */}
            {renderText({
              as: 'h2',
              value: entry.name || '',
              styleKey: `${ek}.name`,
              className: 'gle-entry-name',
              placeholder: isRestaurant ? 'Restaurant name' : 'Recipe name',
              readOnly: true,
            })}
            {/* Restaurant detail meta — read-only because these come from
                the rating data; users edit them from the rating, not the
                guide. For recipes, only `cuisine` is shown. */}
            {V.entryMeta && isRestaurant && (cuisine || price || entry.neighborhood) && (
              <div className="gle-entry-meta">
                {cuisine && <span className="gle-meta-slot">{cuisine}</span>}
                {cuisine && (price || entry.neighborhood) && <span className="gle-meta-dot" />}
                {price && <span className="gle-meta-price">{price}</span>}
                {price && entry.neighborhood && <span className="gle-meta-dot" />}
                {entry.neighborhood && (
                  <span className="gle-loc">
                    <MapPin size={11} className="gle-loc-pin" />
                    <span>{entry.neighborhood}</span>
                  </span>
                )}
              </div>
            )}
            {V.entryMeta && !isRestaurant && cuisine && (
              <div className="gle-entry-meta">
                <span className="gle-meta-slot">{cuisine}</span>
              </div>
            )}
            {V.entryHours && isRestaurant && entry.hours && (
              <div className="gle-entry-hours">
                <Clock size={12} className="gle-hours-ico" />
                <span>{entry.hours}</span>
              </div>
            )}
          </div>
          {V.entryActions && actions && (
            <div className="gle-entry-actions">
              <button
                type="button"
                onClick={() => actions.onSave?.(entry)}
                aria-label={actions.isSaved?.(entry) ? 'Remove from wishlist' : 'Save to wishlist'}
                className={cn('gle-entry-act', actions.isSaved?.(entry) && 'is-on')}
              >
                <Bookmark size={16} fill={actions.isSaved?.(entry) ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                onClick={() => actions.onAdd?.(entry)}
                aria-label="Add to list"
                className="gle-entry-act"
              >
                <Plus size={16} />
              </button>
            </div>
          )}
        </div>

        {renderText({
          as: 'p',
          value: entry.notes || '',
          styleKey: `${ek}.blurb`,
          className: 'gle-entry-blurb',
          placeholder: 'Two to three sentences on what makes this place special…',
          multiline: true,
          maxLength: 600,
        })}

        {(V.entryMustOrder || V.entryBestFor || V.entryTip)
          && (orderedFields?.length || entry.bestFor || entry.insiderTip || editor?.entryMutators) && (
          <div className="gle-entry-grid">
            {V.entryMustOrder && (
              <div className="gle-ib">
                <div className="gle-ib-label">{isRestaurant ? 'Favorite Dishes' : orderedLabel}</div>
                {renderChips({
                  values: orderedFields || [],
                  onChange: (next) => set(isRestaurant ? 'mustOrder' : 'keyIngredients', next),
                  placeholder: isRestaurant ? 'A dish to order…' : 'A key ingredient…',
                  chipClass: 'gle-must-chip',
                  readOnly: !editor?.entryMutators,
                })}
              </div>
            )}
            {(V.entryBestFor || V.entryTip) && (
              <div className="gle-ib">
                {V.entryBestFor && (entry.bestFor || editor?.entryMutators) && (
                  <>
                    <div className="gle-ib-label">Best for</div>
                    {renderText({
                      as: 'div',
                      value: entry.bestFor || '',
                      styleKey: `${ek}.bestFor`,
                      className: 'gle-ib-text',
                      placeholder: 'Big groups. Birthdays.',
                      multiline: true,
                    })}
                  </>
                )}
                {V.entryTip && (entry.insiderTip || editor?.entryMutators) && (
                  <>
                    <div className={cn('gle-ib-label', V.entryBestFor && entry.bestFor && 'gle-ib-spacer')}>Insider tip</div>
                    {renderText({
                      as: 'div',
                      value: entry.insiderTip || '',
                      styleKey: `${ek}.tip`,
                      className: 'gle-ib-text',
                      placeholder: 'Sit upstairs, by the window.',
                      multiline: true,
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Custom sections the user has appended to this entry via the
            Live Editor. Each has a header and body; the format hint
            decides whether the body renders as a paragraph or as a
            bullet / numbered list (split on newlines). */}
        {(entry.customSections || []).length > 0 && (
          <div className="gle-entry-sections">
            {entry.customSections!.map((section) => (
              <CustomSectionView
                key={section.id}
                entry={entry}
                section={section}
                editor={editor}
                theme={theme}
              />
            ))}
          </div>
        )}

        {/* "Add section" button — editor mode only. Drops a fresh
            paragraph section onto the entry with default header. */}
        {editor?.entryMutators && (
          <button
            type="button"
            className="gle-entry-add-section"
            onClick={() => {
              const newSection: CustomSection = {
                id: `cs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                header: 'New section',
                body: '',
                format: 'paragraph',
              };
              editor.entryMutators!.onUpdate(entry.id, {
                ...entry,
                customSections: [...(entry.customSections || []), newSection],
              });
            }}
          >
            <Plus size={13} /><span>Add section</span>
          </button>
        )}

        {V.entryCta && actions?.onView && (
          <button type="button" onClick={() => actions.onView!(entry)} className="gle-entry-cta">
            <span>{isRestaurant ? 'View restaurant' : 'View recipe'}</span>
            <ArrowUpRight size={14} />
          </button>
        )}
      </div>
    </article>
  );
};

/* ─────────────────────────────────────────────────────────────────
   Custom section rendering. Read-only mode renders the body in its
   chosen format. Editor mode adds a header editable, body editable
   (single multiline node), format toggle row, and a delete button.
   ───────────────────────────────────────────────────────────────── */

const CustomSectionView: React.FC<{
  entry: GuideEntry;
  section: CustomSection;
  editor?: EditorAdapter;
  theme: GuideTheme;
}> = ({ entry, section, editor, theme }) => {
  const renderText = editor?.renderText || defaultRenderText;
  const ek = `entry.${entry.id}.cs.${section.id}`;
  const isEditor = !!editor?.entryMutators;

  // In editor mode the Editable primitive applies textStyles overrides
  // itself. In read-only mode we pre-compute them and pass through as
  // inline style so the published reader matches the editor preview.
  const headerStyle = !isEditor ? computeTextStyle(theme.textStyles[`${ek}.h`]) : undefined;
  const bodyStyle = !isEditor ? computeTextStyle(theme.textStyles[`${ek}.b`]) : undefined;

  const patchSection = (patch: Partial<CustomSection>) => {
    if (!editor?.entryMutators) return;
    const next = (entry.customSections || []).map((s) =>
      s.id === section.id ? { ...s, ...patch } : s
    );
    editor.entryMutators.onUpdate(entry.id, { ...entry, customSections: next });
  };
  const deleteSection = () => {
    if (!editor?.entryMutators) return;
    const next = (entry.customSections || []).filter((s) => s.id !== section.id);
    editor.entryMutators.onUpdate(entry.id, { ...entry, customSections: next });
  };

  // Body lines for list formats — preserves blank lines as empty bullets
  // when reading, which is rare but at least consistent.
  const bodyLines = (section.body || '').split(/\r?\n/);
  const isList = section.format === 'bullets' || section.format === 'numbered';

  return (
    <div className="gle-cs">
      <div className="gle-cs-head">
        {renderText({
          as: 'div',
          value: section.header,
          styleKey: `${ek}.h`,
          className: 'gle-cs-header',
          placeholder: 'Section title',
          baseStyle: headerStyle,
        })}
        {isEditor && (
          <div className="gle-cs-tools">
            <button
              type="button"
              className={cn('gle-cs-fmt', section.format === 'paragraph' && 'on')}
              onClick={() => patchSection({ format: 'paragraph' })}
              title="Paragraph"
            >¶</button>
            <button
              type="button"
              className={cn('gle-cs-fmt', section.format === 'bullets' && 'on')}
              onClick={() => patchSection({ format: 'bullets' })}
              title="Bullet list"
            >•</button>
            <button
              type="button"
              className={cn('gle-cs-fmt', section.format === 'numbered' && 'on')}
              onClick={() => patchSection({ format: 'numbered' })}
              title="Numbered list"
            >1.</button>
            <button
              type="button"
              className="gle-cs-delete"
              onClick={deleteSection}
              title="Delete section"
            >×</button>
          </div>
        )}
      </div>

      {/* Body: editor mode is always a single multiline editable;
          public reader splits on newlines for list formats. */}
      {isEditor ? (
        <>
          {renderText({
            as: 'div',
            value: section.body,
            styleKey: `${ek}.b`,
            className: cn('gle-cs-body', isList && `is-${section.format}`),
            placeholder: isList
              ? 'Write one item per line — each line becomes a list item on the published guide.'
              : 'What did you want to say in this section?',
            multiline: true,
            maxLength: 1200,
          })}
        </>
      ) : section.format === 'bullets' ? (
        <ul className="gle-cs-list" style={bodyStyle}>
          {bodyLines.filter((l) => l.trim()).map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      ) : section.format === 'numbered' ? (
        <ol className="gle-cs-list" style={bodyStyle}>
          {bodyLines.filter((l) => l.trim()).map((line, i) => <li key={i}>{line}</li>)}
        </ol>
      ) : (
        <p className="gle-cs-body" style={bodyStyle}>{section.body}</p>
      )}
    </div>
  );
};

const EntryReorderTools: React.FC<{
  entryId: string;
  mutators: NonNullable<EditorAdapter['entryMutators']>;
  tone: 'sidebar' | 'banner' | 'minimal';
}> = ({ entryId, mutators, tone }) => (
  <div className={cn('gle-rank-tools', `tone-${tone}`)}>
    <button
      type="button"
      className="gle-rt"
      disabled={!mutators.canMove(entryId, -1)}
      onClick={() => mutators.onMove(entryId, -1)}
      aria-label="Move up"
    >↑</button>
    <button
      type="button"
      className="gle-rt"
      disabled={!mutators.canMove(entryId, 1)}
      onClick={() => mutators.onMove(entryId, 1)}
      aria-label="Move down"
    >↓</button>
    <button
      type="button"
      className="gle-rt danger"
      onClick={() => mutators.onDelete(entryId)}
      aria-label="Delete"
    >×</button>
  </div>
);

export const GuideEntries: React.FC<{
  guide: Guide;
  theme: GuideTheme;
  editor?: EditorAdapter;
  actions?: EntryActionAdapter;
  trailing?: ReactNode;
}> = ({ guide, theme, editor, actions, trailing }) => (
  <div className="gle-entries">
    {guide.entries.map((entry, idx) => (
      <EntryCard
        key={entry.id}
        entry={entry}
        index={idx}
        total={guide.entries.length}
        guide={guide}
        theme={theme}
        editor={editor}
        actions={actions}
      />
    ))}
    {trailing}
  </div>
);

/* ─────────────────────────────────────────────────────────────────
   TOC sidebar
   ───────────────────────────────────────────────────────────────── */

export const GuideTOC: React.FC<{
  entries: GuideEntry[];
  activeIdx: number;
  onJump?: (idx: number) => void;
  trailing?: ReactNode;
}> = ({ entries, activeIdx, onJump, trailing }) => (
  <aside className="gle-toc">
    <p className="gle-toc-label">In this guide</p>
    <ol className="gle-toc-list">
      {entries.map((entry, idx) => (
        <li key={entry.id}>
          <button
            type="button"
            onClick={() => onJump?.(idx)}
            className={cn('gle-toc-item', idx === activeIdx && 'is-active')}
          >
            <span className="gle-toc-num">{numLabel(idx + 1)}</span>
            <span className="gle-toc-name">{entry.name || 'Unnamed'}</span>
            {typeof entry.score === 'number' && entry.score > 0 && (
              <span className={cn('gle-toc-score', scoreCls(entry.score))}>{entry.score.toFixed(1)}</span>
            )}
          </button>
        </li>
      ))}
    </ol>
    {trailing}
  </aside>
);

/* ─────────────────────────────────────────────────────────────────
   Author panel
   ───────────────────────────────────────────────────────────────── */

export const GuideAuthor: React.FC<{
  guide: Guide;
  theme: GuideTheme;
  authorProfile: UserProfile | null;
  editor?: EditorAdapter;
  trailing?: ReactNode;
  /** Editor-mode mutator for author overrides. */
  onAuthorOverrideChange?: (next: GuideTheme['authorOverrides']) => void;
}> = ({ guide: _guide, theme, authorProfile, editor, trailing }) => {
  const renderText = editor?.renderText || defaultRenderText;
  const overrides = theme.authorOverrides || {};
  const name = overrides.name ?? (authorProfile?.display_name || authorProfile?.username || 'Anonymous');
  const handle = overrides.handle ?? (authorProfile?.username || '');
  const avatar = overrides.avatar ?? '';
  const bio = overrides.bio ?? (authorProfile?.bio || '');

  return (
    <section className="gle-author-panel">
      <p className="gle-ap-eyebrow">About the author</p>
      <div className="gle-ap-row">
        <div className="gle-ap-avatar">
          {avatar
            ? <img src={avatar} alt="" referrerPolicy="no-referrer" />
            : <span>{(name || 'A')[0]?.toUpperCase() || 'U'}</span>}
        </div>
        <div className="gle-ap-body">
          {renderText({
            as: 'h3',
            value: name,
            styleKey: 'author.name',
            className: 'gle-ap-name',
            placeholder: 'Your name',
          })}
          {handle && <div className="gle-ap-handle">@{handle}</div>}
          {renderText({
            as: 'p',
            value: bio,
            styleKey: 'author.bio',
            className: 'gle-ap-bio',
            placeholder: 'One or two sentences. What kind of eater are you?',
            multiline: true,
            maxLength: 240,
          })}
        </div>
        {trailing}
      </div>
    </section>
  );
};

/* ─────────────────────────────────────────────────────────────────
   End cap
   ───────────────────────────────────────────────────────────────── */

export const GuideEndCap: React.FC = () => (
  <div className="gle-end-cap">
    <div className="gle-end-line" />
    <div className="gle-end-mono"><Logo size={40} variant="badge" /></div>
    <div className="gle-end-line" />
  </div>
);

/* ─────────────────────────────────────────────────────────────────
   Convenience composer — single-call render for the public reader.
   ───────────────────────────────────────────────────────────────── */

export const GuideRoot: React.FC<{
  guide: Guide;
  author: HeroAuthor;
  authorProfile: UserProfile | null;
  topChrome?: ReactNode;
  heroCtas?: ReactNode;
  actions?: EntryActionAdapter;
  activeIdx?: number;
  onJump?: (idx: number) => void;
  trailing?: ReactNode;
}> = ({ guide, author, authorProfile, topChrome, heroCtas, actions, activeIdx = 0, onJump, trailing }) => {
  const theme = getTheme(guide);
  const V = theme.visibility;
  return (
    <GuideThemeScope theme={theme}>
      <GuideHero
        guide={guide}
        theme={theme}
        author={author}
        eyebrow={{ type: guide.type === 'recipes' ? 'Recipes' : 'Restaurants', tag: guide.tags?.[0] }}
        topChrome={topChrome}
        ctaChrome={heroCtas}
      />
      <div className={cn('gle-layout', !V.toc && 'no-toc')}>
        <div className="gle-main-col">
          <GuideIntro guide={guide} theme={theme} />
          <GuideEntries guide={guide} theme={theme} actions={actions} />
          {V.author && <GuideAuthor guide={guide} theme={theme} authorProfile={authorProfile} />}
          {V.endCap && <GuideEndCap />}
        </div>
        {V.toc && <GuideTOC entries={guide.entries} activeIdx={activeIdx} onJump={onJump} />}
      </div>
      {trailing}
    </GuideThemeScope>
  );
};
