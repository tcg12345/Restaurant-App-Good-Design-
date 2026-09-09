import { NextMealCard } from '../src/components/HomeNextMeal';
import { FeedNavigation } from '../src/components/feed/FeedNavigation';
import type { FeedFilter } from '../src/components/SocialFeed';
import type { FeedLens } from '../src/lib/feed-discovery';
import { HomeReelRail, FeedReelCard } from '../src/components/HomeReels';
import type { Reel } from '../src/contexts/ReelsContext';
/** Visual-only fixture with native safe-area spacing. No account writes. */
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HomeExperience } from '../src/components/HomeExperience';
import { HomeGuideRail } from '../src/components/HomeGuides';
import { Home, Search, Bookmark, User, MessageCircle } from 'lucide-react';
import { HomeShortcuts } from '../src/components/HomeShortcuts';
import '../src/index.css';
const previewReels = [
 {id:'preview-dining',kind:'restaurant',restaurant:{name:'A table worth finding'},posterUrl:'/images/onboarding/contemporary-dining.jpg',caption:'A little look inside tonight’s dinner.',authorUsername:'alex',authorDisplayName:'Alex Chen'},
 {id:'preview-cooking',kind:'recipe',recipe:{title:'Miso salmon, made at home'},posterUrl:'/images/onboarding/miso-salmon.jpg',caption:'Weeknight cooking, with a little extra care.',authorUsername:'jamie',authorDisplayName:'Jamie Park'},
 {id:'preview-next',kind:'restaurant',restaurant:{name:'Your next favorite spot'},posterUrl:'/images/onboarding/contemporary-dining.jpg',authorUsername:'sam',authorDisplayName:'Sam Lee'},
].map(r=>({...r,authorId:r.id,authorInitials:r.authorUsername[0].toUpperCase(),authorAvatarColor:'bg-emerald-700',isPublic:true,videoUrl:'preview-only',createdAt:1,likes:0,comments:0,saves:0,liked:false,saved:false,bgGradient:'',audioLabel:'',locationLabel:'New York',isExpert:false})) as Reel[];
function Preview(){
 const [audience,setAudience]=useState<FeedFilter>('friends'); const [lens,setLens]=useState<FeedLens>('latest');
 const [dark,setDark]=useState(false); const [open,setOpen]=useState(false);
 useEffect(()=>{document.documentElement.classList.toggle("dark",dark);},[dark]);

 return <div className={dark?"dark home-preview-dark":"home-preview-light"}><style>{` .home-preview-dark .preview-nav{background:#1d2420;color:#edf1eb}.home-preview-dark .preview-theme{color:#a2aca4}.home-preview-light .preview-nav{background:white;color:#252b29}.home-preview-light .preview-theme{color:#252b29}.home-topbar{padding-top:65px}.home-launch{padding-bottom:112px}.home-launch.has-reels{--home-dock-bottom:100px;padding-bottom:0}.home-launch.has-reels .home-topbar{padding-top:63px}.preview-nav{position:fixed;bottom:28px;left:22px;right:22px;display:flex;justify-content:space-around;padding:15px 0;border-radius:32px;background:var(--color-paper);box-shadow:0 0 0 1px #8882}.preview-theme{position:fixed;top:12px;right:22px;font:11px system-ui;z-index:20}@media(max-height:740px){.home-topbar{padding-top:8px}.home-launch{padding-bottom:70px}.home-launch.has-reels{--home-dock-bottom:66px;padding-bottom:0}.home-launch.has-reels .home-topbar{padding-top:24px}.preview-nav{bottom:10px}.preview-theme{display:none}}`}</style>
 <button className="preview-theme" onClick={()=>setDark(v=>!v)}>{dark?'Light':'Dark'} preview</button>
 <HomeExperience active={!open} name="Tyler" city="New York" onLocation={()=>{}} onSearch={()=>{}} onAction={()=>{}} onHighlightLink={()=>{}} highlights={[
 {id:'meal',category:'meal',family:'discover',tone:'sage',eyebrow:'A TABLE WORTH FINDING',title:'Your next great evening.',detail:'A little inspiration for going out.',cta:'Explore restaurants',action:'find',image:'/images/onboarding/contemporary-dining.jpg'},
 {id:'brunch',category:'brunch',family:'discover',tone:'sage',eyebrow:'EXPLORE NEW YORK CITY',title:'A new spot for brunch.',detail:'Something new around the corner.',cta:'Find a place',action:'find'},
 ]} nextMeal={<NextMealCard meal={{kind:'saved',title:'L’Artusi',detail:'Saved for later · Italian · $$$',action:'Take a look',href:'/restaurant/preview',image:'/images/onboarding/contemporary-dining.jpg'}} onOpen={()=>setOpen(true)} />} reels={<HomeReelRail reels={previewReels} />} header={<HomeShortcuts notificationCount={2} socialCount={3} />} guides={<HomeGuideRail onBrowse={()=>setOpen(true)} guides={[
 {id:'preview-one',title:'A few places worth crossing town for',author:'GoodEats',type:'restaurants',count:5,daysAgo:1,image:'/images/onboarding/contemporary-dining.jpg'},
 {id:'preview-two',title:'Something good for a slow Sunday',author:'GoodEats',type:'recipes',count:8,daysAgo:2,image:''},
]}/>} feed={<><FeedNavigation audience={audience} lens={lens} onAudienceChange={setAudience} onLensChange={setLens}/>{previewReels.map(reel=><FeedReelCard key={reel.id} reel={reel}/>)}</>}/>
 <div className="preview-nav" aria-hidden="true"><Home size={24}/><Search size={24}/><Bookmark size={24}/><MessageCircle size={24}/><User size={24}/></div></div>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><Preview/></BrowserRouter>);
