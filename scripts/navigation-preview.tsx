/** Isolated navigation harness: real route stack, gestures and guide UI, no account requests. */
import React, { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { motion } from 'motion/react';
import { SwipeBackContainer } from '../src/components/SwipeBackContainer';
import { RetainedRouteStack } from '../src/components/RetainedRouteStack';
import { GuidesBrowser } from '../src/components/GuidesBrowser';
import { recordNavEntry, backTargetFor, routeBackGesture } from '../src/lib/nav-stack';
import { usePageBack } from '../src/lib/usePageBack';
import { useLocalBack } from '../src/lib/back-navigation';
import '../src/index.css';
function Preview() {
 const location=useLocation(), navigate=useNavigate(), type=useNavigationType();
 const [edgeAudit,setEdgeAudit]=useState('No edge samples yet');
 const [instant,setInstant]=useState(false), [step,setStep]=useState(false), [dark,setDark]=useState(false);
 const owner=useRef<HTMLElement>(null), current=useRef<HTMLElement>(null);
 const index=window.history.state?.idx??0;
 useLayoutEffect(()=>{recordNavEntry(index,{pathname:location.pathname,search:location.search},type)},[location.key]);
 const target=backTargetFor(index,location.pathname,location.search);
 const direction=routeBackGesture(location.pathname,location.search,location.state,!!target);
 const back=usePageBack('/');
 useLocalBack(location.pathname==='/create'&&step,()=>setStep(false),owner);
 const guides=Array.from({length:12},(_,i)=>({id:String(i),title:`Guide ${i+1}: A few favorites`,author:'Preview',type:'restaurants' as const,count:5,image:'',daysAgo:i}));
 // Sample the actual compositor styles through the end of a navigation.
 // This fixture records an otherwise easy-to-miss parked-shadow frame.
 const auditEdge=()=>{
   let seenFront=false, parked=0, residual=false;
   const started=performance.now();
   setEdgeAudit('Sampling transition…');
   const sample=()=>{
     const front=document.querySelector<HTMLElement>('[data-swipe-front]');
     const shadow=document.querySelector<HTMLElement>('[data-swipe-shadow]');
     if(front){
       const rect=front.getBoundingClientRect();
       if(getComputedStyle(front).visibility==='visible')seenFront=true;
       const outside=rect.left>=window.innerWidth-.05||rect.right<=.05||rect.top>=window.innerHeight-.05;
       if(seenFront&&outside){
         parked++;
         const oldShadow=getComputedStyle(front).boxShadow;
         residual ||= (getComputedStyle(front).visibility==='visible'&&oldShadow!=='none') || (!!shadow&&Number(getComputedStyle(shadow).opacity)>.01);
       }
     }
     if(performance.now()-started<1500)requestAnimationFrame(sample);
     else setEdgeAudit(parked ? `${residual?'FAIL':'PASS'} · ${parked} end frames · ${residual?'residual edge':'no residual shadow'}` : 'No parked frames sampled');
   };
   requestAnimationFrame(sample);
 };
 const simulate=(wrong=false)=>{
   const node=current.current?.querySelector('[data-route-drag-handle]')??current.current;
   if(!node||!direction)return;
   if(!wrong)auditEdge();
   const sx=direction==='left'?window.innerWidth-55:55,sy=130;
   const sign=(direction==='left'?-1:1)*(wrong?-1:1);
   const send=(type:string,d:number)=>{const touch={clientX:direction==='down'?sx:sx+sign*d,clientY:direction==='down'?sy+(wrong?-d:d):sy};const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperties(e,{touches:{value:type==='touchend'?[]:[touch]},changedTouches:{value:[touch]}});node.dispatchEvent(e);};
   send('touchstart',0);setTimeout(()=>send('touchmove',18),35);setTimeout(()=>send('touchmove',(direction==='down'?window.innerHeight:window.innerWidth)*.65),80);setTimeout(()=>send('touchend',0),110);
 };
 return <div className={dark?'dark':''}><style>{`.preview-screen{height:100dvh;background:var(--color-surface);color:var(--color-on-surface)}.preview-copy{padding:70px 24px;display:flex;flex-direction:column;gap:22px}.preview-copy h1{font:650 30px system-ui}.preview-copy a,.preview-copy button{padding:14px 18px;background:var(--brand-soft);border-radius:16px;text-align:left}.verify-hud{position:fixed;bottom:12px;left:12px;right:12px;z-index:250;background:#263a30;color:white;border-radius:18px;padding:12px;display:flex;flex-wrap:wrap;gap:12px;font:12px system-ui}.verify-hud button{padding:9px;background:#fff2;border-radius:10px}.verify-hud output{flex-basis:100%}`}</style>
 <SwipeBackContainer enabled={!!direction} direction={direction??'right'} navKey={index} locationKey={location.key} snapshotable revealSnapshotKey={target?.kind==='pop'?index-1:null} backIsPop={target?.kind==='pop'} onBack={()=>{if(target?.kind==='pop')navigate(-1);else navigate(target?.to??'/',{replace:true});}} onLockTransition={setInstant}>
 <RetainedRouteStack entryKey={location.key} index={index} pathname={location.pathname} pop={type==='POP'} instant={instant}>
 <motion.section ref={el=>{owner.current=el;current.current=el;}} key={location.key} className="preview-screen" data-route-entry={location.key} data-route-stack={window.location.pathname} initial={instant?false:{x:direction==='left'?'-100%':direction==='right'?'100%':0,y:direction==='down'?'100%':0}} animate={{x:0,y:0}} transition={{duration:instant?0:.2}}>
 {location.pathname==='/guides'?<GuidesBrowser open variant="page" isMobile realGuides={guides} onClose={back} onOpenGuide={id=>navigate(`/guides/${id}`)}/>:<main className="preview-copy">
 <h1>{location.pathname==='/'?'Home':location.pathname==='/create'?step?'Recipe options':'Create':location.pathname==='/decide'?'Decide together':'Guide reader'}</h1>
 {location.pathname==='/'?<><Link to="/decide">Open Decide together</Link><Link to="/create">Open Create</Link><Link to="/guides">Open Guides</Link></>:<button onClick={back}>Back</button>}
 {location.pathname==='/create'&&!step&&<button onClick={()=>setStep(true)}>Open recipe options</button>}
 <p>Isolated preview. No account data is modified.</p></main>}
 </motion.section></RetainedRouteStack></SwipeBackContainer>
 <aside className="verify-hud"><output aria-label="Current route">{location.pathname} · {direction??'root'}</output><output aria-label="End-frame check">{edgeAudit}</output><button onClick={()=>{auditEdge();back();}}>Test Back button</button><button onClick={()=>simulate()}>Simulate return swipe</button><button onClick={()=>simulate(true)}>Wrong direction</button><button onClick={()=>setDark(d=>!d)}>Theme</button></aside>
 </div>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter basename="/scripts/navigation-preview.html"><Preview/></BrowserRouter>);
