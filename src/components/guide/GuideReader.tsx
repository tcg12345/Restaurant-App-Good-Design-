import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { guidePhotoUrls } from '../../lib/guide-photos';
import { GuidePhotoGallery, GalleryImage } from './GuidePhotoGallery';
import { Link } from 'react-router-dom';
import { Bookmark, Check, ChevronDown, ChevronRight, Edit3, EyeOff, MoreHorizontal, Plus, Sparkles } from 'lucide-react';
import { GlassButton } from '../../lib/glass-buttons';
import { ShareIcon } from '../icons/ShareIcon';
import { Avatar } from '../Avatar';
import { useAskAssistantAbout } from '../../contexts/AssistantContext';
import { scoreTintStyle } from '../../lib/score';
import type { Guide, GuideEntry, GuideTheme } from '../../lib/supabase-guides';
import { readEntryMeta, type EntryActionAdapter, type HeroAuthor } from './GuideRender';
import './GuideReader.css';

function GuideImage({ src, className }: { src: string; className: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return null;
  return <img className={className} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

export const GuideReaderEntry: React.FC<{
  entry: GuideEntry; index: number; guide: Guide; theme: GuideTheme; actions: EntryActionAdapter;
}> = ({ entry, index, guide, theme, actions }) => {
  const v = theme.visibility;
  const restaurant = guide.type === 'restaurants';
  const { cuisine, price } = readEntryMeta(entry);
  const metadata = (restaurant
    ? [cuisine, price, entry.neighborhood || entry.city]
    : [cuisine, entry.totalTime ? `${entry.totalTime} min` : '', entry.difficulty]).filter(Boolean).join(' · ');
  const dishes = restaurant ? entry.mustOrder : entry.keyIngredients;
  const sections = (entry.customSections || []).filter(section => section.body?.trim());
  const extra = (v.entryMustOrder && !!dishes?.length) || (v.entryBestFor && !!entry.bestFor)
    || (v.entryTip && !!entry.insiderTip) || !!sections.length;
  const score = typeof entry.score === 'number' && Number.isFinite(entry.score) ? entry.score : null;
  const tint = score !== null ? scoreTintStyle(score) : null;
  const canOpen = !!actions.onView;
  const saved = !!actions.isSaved?.(entry);
  const photos = guidePhotoUrls(entry);
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    const layer = article.current?.closest('[data-retained-route]');
    if (!layer || galleryIndex === null) return;
    const observer = new MutationObserver(() => { if (layer.hasAttribute('inert')) setGalleryIndex(null); });
    observer.observe(layer, { attributes: true, attributeFilter: ['inert'] });
    return () => observer.disconnect();
  }, [galleryIndex]);

  return (
    <article ref={article} className="guide-reader-entry" id={`reader-${guide.id}-${index}`}>
      <button type="button" className="guide-reader-place" disabled={!canOpen} onClick={() => actions.onView?.(entry)} aria-label={`Open ${entry.name}`}>
        <span className="guide-reader-number">{String(index + 1).padStart(2, '0')}</span>
        <span className="guide-reader-place-copy">
          <span className="guide-reader-place-name" role="heading" aria-level={2}>{entry.name}</span>
          {v.entryMeta && metadata && <span className="guide-reader-meta">{metadata}</span>}
        </span>
        {v.entryScore && score !== null && tint && <span className="guide-reader-score" style={{ color: tint.color, background: tint.background, borderColor: tint.ring }} aria-label={`Author's score: ${score.toFixed(1)} out of 10`}>{score.toFixed(1)}</span>}
        {canOpen && <ChevronRight size={15} className="guide-reader-chevron" />}
      </button>
      {guide.includePhotos && photos.length > 0 && (
        <div className="guide-reader-photo-rail" data-horizontal-gesture="" role="region" aria-label={`Photos of ${entry.name}`}>
          {photos.map((url, photoIndex) => <button type="button" key={url} className="guide-reader-photo-tile" onClick={() => setGalleryIndex(photoIndex)} aria-label={`Open photo ${photoIndex + 1} of ${photos.length} of ${entry.name}`}>
            <GalleryImage url={url} alt={`${entry.name}, photo ${photoIndex + 1}`} />
          </button>)}
        </div>
      )}
      <AnimatePresence>{galleryIndex !== null && <GuidePhotoGallery name={entry.name} photos={photos} initialIndex={galleryIndex} onClose={() => setGalleryIndex(null)} />}</AnimatePresence>
      {entry.notes?.trim() && <p className="guide-reader-note">{entry.notes}</p>}
      {extra && (
        <div className="guide-reader-entry-insights">
          {v.entryMustOrder && !!dishes?.length && <div><h3>{restaurant ? 'What to order' : 'Key ingredients'}</h3><p>{dishes.join(' · ')}</p></div>}
          {v.entryBestFor && entry.bestFor && <div><h3>Best for</h3><p>{entry.bestFor}</p></div>}
          {v.entryTip && entry.insiderTip && <div className="guide-reader-tip"><h3>Insider tip</h3><p>{entry.insiderTip}</p></div>}
          {sections.map(section => <div key={section.id}>
            {section.header && <h3>{section.header}</h3>}
            {section.format === 'paragraph' ? <p>{section.body}</p>
              : section.format === 'numbered' ? <ol>{section.body.split(/\r?\n/).filter(line => line.trim()).map((line, i) => <li key={i}>{line}</li>)}</ol>
                : <ul>{section.body.split(/\r?\n/).filter(line => line.trim()).map((line, i) => <li key={i}>{line}</li>)}</ul>}
          </div>)}
        </div>
      )}
      <div className="guide-reader-entry-bottom">
        {restaurant && v.entryActions && <div className="guide-reader-entry-actions">
          {actions.onAdd && <button type="button" onClick={() => actions.onAdd?.(entry)} aria-label={`Add ${entry.name} to a list`}><Plus size={16} /><span>Add to list</span></button>}
          {actions.onSave && <button type="button" className={saved ? 'is-saved' : ''} onClick={() => actions.onSave?.(entry)} aria-label={saved ? `Unsave ${entry.name}` : `Save ${entry.name}`} aria-pressed={saved}><Bookmark size={18} fill={saved ? 'currentColor' : 'none'} /></button>}
        </div>}
      </div>
    </article>
  );
}

/** App reader chrome stays consistent across guides; authored content and
 * visibility settings are preserved without inheriting editor canvas sizing. */
export function GuideReader({ guide, theme, author, authorHref, authorBio, saved, saving, onSave, onBack, onShare, onEdit, onUnpublish, actions }: {
  guide: Guide; theme: GuideTheme; author: HeroAuthor; authorHref?: string; authorBio: string;
  saved: boolean; saving: boolean; onSave: () => void; onBack: () => void; onShare: () => void;
  onEdit?: () => void; onUnpublish?: () => void; actions: EntryActionAdapter;
}) {
  const askAbout = useAskAssistantAbout();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const v = theme.visibility;
  useEffect(() => {
    const dismiss = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) menuRef.current.open = false;
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menuRef.current?.open) {
        menuRef.current.open = false;
        menuRef.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, []);
  const closeAndRun = (fn: () => void) => { if (menuRef.current) menuRef.current.open = false; fn(); };
  const authorChip = <><Avatar src={author.avatar} name={author.name} size={30} /><span>By <strong>{author.name}</strong></span>{authorHref && <ChevronRight size={13} />}</>;

  return <div className="guide-reader" ref={rootRef}>
    <header className="guide-reader-nav">
      <GlassButton id="guide-back" symbol="chevron.left" label="Back" onClick={onBack} className="guide-reader-glass"><ChevronRight size={21} style={{ transform: 'rotate(180deg)' }} /></GlassButton>
      <span className="guide-reader-nav-title">Guide</span>
      <div className="guide-reader-nav-actions">
        <details className="guide-reader-menu" ref={menuRef}>
          <summary aria-label="Guide options"><MoreHorizontal size={21} /></summary>
          <div className="guide-reader-menu-panel">
            <button type="button" onClick={() => closeAndRun(() => askAbout({
              kind: 'guide', id: guide.id, name: guide.title,
              subtitle: `${guide.entries.length} ${guide.type} · By ${author.name}`,
              details: guide.entries.map((entry, i) => `${i + 1}. ${entry.name}${entry.subtitle ? ` · ${entry.subtitle}` : ''}${entry.notes ? `: ${entry.notes}` : ''}`),
            }))}><Sparkles size={17} />Ask AI</button>
            {onEdit && <button type="button" onClick={() => closeAndRun(onEdit)}><Edit3 size={17} />Edit guide</button>}
            {onUnpublish && <button type="button" onClick={() => closeAndRun(onUnpublish)}><EyeOff size={17} />Unpublish</button>}
          </div>
        </details>
        <GlassButton id="guide-share" symbol="app.paperplane" label="Share guide" onClick={onShare} className="guide-reader-glass"><ShareIcon size={20} /></GlassButton>
      </div>
    </header>
    <main className="guide-reader-main">
      <section className="guide-reader-hero">
        {guide.coverPhoto && theme.heroLayout !== 'minimal' && <GuideImage src={guide.coverPhoto} className="guide-reader-cover" />}
        {v.heroEyebrow && <p className="guide-reader-kicker">{guide.type === 'recipes' ? 'Recipe collection' : 'Restaurant collection'}{guide.city ? ` · ${guide.city}` : ''}</p>}
        <h1>{guide.title}</h1>
        {guide.subtitle?.trim() && <p className="guide-reader-subtitle">{guide.subtitle}</p>}
        {(v.heroAuthor || v.author) && (authorHref ? <Link className="guide-reader-author" to={authorHref}>{authorChip}</Link> : <div className="guide-reader-author">{authorChip}</div>)}
        {!guide.isPublished && <span className="guide-reader-private">Unpublished</span>}
        {v.heroActions && <button type="button" className={`guide-reader-save ${saved ? 'is-saved' : ''}`} disabled={saving} aria-busy={saving} aria-pressed={saved} onClick={onSave}>
          {saved ? <Check size={18} /> : <Bookmark size={18} />}<span>{saving ? 'Saving…' : saved ? 'Guide saved' : 'Save guide'}</span>
        </button>}
        {(guide.intro?.trim() || (v.author && authorBio) || (v.introTags && !!guide.tags?.length)) && <details className="guide-reader-about">
          <summary>About this guide<ChevronDown size={15} /></summary>
          <div className="guide-reader-detail-content">
            {guide.intro?.trim() && <p>{guide.intro}</p>}
            {v.introTags && !!guide.tags?.length && <p className="guide-reader-tags">{guide.tags.join(' · ')}</p>}
            {v.author && authorBio && <div><h3>About {author.name}</h3><p>{authorBio}</p></div>}
          </div>
        </details>}
      </section>
      <div className="guide-reader-list-heading">
        <h2>{guide.entries.length} {guide.type === 'recipes' ? (guide.entries.length === 1 ? 'recipe' : 'recipes') : (guide.entries.length === 1 ? 'place' : 'places')}</h2>
        {v.heroStats && guide.avgScore != null && Number.isFinite(guide.avgScore) && <span>{guide.avgScore.toFixed(1)} average</span>}
      </div>
      {v.toc && guide.entries.length > 6 && <label className="guide-reader-jump">Jump to
        <select defaultValue="" aria-label="Jump to a place or recipe" onChange={e => {
          const element = rootRef.current?.querySelector(`[id="reader-${guide.id}-${Number(e.target.value)}"]`);
          element?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
          e.target.value = '';
        }}><option value="" disabled>Choose an entry</option>{guide.entries.map((entry, index) => <option key={entry.id} value={index}>{index + 1}. {entry.name}</option>)}</select>
      </label>}
      <div className="guide-reader-entries">{guide.entries.map((entry, index) => <GuideReaderEntry key={entry.id} entry={entry} index={index} guide={guide} theme={theme} actions={actions} />)}</div>
      {!guide.entries.length && <p className="guide-reader-empty">No {guide.type === 'recipes' ? 'recipes' : 'places'} added yet.</p>}
    </main>
  </div>;
}
