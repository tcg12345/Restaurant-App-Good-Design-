import React, { useState } from 'react';
import { ArrowUpRight, CalendarDays, Sparkles, Play, BookOpen } from 'lucide-react';
import { useInReview } from '../../contexts/InReviewContext';
import type { ReviewKind } from '../../lib/in-review';
import './InReview.css';

export function ReviewArchive() {
  return <ReviewArchiveContent {...useInReview()} />;
}
export function ReviewArchiveContent({ reviews,loading,syncUnavailable,autoReveal,setAutoReveal,openReview }: ReturnType<typeof useInReview>) {
  const [filter,setFilter]=useState<ReviewKind|'all'>('all');
  const visible=reviews.filter(r=>filter==='all'||r.period.kind===filter);
  return <div className="review-archive">
    <div className="review-archive-intro"><span><Sparkles size={19}/></span><h2>Your good taste.<br/>Worth looking back on.</h2><p>Every week, month, and year. The meals, places, and little discoveries that made it yours.</p></div>
    <div className="review-archive-preference"><span><strong>A little reveal, just for you</strong><small>Open new reviews automatically on Home.</small></span><button type="button" role="switch" aria-label="Show new GoodEats reviews automatically" aria-checked={autoReveal} onClick={()=>setAutoReveal(!autoReveal)}><i/></button></div>
    <div className="review-archive-filters" role="group" aria-label="Review period">{(['all','week','month','year'] as const).map(kind=><button key={kind} type="button" aria-pressed={filter===kind} onClick={()=>setFilter(kind)}>{({all:'All',week:'Weekly',month:'Monthly',year:'Annual'})[kind]}</button>)}</div>
    {syncUnavailable&&<p className="review-archive-status" role="status">Your saved stories are available. Reconnect and reopen the app to create new reviews.</p>}
    {loading&&<p role="status" className="review-archive-status">Putting your stories together…</p>}
    {!loading&&!visible.length&&<div className="review-archive-empty"><BookOpen size={32} strokeWidth={1.4}/><h3>Your story is still unfolding.</h3><p>Keep logging meals, rating places, or saving favorites. Weekly reviews arrive on Mondays, monthly reviews on the 1st, and annual reviews in January.</p></div>}
    <div className="review-archive-grid">{visible.map(r=><button type="button" key={r.period.id} className={`review-archive-card is-${r.period.kind}`} onClick={()=>openReview(r)}>
      <span className="review-archive-card-top"><span>{r.period.kind==='year'?<Sparkles size={15}/>:<CalendarDays size={15}/>} {r.period.kind==='year'?'The annual edition':`Your ${r.period.kind} in review`}</span><ArrowUpRight size={17}/></span>
      <strong>{r.period.label}</strong><small>{r.places} {r.places===1?'place':'places'} · {r.meals} home {r.meals===1?'meal':'meals'} · {r.cuisines.length} {r.cuisines.length===1?'cuisine':'cuisines'}</small><span className="review-archive-play"><Play size={12} fill="currentColor"/> Replay your story</span>
    </button>)}</div>
    <p className="review-archive-footnote">Private to your account. Reviews use recorded activity dates and local calendar boundaries. Saved stories reflect the data available when they were made; days without logged activity don’t create empty reviews.</p>
  </div>;
}
