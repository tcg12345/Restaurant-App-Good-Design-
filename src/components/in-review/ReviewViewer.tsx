import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, BookOpen, ChefHat, Check, Compass, Lock, Pause, Play, Share2, Sparkles, Star, Utensils, X } from 'lucide-react';
import type { ReviewSnapshot } from '../../lib/in-review';
import { reviewStories, type ReviewStory } from '../../lib/review-stories';
import { reviewCard, shareReviewCard } from '../../lib/review-share';
import { useNightStatusBar } from '../../lib/night-status-bar';
import { pushOverlay } from '../../lib/overlay-registry';
import { useSocialDialog } from '../social/useSocialDialog';
import { usePlan } from '../../contexts/PlanContext';
import { usePaywall } from '../../contexts/PaywallContext';
import './InReview.css';

function Visual({ story:s,review:r,reduced }: {story:ReviewStory;review:ReviewSnapshot;reduced:boolean}) {
  const annual=r.period.kind==='year';
  if(s.visual==='cover') return <div className="review-cover-art" aria-hidden="true"><div/><div/><div/><span>{annual?r.period.label:<Utensils size={70} strokeWidth={1}/>}</span><i><Sparkles size={26}/></i></div>;
  if(s.visual==='timeline') return <div className="review-timeline" aria-label="Activity by period">{r.timeline.map((p,i)=><div key={p.label}><span>{p.count}</span><motion.i initial={{scaleY:reduced?1:0}} animate={{scaleY:1}} transition={{delay:reduced?0:i*.035,duration:.6}} style={{height:`${Math.max(3,p.count/Math.max(1,...r.timeline.map(t=>t.count))*140)}px`}}/><small>{p.label}</small></div>)}</div>;
  if(s.visual==='bars')return <div className="review-flavor-bars">{s.rows?.map((row,i)=><div key={row.label}><span><b>{String(i+1).padStart(2,'0')}</b>{row.label}<strong>{row.value}</strong></span><motion.i initial={{scaleX:reduced?1:0}} animate={{scaleX:1}} transition={{duration:.65,delay:reduced?0:i*.08}} style={{width:`${Number(row.value)/Math.max(1,...s.rows!.map(x=>Number(x.value)))*100}%`}}/></div>)}</div>;
  if(s.visual==='taste')return <div className="review-price-chart">{r.taste.priceShare.length?r.taste.priceShare.map((share,i)=><div key={i}><motion.i initial={{height:0}} animate={{height:Math.max(3,share*140)}} transition={{duration:reduced?0:.6}}/><b>{'$'.repeat(i+1)}</b><small>{Math.round(share*100)}%</small></div>):<p>More rated places will bring your price profile into focus.</p>}</div>;
  if(s.visual==='summary')return <div className="review-summary-grid">{s.rows?.map(row=><div key={row.label}><strong>{row.value}</strong><span>{row.label}</span></div>)}</div>;
  const Icon=s.visual==='kitchen'?ChefHat:s.visual==='podium'?Star:s.visual==='community'?Compass:Utensils;
  return <div className={`review-number-art is-${s.visual}`}><div className="review-orbit-ring" aria-hidden="true"/><span className="review-art-symbol" aria-hidden="true"><Icon size={35} strokeWidth={1.2}/></span>{s.number?<><strong>{s.number}</strong><small>{s.suffix}</small></>:<Icon size={76} strokeWidth={1}/>}</div>;
}
export const ReviewViewer: React.FC<{review:ReviewSnapshot;onClose:()=>void}> = ({review:r,onClose}) => {
  const plan=usePlan(); const paywall=usePaywall(); const reduced=!!useReducedMotion();
  useNightStatusBar(!paywall.isOpen);
  const pages=reviewStories(r); const [index,setIndex]=useState(0); const [direction,setDirection]=useState(1);
  const [paused,setPaused]=useState(false); const [shareOpen,setShareOpen]=useState(false); const [includeFavorite,setIncludeFavorite]=useState(false);
  const [image,setImage]=useState(''); const [sharing,setSharing]=useState(false); const [message,setMessage]=useState('');
  const [progress,setProgress]=useState(0); const touch=useRef<{x:number;y:number}|null>(null);
  const story=pages[index]; const last=index===pages.length-1; const locked=!!story.pro&&(!plan.checked||!plan.isPro);
  const close=()=>{if(shareOpen){setShareOpen(false);return;}onClose();};
  // The existing Pro sheet lives in the app root. Let it own focus while
  // open; otherwise keep the underlying app out of the review's tab order.
  useEffect(()=>{if(paywall.isOpen)return;const root=document.getElementById('root');const wasInert=root?.hasAttribute('inert');root?.setAttribute('inert','');return()=>{if(!wasInert)root?.removeAttribute('inert');};},[paywall.isOpen]);
  const dialog=useSocialDialog(!paywall.isOpen,close);
  useEffect(()=>pushOverlay(),[]);
  useEffect(()=>{setProgress(0);},[index]);
  useEffect(()=>{
    if(paused||reduced||shareOpen||paywall.isOpen||locked||last)return;
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')setProgress(n=>Math.min(1,n+.025));},225);
    return()=>window.clearInterval(timer);
  },[index,paused,reduced,shareOpen,paywall.isOpen,locked,last]);
  useEffect(()=>{if(progress>=1){setDirection(1);setIndex(n=>Math.min(pages.length-1,n+1));}},[progress,pages.length]);
  const go=(delta:number)=>{setDirection(delta);setIndex(n=>Math.max(0,Math.min(pages.length-1,n+delta)));};
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(shareOpen||paywall.isOpen||e.target instanceof HTMLInputElement)return;if(e.key==='ArrowRight'){e.preventDefault();go(1);}if(e.key==='ArrowLeft'){e.preventDefault();go(-1);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[shareOpen,paywall.isOpen,pages.length]);
  useEffect(()=>{if(shareOpen){setMessage('');try{setImage(reviewCard(r,includeFavorite));}catch{setMessage('We couldn’t create your card. Please try again.');}}},[shareOpen,includeFavorite,r]);
  const share=async()=>{if(!image||sharing)return;setSharing(true);setMessage('');try{const result=await shareReviewCard(image,r);setMessage(result==='downloaded'?'Your card was downloaded.':result==='shared'?'Your card is ready to share.':'');}catch{setMessage('Sharing didn’t finish. Please try again.');}finally{setSharing(false);}};
  return createPortal(<div className={`review-viewer is-${r.period.kind}`} role="dialog" aria-modal="true" aria-label="GoodEats in Review" ref={dialog} inert={paywall.isOpen}>
    <div className="review-ambient" aria-hidden="true"><i/><i/><i/></div>
    <div className="review-shell">
      <header className="review-header"><span>GoodEats <b>in review</b></span><div>{!shareOpen&&<button type="button" aria-label={paused||reduced?'Play review':'Pause review'} disabled={reduced} onClick={()=>setPaused(p=>!p)}>{paused||reduced?<Play size={17}/>:<Pause size={17}/>}</button>}<button type="button" aria-label={shareOpen?'Back to review':'Close review'} onClick={close}><X size={20}/></button></div></header>
      {!shareOpen&&<div className="review-progress" aria-label={`Page ${index+1} of ${pages.length}`}>{pages.map((p,i)=><button key={p.id} type="button" aria-label={`Go to page ${i+1}: ${p.kicker}`} aria-current={i===index?'step':undefined} onClick={()=>{setDirection(i>index?1:-1);setIndex(i);}}><i style={{transform:`scaleX(${i<index?1:i===index?Math.max(.05,progress):0})`}}/></button>)}</div>}
      {shareOpen?<div className="review-share-panel"><span className="review-kicker">A LITTLE GOOD TASTE TO TAKE WITH YOU</span><h2>Your share card.</h2><p>Only what you see below will be shared.</p>{image&&<img className="review-share-preview" src={image} alt={`Share card for ${r.period.label}: ${r.places} places rated, ${r.cuisines.length} cuisines, ${r.meals} home meals and ${r.recipes} recipes created.`}/>}<label className="review-share-option"><input type="checkbox" checked={includeFavorite} disabled={!r.favorite} onChange={e=>setIncludeFavorite(e.target.checked)}/>Include my standout restaurant</label><button type="button" className="review-primary" disabled={sharing||!image} onClick={()=>void share()}><Share2 size={17}/>{sharing?'Preparing…':'Share or save image'}</button>{message&&<p role="status">{message}</p>}</div>
      :<>
        <div className="review-stage" onTouchStart={e=>{touch.current={x:e.touches[0].clientX,y:e.touches[0].clientY};}} onTouchEnd={e=>{if(!touch.current)return;const dx=e.changedTouches[0].clientX-touch.current.x,dy=e.changedTouches[0].clientY-touch.current.y;touch.current=null;if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.3)go(dx<0?1:-1);}}>
          <AnimatePresence mode="wait" initial={false}><motion.section key={story.id} className={`review-story story-${story.visual}`} initial={reduced?false:{opacity:0,x:direction*22,filter:'blur(5px)'}} animate={{opacity:1,x:0,filter:'blur(0px)'}} exit={{opacity:0,x:reduced?0:direction*-16}} transition={{duration:reduced?0:.28}}>
            <span className="review-kicker">{r.period.kind==='year'&&<b>{String(index+1).padStart(2,'0')} / </b>}{story.kicker}</span>
            <h1>{story.title}</h1>
            {locked?<div className="review-locked"><Lock size={30} strokeWidth={1.3}/><h2>The finer details.<br/>A little extra for Pro.</h2><p>Your annual rating baseline, price profile, and all-time taste benchmark.</p><button type="button" className="review-primary" disabled={!plan.checked} onClick={()=>{setPaused(true);paywall.openPaywall('in-review','taste-depth');}}>See my full breakdown <ArrowRight size={16}/></button><small>Your review and share card are always available.</small></div>:<><Visual story={story} review={r} reduced={reduced}/><p className="review-detail">{story.detail}</p>{story.rows&&!['bars','summary'].includes(story.visual)&&<div className="review-facts">{story.rows.map(row=><div key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>)}</div>}</>}
            {story.visual==='summary'&&<span className="review-saved"><Check size={14}/>Saved to Settings · GoodEats in Review</span>}
          </motion.section></AnimatePresence>
        </div>
        <footer className="review-footer"><button type="button" aria-label="Previous review page" disabled={index===0} onClick={()=>go(-1)}><ArrowLeft size={19}/></button><span>{r.period.kind==='year'?'The annual edition':r.period.label}</span><button type="button" className="review-next" onClick={()=>last?setShareOpen(true):go(1)}>{last?<><Share2 size={16}/>Share</>:<>Next<ArrowRight size={16}/></>}</button></footer>
      </>}
    </div>
  </div>,document.body);
}
