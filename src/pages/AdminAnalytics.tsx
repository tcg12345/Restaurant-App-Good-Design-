import { FEATURE_CATALOG } from '../lib/analytics-features';
import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Download, RefreshCw, Search, BarChart3, Users, MapPin, Zap, Activity, ChevronRight } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { analyticsEnabled } from '../lib/analytics';
import './AdminAnalytics.css';

type Row = Record<string, any>;
type Report = Record<string, any>;
type Tab = 'Overview' | 'Pages' | 'Features' | 'Restaurants' | 'APIs' | 'Users' | 'Search' | 'Outcomes';
const tabs: Tab[] = ['Overview','Pages','Features','Restaurants','APIs','Users','Search','Outcomes'];
const n = (v: any) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
const money = (v: any) => v == null ? 'Unpriced' : `$${Number(v).toFixed(3)}`;
const duration = (ms: any) => `${Math.round(Number(ms || 0)/1000)}s`;
const pct = (num: any, den: any) => den ? `${(100*Number(num)/Number(den)).toFixed(1)}%` : '—';
const label = (s: any) => String(s ?? '—').replace(/_/g,' ');

function csv(rows: Row[], filename: string) {
  if (!rows.length) return;
  const keys = Array.from(new Set(rows.flatMap(Object.keys)));
  const cell = (v: any) => { let s = typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''); if (/^[=+@\-\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g,'""')}"`; };
  const blob = new Blob(['\uFEFF'+[keys.map(cell).join(','), ...rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\r\n')], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function Table({rows, columns, onSelect}: {rows: Row[]; columns: Array<{key: string; title: string; render?: (r:Row)=>any}>; onSelect?: (r:Row)=>void}) {
  const [sort, setSort] = useState<{key:string;desc:boolean}|null>(null);
  const sorted = sort ? [...rows].sort((a,b)=> (typeof a[sort.key]==='number' ? a[sort.key]-b[sort.key] : String(a[sort.key]??'').localeCompare(String(b[sort.key]??'')))*(sort.desc?-1:1)) : rows;
  return <div className="analytics-table-wrap"><table><thead><tr>{columns.map(c=><th key={c.key}><button onClick={()=>setSort({key:c.key,desc:sort?.key===c.key?!sort.desc:true})}>{c.title}{sort?.key===c.key?(sort.desc?' ↓':' ↑'):''}</button></th>)}</tr></thead><tbody>{sorted.map((r,i)=><tr key={r.id || r.actor || r.restaurant_id || i}>{columns.map((c,j)=><td key={c.key}>{j===0 && onSelect ? <button className="analytics-row-link" onClick={()=>onSelect(r)}>{c.render?c.render(r):label(r[c.key])}<ChevronRight size={13}/></button> : c.render?c.render(r):typeof r[c.key]==='number'?n(r[c.key]):label(r[c.key])}</td>)}</tr>)}</tbody></table>{!rows.length&&<div className="analytics-empty">No activity in this selection yet.</div>}</div>;
}
const col = (key:string,title:string,render?: (r:Row)=>any)=>({key,title,render});

export function AdminAnalytics() {
 const { isAdmin, adminChecked, loading: authLoading } = useAuth();
 return <AnalyticsDashboard isAdmin={isAdmin} adminChecked={adminChecked} authLoading={authLoading} />;
}

export function AnalyticsDashboard({ isAdmin, adminChecked, authLoading }: { isAdmin: boolean; adminChecked: boolean; authLoading: boolean }) {
 const [tab,setTab]=useState<Tab>('Overview');
 const [days,setDays]=useState(30); const [platform,setPlatform]=useState('');
 const [report,setReport]=useState<Report|null>(null); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [refresh,setRefresh]=useState(0);
 const [filter,setFilter]=useState(''); const [actor,setActor]=useState(''); const [timeline,setTimeline]=useState<Row[]>([]); const [timelineError,setTimelineError]=useState(''); const [timelineBusy,setTimelineBusy]=useState(false); const [more,setMore]=useState(false);
 const [restaurantSort,setRestaurantSort]=useState('opens');
 const actorRef=useRef(actor); actorRef.current=actor;
 useEffect(()=>{
  if(!actor)return;
  const listener=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){setActor('');return;}
   if(e.key!=='Tab')return;
   const controls=Array.from(document.querySelectorAll<HTMLElement>('.analytics-modal button:not(:disabled), .analytics-modal a, .analytics-modal input'));
   const first=controls[0],last=controls.at(-1);
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  };
  document.addEventListener('keydown',listener);return()=>document.removeEventListener('keydown',listener);
 },[actor]);
 useEffect(()=>{
  if (!isAdmin) return;
  let cancelled=false; setBusy(true); setError('');
  Promise.resolve(supabase.rpc('analytics_report', { days, platform_filter:platform||null, restaurant_sort:restaurantSort })).then(({data,error})=>{if(cancelled)return;setBusy(false); if(error){setError(error.message);setReport(null);} else setReport(data as Report);}).catch(()=>{if(!cancelled){setBusy(false);setReport(null);setError('Connection interrupted. Try refreshing.');}});
  return ()=>{cancelled=true;};
 },[isAdmin,days,platform,refresh,restaurantSort]);
 useEffect(()=>{setFilter('');},[tab]);
 useEffect(()=>{
  if(!actor||!isAdmin)return;
  let cancel=false; setTimeline([]);setTimelineBusy(true);setTimelineError('');
  Promise.resolve(supabase.rpc('analytics_user_activity',{actor_id:actor})).then(({data,error})=>{if(cancel)return;setTimelineBusy(false);if(error)setTimelineError(error.message);else{setTimeline(data||[]);setMore(data?.length===100);}}).catch(()=>{if(!cancel){setTimelineBusy(false);setTimelineError('Connection interrupted. Close and reopen this visitor.');}});
  return()=>{cancel=true;};
 },[actor,isAdmin]);
 async function loadMore(){
  if(!timeline.length||timelineBusy)return;
  const last=timeline.at(-1)!;const requested=actor;setTimelineBusy(true);
  const {data,error}=await supabase.rpc('analytics_user_activity',{actor_id:actor,before_time:last.created_at,before_id:last.id});
  if(requested!==actorRef.current)return;setTimelineBusy(false);if(error)setTimelineError(error.message);else{setTimeline(t=>[...t,...(data||[])]);setMore(data?.length===100);}
 }
 if(authLoading||!adminChecked) return <div className="analytics-loading">Checking access…</div>;
 if(!isAdmin) return <div className="analytics-loading">Page not found. <Link to="/">Go home</Link></div>;
 const o=report?.overview||{};
 const selected:Row[]=report?.[({Pages:'pages',Features:'features',Restaurants:'restaurants',APIs:'apis',Users:'users',Search:'searches',Outcomes:'outcomes'} as any)[tab]]||[];
 const withCatalog = tab==='Features' ? [...selected, ...FEATURE_CATALOG.filter(f=>!selected.some(r=>r.feature===f)).map(feature=>({feature,exposed_users:0,users:0,uses:0,exposures:0}))] : selected;
 const rows=withCatalog.filter(r=>JSON.stringify(r).toLowerCase().includes(filter.toLowerCase()));
 const stats=[['Active users',n(o.active_users),Users,'Unique visitors in this period'],['Sessions',n(o.sessions),Activity,'A new session after 30 minutes idle'],['Restaurant saves',n(o.saves),MapPin,'Save actions recorded in the app'],['API requests',n(o.api_calls),Zap,'Client requests + server upstream calls'],['Estimated API cost',money(o.estimated_cost),BarChart3,`${n(o.unpriced_calls)} calls without a configured rate`]];
 return <div className="analytics-page" data-analytics-private>
  <header className="analytics-header"><div><Link to="/settings" className="analytics-back"><ArrowLeft size={15}/> Settings</Link><p className="analytics-eyebrow">GOODEATS / OWNER WORKSPACE</p><h1>Understand your app.</h1><p className="analytics-subtitle">People, restaurants, and the requests behind every visit.</p></div><div className="analytics-status"><span/> Private analytics</div></header>
  <div className="analytics-toolbar"><div className="analytics-filters"><select aria-label="Date range" value={days} onChange={e=>setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select><select aria-label="Platform" value={platform} onChange={e=>setPlatform(e.target.value)}><option value="">All platforms</option><option value="web">Web</option><option value="ios">iOS</option><option value="server">Server</option></select></div><button onClick={()=>setRefresh(x=>x+1)} disabled={busy}><RefreshCw size={15} className={busy?'analytics-spin':''}/>{busy?'Updating…':'Refresh'}</button></div>
  {!analyticsEnabled&&<div className="analytics-notice">Collection is disabled in this build. Set VITE_ANALYTICS_ENABLED=true and rebuild after applying the database migration.</div>}
  {error&&<div role="alert" className="analytics-notice analytics-error"><strong>Analytics could not load.</strong><p>{error}</p><p>Apply the owner_analytics migration to this app’s Supabase project and confirm your account is in app_admins.</p></div>}
  <nav className="analytics-tabs" aria-label="Analytics views">{tabs.map(t=><button key={t} aria-current={tab===t?'page':undefined} onClick={()=>setTab(t)}>{t}</button>)}</nav>
  {!report&&!error&&<div className="analytics-empty">{busy?'Loading your analytics…':'No report loaded.'}</div>}
  {report&&<>
   {tab==='Overview'?<>
    <div className="analytics-stats">{stats.map(([title,value,Icon,note]:any)=><article key={title}><div><span>{title}</span><Icon size={17}/></div><strong>{value}</strong><p>{note}</p></article>)}</div>
    <div className="analytics-grid"><section className="analytics-card"><div className="analytics-section-title"><h2>Activity over time</h2><span>Daily visitors · UTC</span></div>{report.daily.length?<div className="analytics-chart"><ResponsiveContainer width="100%" height={250}><AreaChart data={report.daily}><defs><linearGradient id="analytics-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#568268" stopOpacity={.3}/><stop offset="100%" stopColor="#568268" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="day" tickFormatter={v=>v.slice(5)} tick={{fontSize:11}}/><YAxis allowDecimals={false} tick={{fontSize:11}}/><Tooltip/><Area type="monotone" dataKey="users" stroke="#568268" fill="url(#analytics-fill)" strokeWidth={2}/></AreaChart></ResponsiveContainer></div>:<div className="analytics-empty">Charts appear as people start using the app.</div>}</section>
    <section className="analytics-card"><h2>Signals to watch</h2><div className="analytics-signals"><p><strong>{pct(o.api_failures,o.api_calls)}</strong><span>API failure rate</span></p><p><strong>{n(o.errors)}</strong><span>App errors</span></p><p><strong>{o.active_users && o.estimated_cost != null ? money(o.estimated_cost/o.active_users) : '—'}</strong><span>Priced API cost / active user</span></p><p><strong>{n(o.cache_hits)}</strong><span>Details served from memory cache</span></p><p><strong>{duration(report.session_quality?.median_active_ms)}</strong><span>Median active time per session</span></p></div>{o.unpriced_calls>0&&<p className="analytics-footnote">Add provider rates in analytics_rates to estimate spending. Unpriced calls are excluded from cost totals.</p>}</section></div>
    <div className="analytics-grid"><section className="analytics-card"><h2>Returning users</h2><p className="analytics-footnote">New visitor cohorts in this period; only visitors old enough to complete each return window count.</p><Table rows={report.retention} columns={[col('day','Return window',r=>`Day ${r.day}`),col('eligible','Eligible'),col('returned','Returned'),col('rate','Return rate',r=>pct(r.returned,r.eligible))]}/></section><section className="analytics-card"><h2>Common journeys</h2><Table rows={report.paths} columns={[col('source','From'),col('destination','To'),col('transitions','Transitions')]}/></section></div>
   </>:<section className="analytics-card">
    <div className="analytics-section-title"><div><h2>{tab==='APIs'?'API usage & performance':tab}</h2><p className="analytics-footnote">{tab==='Restaurants'?'Ranked across the full period; showing up to 250 restaurants. “Search selections” counts restaurants opened from search.':tab==='Users'?'200 most recently active visitors. Select a visitor to inspect their event timeline.':tab==='Features'?'Exposures measure visible entry controls. Usage includes entry interactions and recorded feature actions; direct access can have no observed exposure.':tab==='APIs'?'Client and server records are separate network hops. Provider cost estimates exclude unconfigured rates. Up to 250 groups.':tab==='Search'?'Completed user searches, separate from background API lookups. Search text is optional.':tab==='Pages'?'Active time pauses in the background and after 60 seconds without interaction.': 'Event counts are not ordered conversion funnels. Use PostHog for ordered funnels.'}</p></div><button onClick={()=>csv(rows,`goodeats-${tab.toLowerCase()}.csv`)} disabled={!rows.length}><Download size={15}/> Export CSV</button></div>
    <div className="analytics-search"><Search size={16}/><input aria-label={`Filter ${tab}`} placeholder={`Filter ${tab.toLowerCase()}…`} value={filter} onChange={e=>setFilter(e.target.value)}/>{tab==='Restaurants'&&<select aria-label="Rank restaurants by" value={restaurantSort} onChange={e=>setRestaurantSort(e.target.value)}>{[['opens','Detail visits'],['searches','Search selections'],['returned','Returned'],['seen','Visible impressions'],['saves','Saves'],['api_calls','API calls']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>}</div>
    {tab==='Pages'&&<Table rows={rows} columns={[col('page','Page'),col('views','Visits'),col('users','Visitors'),col('active_ms','Active time',r=>duration(r.active_ms)),col('avg','Time / visit',r=>r.views?duration(r.active_ms/r.views):'—')]}/>}
    {tab==='Features'&&<Table rows={rows} columns={[col('feature','Feature'),col('exposed_users','People exposed'),col('users','People using'),col('uses','Interactions'),col('exposures','Control impressions')]}/>}
    {tab==='Restaurants'&&<Table rows={rows} columns={[col('name','Restaurant',r=><Link to={`/restaurant/${encodeURIComponent(r.restaurant_id)}`}>{r.name||r.restaurant_id} <ArrowUpRight size={12}/></Link>),col('searches','Search selections'),col('returned','Returned'),col('seen','Seen'),col('opens','Detail visits'),col('visitors','Visitors'),col('saves','Saves'),col('ratings','Ratings'),col('shares','Shares'),col('outbound','Outbound taps'),col('api_calls','API calls'),col('cost','Est. cost',r=>money(r.cost))]}/>}
    {tab==='APIs'&&<Table rows={rows} columns={[col('provider','Provider'),col('endpoint','Endpoint'),col('source','Triggered by'),col('origin','Measured at'),col('app_version','Version'),col('calls','Calls'),col('failures','Failures'),col('avg_ms','Avg. latency',r=>`${n(r.avg_ms)}ms`),col('p95_ms','P95',r=>`${n(r.p95_ms)}ms`),col('cost','Est. cost',r=>money(r.cost)),col('unpriced','Unpriced')]}/>}
    {tab==='Users'&&<Table rows={rows} onSelect={r=>setActor(r.actor)} columns={[col('actor','Visitor',r=>r.username ? `@${r.username}` : r.display_name || `${r.user_id?'Account':'Guest'} · ${r.actor.slice(0,12)}`),col('last_seen','Last seen',r=>new Date(r.last_seen).toLocaleString()),col('sessions','Sessions'),col('views','Pages'),col('saves','Saves'),col('calls','API calls'),col('cost','Est. cost',r=>money(r.cost))]}/>}
    {tab==='Search'&&<><Table rows={rows} columns={[col('query','Search'),col('searches','Searches'),col('empty','No results'),col('avg_results','Avg. results')]}/><h2 className="analytics-spaced">Coverage gaps</h2><Table rows={report.coverage} columns={[col('city','City'),col('cuisine','Cuisine'),col('searches','Searches'),col('empty','No results')]}/></>}
    {tab==='Outcomes'&&<Table rows={rows} columns={[col('event','Event'),col('detail','Outcome / step'),col('count','Events'),col('users','People')]}/>}
   </section>}
   <p className="analytics-footnote analytics-footer">Updated {new Date(report.generated_at).toLocaleString()} · Activity starts when collection is enabled. Client telemetry is best effort and may be blocked or offline. Client admin activity is excluded by default. Estimates are not invoices.</p>
  </>}
  {actor&&<div className="analytics-modal-backdrop" onClick={()=>setActor('')}><section role="dialog" aria-modal="true" aria-label="Visitor activity" className="analytics-modal" onClick={e=>e.stopPropagation()}><div className="analytics-section-title"><div><h2>Visitor activity</h2><code>{actor}</code></div><button autoFocus onClick={()=>setActor('')}>Close</button></div><p className="analytics-footnote">Most recent events first · No private messages or request bodies are collected.</p>{timelineError&&<p role="alert">{timelineError}</p>}<Table rows={timeline} columns={[col('created_at','When',r=>new Date(r.created_at).toLocaleString()),col('event','Action'),col('page','Page'),col('restaurant_name','Restaurant',r=>r.restaurant_name||r.restaurant_id||'—'),col('properties','Details',r=>Object.entries(r.properties||{}).map(([k,v])=>`${label(k)}: ${v}`).join(' · '))]}/><div className="analytics-modal-actions"><button onClick={()=>csv(timeline,'goodeats-visitor-activity.csv')} disabled={!timeline.length}><Download size={15}/>Export loaded events</button>{more&&<button onClick={()=>void loadMore()} disabled={timelineBusy}>{timelineBusy?'Loading…':'Load older activity'}</button>}</div></section></div>}
 </div>;
}
