import React, {useEffect,useState} from 'react';
import {ArrowRight,ArrowUpRight,Clock3,Compass,Footprints,Search,Users,ChevronDown,RefreshCw} from 'lucide-react';
import {supabase} from '../lib/supabase';
import {compareAttention,explorationDuration as time,explorationPageName as pageName,overlookedPages,visitorName,type ExplorationReport,type ExplorationVisitor} from '../lib/analytics-exploration';
import './AnalyticsExploration.css';
const number=(value:number)=>value.toLocaleString(undefined,{maximumFractionDigits:1});
const percent=(n:number,d:number)=>d?`${Math.round(n/d*100)}%`:'—';
const weekdays=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

export function AnalyticsExploration({days,platform,refresh,visitor,onVisitorChange}:{days:number;platform:string;refresh:number;visitor:ExplorationVisitor|null;onVisitorChange:(v:ExplorationVisitor|null)=>void}) {
 const [data,setData]=useState<ExplorationReport|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState('');
 const [people,setPeople]=useState<ExplorationVisitor[]>([]),[query,setQuery]=useState(''),[peopleError,setPeopleError]=useState(''),[peopleBusy,setPeopleBusy]=useState(false);
 const [retry,setRetry]=useState(0),[sort,setSort]=useState<'active_ms'|'views'|'avg_active_ms'>('active_ms');
 const [focus,setFocus]=useState(''),[showAll,setShowAll]=useState(false);
 useEffect(()=>{
  let cancelled=false;setBusy(true);setData(null);setError('');
  Promise.resolve(supabase.rpc('analytics_exploration',{days,platform_filter:platform||null,actor_id:visitor?.actor||null})).then(({data,error})=>{
   if(cancelled)return;
   if(error)setError(error.message);else setData(data as ExplorationReport);
  }).catch(()=>{if(!cancelled)setError('Connection interrupted. Please try again.');}).finally(()=>{if(!cancelled)setBusy(false);});
  return()=>{cancelled=true;};
 },[days,platform,refresh,visitor?.actor,retry]);
 useEffect(()=>{
  let cancelled=false;setPeopleBusy(true);setPeopleError('');
  const timer=setTimeout(()=>{
   Promise.resolve(supabase.rpc('analytics_exploration_visitors',{days,platform_filter:platform||null,search_query:query})).then(({data,error})=>{
    if(cancelled)return;
    if(error){setPeople([]);setPeopleError('Visitors could not load. Try again.');}else setPeople(data||[]);
   }).catch(()=>{if(!cancelled){setPeople([]);setPeopleError('Visitors could not load. Try again.');}}).finally(()=>{if(!cancelled)setPeopleBusy(false);});
  },query?250:0);
  return()=>{cancelled=true;clearTimeout(timer);};
 },[days,platform,refresh,query,retry]);
 const pages=[...(data?.pages||[])].sort((a,b)=>(b[sort]??-1)-(a[sort]??-1)||a.page.localeCompare(b.page));
 const focused=pages.find(p=>p.page===focus)||pages[0];
 const unvisited=overlookedPages(data?.pages||[]);
 const max=Math.max(...pages.map(p=>p[sort]||0),1);
 const incoming=(data?.transitions||[]).filter(t=>t.destination===focused?.page).sort((a,b)=>b.transitions-a.transitions).slice(0,5);
 const outgoing=(data?.transitions||[]).filter(t=>t.source===focused?.page).sort((a,b)=>b.transitions-a.transitions).slice(0,5);
 const rhythmMax=Math.max(...(data?.rhythm||[]).map(r=>r.visits),1);
 const deep=[...(data?.pages||[])].filter(p=>p.timed_visits>0).sort((a,b)=>(b.avg_active_ms||0)-(a.avg_active_ms||0))[0];
 const repeat=[...(data?.pages||[])].filter(p=>p.repeat_visitors>0).sort((a,b)=>b.repeat_visitors-a.repeat_visitors)[0];
 const selectedPeople=visitor&&!people.some(p=>p.actor===visitor.actor)?[visitor,...people]:people;
 return <div className="exploration-view">
  <section className="exp-hero">
   <div><div className="exp-kicker"><Compass size={15}/> EXPLORATION / LAST {days} DAYS</div><h2>Where attention goes.</h2><p>Follow the paths people take, the places they linger, and the parts of your app still waiting to be explored.</p></div>
   <div className="exp-scope-badge"><Users size={18}/><span>{visitor?visitorName(visitor):'All visitors'}<small>{platform?`${platform==='ios'?'iOS':platform==='web'?'Web':'Server'} activity`:'Web + iOS activity'}</small></span></div>
  </section>
  <div className="exp-audience">
   <button className={!visitor?'exp-everyone active':'exp-everyone'} aria-pressed={!visitor} onClick={()=>{onVisitorChange(null);setQuery('');}}><Users size={15}/> Everyone</button>
   <label data-search-field className="exp-search"><Search size={15}/><input data-search-input="embedded" aria-label="Find a visitor" placeholder="Find a visitor by name or username…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <label className="exp-person"><span>Explore as</span><select aria-label="Exploration visitor" value={visitor?.actor||''} onChange={e=>onVisitorChange(selectedPeople.find(p=>p.actor===e.target.value)||null)}><option value="">All visitors</option>{selectedPeople.map(p=><option key={p.actor} value={p.actor}>{visitorName(p)}</option>)}</select></label>
  </div>
  <p className="exp-scope-note" role="status">{peopleError|| (peopleBusy?'Finding visitors…':query&&!people.length?'No visitors match in this period.':'Visitor search covers recorded activity in this period; up to 50 matches.')} {peopleError&&<button onClick={()=>setRetry(n=>n+1)}>Retry</button>}</p>
  {busy?<div className="exp-loading" role="status"><Compass size={28}/><h3>Tracing the journeys…</h3><p>Gathering visits and active time for this selection.</p></div>:error?<div className="analytics-notice analytics-error" role="alert"><strong>Exploration could not load.</strong><p>{error}</p><button onClick={()=>setRetry(n=>n+1)}><RefreshCw size={14}/> Try again</button></div>:data&&<>
   {!data.summary.visits?<div className="exp-loading"><Compass size={28}/><h3>No recorded journeys here yet.</h3><p>{platform==='server'?'Exploration uses page activity from Web and iOS. Choose one of those platforms or All platforms.':'Try another visitor or a longer date range. A lack of tracking does not mean a person avoided the app.'}</p></div>:<>
    <div className="exp-stats">
     <article><span><Users size={15}/> {visitor?'Recorded visits':'People exploring'}</span><strong>{number(visitor?data.summary.visits:data.summary.visitors)}</strong><small>{number(data.session_summary.sessions)} recorded sessions</small></article>
     <article><span><Clock3 size={15}/> Active time</span><strong>{time(data.summary.timed_visits?data.summary.active_ms:null)}</strong><small>{percent(data.summary.timed_visits,data.summary.visits)} of visits have timing data</small></article>
     <article><span><Compass size={15}/> Breadth of exploration</span><strong>{number(data.summary.pages)} <em>pages</em></strong><small>Different page types visited</small></article>
     <article><span><Footprints size={15}/> Typical session</span><strong>{number(data.session_summary.median_pages||0)} <em>pages</em></strong><small>Median distinct pages per session</small></article>
    </div>
    <div className="exp-main-grid">
     <section className="exp-card exp-attention">
      <header><div><span className="exp-section-number">01 / ATTENTION</span><h3>Pages that hold attention</h3><p>Select a page to inspect the paths around it.</p></div><select aria-label="Rank exploration pages" value={sort} onChange={e=>setSort(e.target.value as typeof sort)}><option value="active_ms">Total active time</option><option value="views">Visits</option><option value="avg_active_ms">Time per timed visit</option></select></header>
      <div className="exp-attention-labels"><span>Page / share of selected metric</span><span>Visits</span><span>Avg. active</span></div>
      {(showAll?pages:pages.slice(0,8)).map(p=><button key={p.page} className={`exp-page-row ${focused?.page===p.page?'selected':''}`} onClick={()=>setFocus(p.page)} aria-pressed={focused?.page===p.page}>
       <div><span className="exp-page-title">{pageName(p.page)}<ArrowUpRight size={13}/></span><span className="exp-bar"><i style={{width:`${(p[sort]||0)/max*100}%`}}/></span><small>{sort==='views'?`${number(p.views)} visits`:time(sort==='active_ms'?(p.timed_visits?p.active_ms:null):p.avg_active_ms)} · {number(p.visitors)} {p.visitors===1?'visitor':'visitors'}</small></div>
       <span>{number(p.views)}</span><span>{time(p.avg_active_ms)}<small>{p.timed_visits}/{p.views} timed</small></span>
      </button>)}
      {pages.length>8&&<button className="exp-text-button" onClick={()=>setShowAll(!showAll)}>{showAll?'Show fewer pages':`Show all ${pages.length} visited pages`}<ChevronDown size={14}/></button>}
     </section>
     <aside className="exp-insights">
      <section className="exp-card exp-signal"><span className="exp-section-number">A CLOSER LOOK</span><h3>{deep?pageName(deep.page):'Timing is still arriving'}</h3><p>{deep?<>Longest average active visit: <strong>{time(deep.avg_active_ms)}</strong>, from {number(deep.timed_visits)} timed visits.</>:'There is not enough timing data to identify a page with longer visits.'}</p>{repeat&&<div className="exp-return"><Footprints size={17}/><p><strong>{pageName(repeat.page)}</strong><br/>{number(repeat.repeat_visitors)} {repeat.repeat_visitors===1?'visitor returned':'visitors returned'} to this page.</p></div>}</section>
      <section className="exp-card exp-unvisited"><span className="exp-section-number">02 / UNEXPLORED</span><h3>{unvisited.length} destinations untouched</h3><p>No recorded visits to these main destinations {visitor?'by this visitor':'in this audience'} during the selected period.</p><div className="exp-destination-chips">{unvisited.map(([key,title])=><span key={key}>{title}</span>)}{!unvisited.length&&<span>Every main destination was visited</span>}</div><small>Not evidence of dislike. Some pages require an account, and tracking can be missing.</small></section>
     </aside>
    </div>
    {focused&&<section className="exp-card exp-flow">
     <header><div><span className="exp-section-number">03 / NAVIGATION</span><h3>The paths around {pageName(focused.page)}</h3><p>Consecutive recorded page visits within the same session.</p></div><span className="exp-pill">{number(focused.entries)} first stops · {number(focused.last_stops)} last stops</span></header>
     <div className="exp-flow-grid">
      <div><h4>Arriving from</h4>{incoming.length?incoming.map(t=><button key={t.source} onClick={()=>setFocus(t.source)}><span>{pageName(t.source)}</span><b>{number(t.transitions)}</b><ArrowRight size={14}/></button>):<p className="exp-no-path">No earlier page recorded.</p>}</div>
      <div className="exp-flow-center"><Compass size={24}/><h4>{pageName(focused.page)}</h4><strong>{time(focused.avg_active_ms)}</strong><p>Average active time per timed visit</p>{visitor&&<small>{compareAttention(focused.avg_active_ms,data.baseline.find(p=>p.page===focused.page)?.avg_active_ms)}</small>}<div><span><b>{focused.brief_visits}</b> brief ≤10s</span><span><b>{focused.long_visits}</b> long ≥1m</span></div><small>{focused.views-focused.timed_visits} visits without timing data</small></div>
      <div><h4>Continuing to</h4>{outgoing.length?outgoing.map(t=><button key={t.destination} onClick={()=>setFocus(t.destination)}><ArrowRight size={14}/><span>{pageName(t.destination)}</span><b>{number(t.transitions)}</b></button>):<p className="exp-no-path">No next page recorded.</p>}</div>
     </div><p className="exp-note">First and last stops are relative to the recorded session and selected period. A last stop does not establish that someone abandoned the app.</p>
    </section>}
    <div className="exp-bottom-grid">
     <section className="exp-card exp-rhythm"><header><div><span className="exp-section-number">04 / RHYTHM</span><h3>When exploration happens</h3><p>Recorded page visits by weekday and hour · UTC</p></div></header><div className="exp-heat-scroll"><div className="exp-heat-labels"><span/>{[0,4,8,12,16,20].map(hour=><span key={hour}>{String(hour).padStart(2,'0')}</span>)}</div><div className="exp-heatmap">{weekdays.map((day,d)=><div className="exp-heat-row" key={day}><span>{day}</span>{Array.from({length:24},(_,hour)=>{const count=data.rhythm.find(r=>r.weekday===d&&r.hour===hour)?.visits||0;return <span key={hour} role="img" aria-label={`${day} ${hour}:00 UTC: ${count} visits`} title={`${day} ${hour}:00 UTC · ${count} visits`} className="exp-heat-cell" style={{background:count?`rgba(64,107,80,${.18+.82*count/rhythmMax})`:'#edf0e9'}}/>;})}</div>)}</div></div><div className="exp-heat-legend">Fewer <i/><i/><i/><i/> More visits</div></section>
     <section className="exp-card exp-reading"><span className="exp-section-number">READING THE PATTERN</span><h3>Time gives the visit context.</h3><p>A brief visit can mean a quick success. A long visit can mean interest or friction. Use the session paths below to see what happened next.</p><div><strong>{percent(data.session_summary.single_page_sessions,data.session_summary.sessions)}</strong><span>of recorded sessions stayed on one page type</span></div><small>Active time pauses in the background and after 60 seconds without interaction. Timing coverage is shown above.</small></section>
    </div>
    <section className="exp-card exp-journeys"><header><div><span className="exp-section-number">05 / SESSION JOURNEYS</span><h3>{visitor?'Their recent paths':'A closer look at recent sessions'}</h3><p>Latest 20 sessions in this selection. Expand a journey for each stop and its active time.</p></div><span className="exp-pill">{visitor?visitorName(visitor):'All visitors'}</span></header>
     {data.sessions.map(s=><details key={`${s.actor}:${s.platform}:${s.session_id}`}><summary><span className="exp-session-icon"><Footprints size={17}/></span><span className="exp-session-date">{new Date(s.started_at).toLocaleString()}<small>{s.platform==='ios'?'iOS':'Web'}{!visitor?` · Visitor ${s.actor.slice(0,8)}`:''} · {s.views} stops · {s.pages} page types</small></span><span className="exp-route-preview">{s.steps.slice(0,4).map((step,i)=><React.Fragment key={step.id}>{i>0&&<ArrowRight size={12}/>}<span>{pageName(step.page)}</span></React.Fragment>)}{s.views>4&&<span>+{s.views-4}</span>}</span><ChevronDown size={16}/></summary><ol>{s.steps.map((step,i)=><li key={step.id}><span>{i+1}</span><div><strong>{pageName(step.page)}</strong><small>{new Date(step.occurred_at).toLocaleTimeString()}</small></div><b>{time(step.segments?step.active_ms:null)}</b></li>)}</ol>{s.views>100&&<p className="exp-note">First 100 stops shown. Session totals include every recorded stop.</p>}</details>)}
    </section>
   </>}
   <p className="exp-note">Based on recorded activity, not a complete history of everything a person did. Historical timing is matched to the preceding page visit; new builds use visit identifiers. {data.unmatched_segments>0?`${data.unmatched_segments} timing segments could not be matched and are excluded from active-time totals. `:''}Updated {new Date(data.generated_at).toLocaleString()}.</p>
  </>}
 </div>;
}
