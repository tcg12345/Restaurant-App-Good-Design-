import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Bookmark, Play, SlidersHorizontal, Users, BadgeCheck, ChefHat, Check } from 'lucide-react';
import type { FeedFilter } from '../SocialFeed';
import type { FeedLens } from '../../lib/feed-discovery';
import { GlassButton } from '../../lib/glass-buttons';
import { SheetShell, SheetCta } from '../shared-lists/SheetShell';
import './FeedNavigation.css';

const audiences = [
  { id: 'friends', label: 'Your circle', icon: Users },
  { id: 'experts', label: 'Verified', icon: BadgeCheck },
  { id: 'recipes', label: 'Cooking', icon: ChefHat },
] as const;

export const FeedNavigation: React.FC<{
  audience: FeedFilter; lens: FeedLens;
  onAudienceChange: (audience: FeedFilter) => void;
  onLensChange: (lens: FeedLens) => void;
}> = ({ audience, lens, onAudienceChange, onLensChange }) => {
  const [open, setOpen] = useState(false);
  const [draftAudience, setDraftAudience] = useState(audience);
  const [draftLens, setDraftLens] = useState(lens);
  const choices = useRef<HTMLDivElement>(null);
  const lastFeedLens = useRef<FeedLens>('latest');
  if (lens !== 'saved') lastFeedLens.current = lens;
  const count = Number(audience !== 'friends') + Number(lens === 'highlights');
  const audienceLabel = audiences.find(item => item.id === audience)!.label;
  const openFilters = () => { setDraftAudience(audience); setDraftLens(lens); setOpen(true); };
  const apply = () => {
    onAudienceChange(draftAudience);
    onLensChange(draftAudience === 'recipes' && draftLens === 'highlights' ? 'latest' : draftLens);
    setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => choices.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
      if (event.key !== 'Tab') return;
      const dialog = choices.current?.closest('[role="dialog"]');
      const focusable = [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),[href],input,select,[tabindex="0"]') ?? [])];
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', key);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus({preventScroll:true}); };
  }, [open]);

  return <div className="feed-navigation">
    <div className="feed-navigation-row">
      <nav aria-label="Feed views" className="feed-view-tabs">
        <button aria-pressed={lens !== 'saved'} onClick={() => onLensChange(lastFeedLens.current)}>Feed</button>
        <Link to="/reels"><Play size={15} />Reels</Link>
        <button aria-pressed={lens === 'saved'} onClick={() => onLensChange('saved')}><Bookmark size={15} />Saved</button>
      </nav>
      <GlassButton id="feed-options" symbol="slider.horizontal.3" label="Filter feed" className="feed-options-button" badge={count ? String(count) : undefined} onClick={openFilters}><SlidersHorizontal size={19} />{count > 0 && <i />}</GlassButton>
    </div>
    <p className="feed-current-scope">{audienceLabel}<span>·</span>{lens === 'saved' ? 'Saved' : lens === 'highlights' ? 'Highly rated' : 'Latest'}</p>
    {createPortal(<SheetShell open={open} onClose={() => setOpen(false)} title="Make it your feed" ariaLabel="Feed filters" footer={<SheetCta onClick={apply}>Show {draftLens === 'saved' ? 'saved' : 'feed'}</SheetCta>}>
      <div ref={choices} className="feed-filter-choices">
        <fieldset><legend>From</legend><div className="feed-audience-options" role="radiogroup" aria-label="Feed audience">
          {audiences.map(({id,label,icon:Icon}) => <button key={id} role="radio" aria-checked={draftAudience === id} onClick={() => { setDraftAudience(id); if(id === 'recipes' && draftLens === 'highlights') setDraftLens('latest'); }}><Icon size={21}/><span>{label}</span>{draftAudience === id && <Check size={12} className="feed-option-check"/>}</button>)}
        </div></fieldset>
        {draftLens !== 'saved' && <fieldset><legend>Show first</legend><div className="feed-order-options" role="radiogroup" aria-label="Feed order">
          <button role="radio" aria-checked={draftLens === 'latest'} onClick={() => setDraftLens('latest')}>Latest</button>
          <button role="radio" aria-checked={draftLens === 'highlights'} disabled={draftAudience === 'recipes'} onClick={() => setDraftLens('highlights')}>Highly rated</button>
        </div>{draftAudience === 'recipes' && <p>Cooking posts appear newest first.</p>}</fieldset>}
      </div>
    </SheetShell>, document.body)}
  </div>;
};
