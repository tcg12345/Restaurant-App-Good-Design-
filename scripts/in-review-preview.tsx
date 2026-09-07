/** Development-only fixture: never writes to an account or ships in the app entry. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ToastProvider } from '../src/contexts/ToastContext';
import { SignInModalProvider } from '../src/contexts/SignInModalContext';
import { SettingsProvider } from '../src/contexts/SettingsContext';
import { PlanProvider } from '../src/contexts/PlanContext';
import { PaywallProvider } from '../src/contexts/PaywallContext';
import { ReviewArchiveContent } from '../src/components/in-review/ReviewArchive';
import { ReviewViewer } from '../src/components/in-review/ReviewViewer';
import { buildReview, periodContaining, type ReviewKind, type ReviewInput } from '../src/lib/in-review';
import { buildTasteProfile } from '../src/lib/recommendations';
import type { RestaurantRating, HomeMeal } from '../src/contexts/ListsContext';
import '../src/index.css';
const fixtures=(kind:ReviewKind)=>{
  const period=periodContaining(kind,new Date('2025-12-24T12:00:00'));
  const rows=Array.from({length:kind==='year'?42:kind==='month'?14:5},(_,i)=>({restaurantId:String(i),name:['The Green Room','Juniper','Little Nori','Casa Alba'][i%4],cuisine:['Italian','Japanese','Mexican','Thai','French'][i%5],price:['$','$$','$$$'][i%3],address:i%3?'New York, NY':'Boston, MA',score:7+(i%10)/4,visitDate:kind==='year'?`2025-${String(i%12+1).padStart(2,'0')}-15`:`2025-12-${String(kind==='month'?i+1:22+i).padStart(2,'0')}`,createdAt:Date.parse('2025-12-29T12:00:00'),wouldReturn:true,friendIds:[],tags:[],photos:[],notes:'',image:'',listIds:[]} as RestaurantRating));
  const input:ReviewInput={ratings:rows,meals:[{id:'demo-meal',name:'Lemon & herb pasta',date:'2025-12-24',createdAt:Date.parse('2025-12-24T12:00:00'),score:9} as HomeMeal],recipes:[],wishlist:[],history:{},scoresUnlocked:true};
  return buildReview(period,input,buildTasteProfile(rows,[],[],[]),{rankedUsers:230,platformAvgScore:8.1,breadthPercentile:.82,gradingPercentile:.63,distinctivePercentile:.72,myRank:22,myPoints:0,avgCuisineCount:4,avgCityCount:2,medianRatingCount:12,platformPriceShare:null,concentratedUserShare:null},new Date('2026-01-02T12:00:00'));
};
function Preview(){const [kind,setKind]=useState<ReviewKind|null>(null);const [archive,setArchive]=useState(false);const [auto,setAuto]=useState(true);return <div style={{padding:30,color:'var(--color-ink)',background:'var(--color-surface)',minHeight:'100vh',fontFamily:'system-ui'}}><h1>GoodEats in Review · Demo data</h1><p>Fictional activity for visual review only.</p>{(['week','month','year'] as const).map(k=><button key={k} style={{padding:18,margin:8,border:'1px solid gray',borderRadius:14}} onClick={()=>setKind(k)}>{k}</button>)}<button style={{padding:18,margin:8,border:'1px solid gray',borderRadius:14}} onClick={()=>setArchive(v=>!v)}>Archive</button>{archive&&<div style={{maxWidth:480,margin:'30px auto'}}><ReviewArchiveContent reviews={(['week','month','year'] as const).map(fixtures)} loading={false} syncUnavailable={false} autoReveal={auto} setAutoReveal={setAuto} openReview={r=>setKind(r.period.kind)}/></div>}{kind&&<ReviewViewer review={fixtures(kind)} onClose={()=>setKind(null)}/>}</div>}
createRoot(document.getElementById('root')!).render(<BrowserRouter><SettingsProvider><ToastProvider><SignInModalProvider><PlanProvider><PaywallProvider><Preview/></PaywallProvider></PlanProvider></SignInModalProvider></ToastProvider></SettingsProvider></BrowserRouter>);
