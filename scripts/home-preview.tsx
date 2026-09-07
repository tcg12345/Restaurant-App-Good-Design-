/** Visual-only fixture with native safe-area spacing. No account writes. */
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HomeExperience } from '../src/components/HomeExperience';
import { HomeGuideRail } from '../src/components/HomeGuides';
import { Plus, MessageCircle, Users, Home, Search, Bookmark, User, Clapperboard } from 'lucide-react';
import '../src/index.css';
function Preview(){
 const [dark,setDark]=useState(false); const [open,setOpen]=useState(false);
 useEffect(()=>{document.documentElement.classList.toggle("dark",dark);},[dark]);

 return <div className={dark?"dark home-preview-dark":"home-preview-light"}><style>{` .home-preview-dark .preview-nav{background:#1d2420;color:#edf1eb}.home-preview-dark .preview-theme{color:#a2aca4}.home-preview-light .preview-nav{background:white;color:#252b29}.home-preview-light .preview-theme{color:#252b29}.home-topbar{padding-top:65px}.home-launch{padding-bottom:112px}.preview-nav{position:fixed;bottom:28px;left:22px;right:22px;display:flex;justify-content:space-around;padding:15px 0;border-radius:32px;background:var(--color-paper);box-shadow:0 0 0 1px #8882}.preview-theme{position:fixed;top:12px;right:22px;font:11px system-ui;z-index:20}@media(max-height:650px){.home-topbar{padding-top:8px}.home-launch{padding-bottom:70px}.preview-nav{bottom:10px}.preview-theme{display:none}}`}</style>
 <button className="preview-theme" onClick={()=>setDark(v=>!v)}>{dark?'Light':'Dark'} preview</button>
 <HomeExperience active={!open} name="Tyler" city="New York" onLocation={()=>{}} onSearch={()=>{}} onAction={()=>{}} onHighlightLink={()=>{}} highlights={[
 {id:'meal',category:'meal',family:'discover',tone:'sage',eyebrow:'A TABLE WORTH FINDING',title:'Your next great evening.',detail:'A little inspiration for going out.',cta:'Explore restaurants',action:'find',image:'/images/onboarding/contemporary-dining.jpg'},
 {id:'brunch',category:'brunch',family:'discover',tone:'sage',eyebrow:'EXPLORE NEW YORK CITY',title:'A new spot for brunch.',detail:'Something new around the corner.',cta:'Find a place',action:'find'},
 ]} header={<nav><button className="home-glass-button" aria-label="Create"><Plus size={22}/></button><button className="home-glass-button" aria-label="Messages"><MessageCircle size={20}/></button><button className="home-glass-button" aria-label="Circle"><Users size={20}/></button></nav>} guides={<HomeGuideRail onBrowse={()=>setOpen(true)} guides={[
 {id:'preview-one',title:'A few places worth crossing town for',author:'GoodEats',type:'restaurants',count:5,daysAgo:1,image:'/images/onboarding/contemporary-dining.jpg'},
 {id:'preview-two',title:'Something good for a slow Sunday',author:'GoodEats',type:'recipes',count:8,daysAgo:2,image:''},
]}/>} feed={<p>Feed preview</p>}/>
 <div className="preview-nav" aria-hidden="true"><Home size={24}/><Search size={24}/><Clapperboard size={24}/><Bookmark size={24}/><User size={24}/></div></div>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><Preview/></BrowserRouter>);
