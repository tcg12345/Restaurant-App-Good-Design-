import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { useGlassOccluder } from '../lib/glass-buttons';
import { PRIVACY_URL, openExternalUrl } from '../lib/external-links';
import { COMMUNITY_CONTENT_CHANGED, SCREENING_CONSENT_VERSION, remembersScreeningConsent, rememberScreeningConsent } from '../lib/community-screening';
import type { SafetyTarget } from '../lib/community-safety';
import './Safety.css';

type Row = { kind:string;content_id:string;revision:string;status:'pending'|'rejected';screening_state:string;post_id?:string };
const key=(row:{kind:string;content_id:string})=>`${row.kind}:${row.content_id}`;
const StatusContext = createContext<{userId:string;rows:Map<string,Row>;request:(rows:Row[])=>void}>({userId:'',rows:new Map(),request:()=>{}});
export function ModerationStatusProvider({ children }: { children: React.ReactNode }) {
 const {user}=useAuth();const location=useLocation();
 const [state,setState]=useState({userId:'',rows:new Map<string,Row>()});
 const [prompt,setPrompt]=useState<{userId:string;rows:Row[]}|null>(null);const [remember,setRemember]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const generation=useRef(0), currentUser=useRef(user?.id), offered=useRef(new Set<string>()),activeSharing=useRef(new Set<string>()),timer=useRef<number|undefined>(undefined);
 currentUser.current=user?.id;
 const dialog=useRef<HTMLDialogElement>(null);const occluder=useGlassOccluder();
 const enqueue=useCallback(async(rows:Row[],userId:string)=>{
  for(const row of rows){if(currentUser.current!==userId)return;const {error}=await supabase.rpc('request_content_screening',{p_kind:row.kind,p_id:row.content_id,p_revision:row.revision,p_consent_version:SCREENING_CONSENT_VERSION});if(error)throw error;}
 },[]);
 const refresh=useCallback(async(offer=false)=>{
  const request=++generation.current;const userId=user?.id;
  if(!userId){setState({userId:'',rows:new Map()});return;}
  const {data,error}=await supabase.from('content_moderation').select('kind,content_id,revision,status,screening_state,post_id:snapshot->>post_id').eq('user_id',userId).in('status',['pending','rejected']).limit(1000);
  if(request!==generation.current||currentUser.current!==userId||error)return;
  const rows=new Map<string,Row>();const raw=(data||[]) as Row[];
  for(const row of raw)rows.set(key(row),row);
  setState({userId,rows});
  if(offer||remembersScreeningConsent(userId)){const candidates=raw.filter(row=>(offer||activeSharing.current.has(key(row)))&&row.status==='pending'&&row.screening_state==='awaiting_consent'&&!offered.current.has(row.revision));
   if(candidates.length){candidates.forEach(row=>{offered.current.add(row.revision);activeSharing.current.add(key(row));});
    if(remembersScreeningConsent(userId))void enqueue(candidates,userId).then(()=>refresh(false)).catch(()=>setError('Automatic checks could not start. You can retry from the item.'));
    else setPrompt(previous=>previous?.userId===userId?{userId,rows:[...previous.rows,...candidates]}:{userId,rows:candidates});
   }
  }
 },[user?.id,enqueue]);
 useEffect(()=>{offered.current.clear();activeSharing.current.clear();setPrompt(null);setError('');return()=>{++generation.current;};},[user?.id]);
 useEffect(()=>{void refresh();const focus=()=>{if(document.visibilityState!=='hidden')void refresh();};window.addEventListener('focus',focus);return()=>{++generation.current;window.removeEventListener('focus',focus);};},[refresh,location.key]);
 useEffect(()=>{const changed=()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>void refresh(true),700);};window.addEventListener(COMMUNITY_CONTENT_CHANGED,changed);return()=>{window.clearTimeout(timer.current);window.removeEventListener(COMMUNITY_CONTENT_CHANGED,changed);};},[refresh]);
 useEffect(()=>{if(![...state.rows.values()].some(r=>r.screening_state==='queued'||r.screening_state==='running'))return;const timer=window.setInterval(()=>{if(document.visibilityState!=='hidden')void refresh();},5000);return()=>window.clearInterval(timer);},[state,refresh]);
 useEffect(()=>{if(prompt){setRemember(true);dialog.current?.showModal();}},[prompt?.userId]);
 const request=(rows:Row[])=>{rows.forEach(row=>activeSharing.current.add(key(row)));if(user)setPrompt({userId:user.id,rows});};
 const manual=async()=>{if(!prompt||prompt.userId!==user?.id||busy)return;setBusy(true);setError('');try{for(const row of prompt.rows){if(currentUser.current!==prompt.userId)return;const {error}=await supabase.rpc('request_manual_content_review',{p_kind:row.kind,p_id:row.content_id,p_revision:row.revision});if(error)throw error;}setPrompt(null);void refresh();}catch{setError('Could not save your choice. Please try again.');}finally{setBusy(false);}};
 const allow=async()=>{if(!prompt||prompt.userId!==user?.id||busy)return;setBusy(true);setError('');try{await enqueue(prompt.rows,prompt.userId);if(currentUser.current!==prompt.userId)return;rememberScreeningConsent(prompt.userId,remember);setPrompt(null);void refresh();}catch{setError('Could not start safety checks. Please try again.');}finally{setBusy(false);}};
 return <StatusContext.Provider value={{...state,request}}>{children}
 {prompt&&prompt.userId===user?.id&&<dialog ref={node=>{dialog.current=node;occluder(node);}} className="safety-dialog" aria-labelledby="screening-title" onCancel={e=>{e.preventDefault();if(!busy)setPrompt(null);}} data-analytics-private>
  <h2 id="screening-title">Before you share</h2>
  <p>Allow <strong>OpenAI</strong> to check the text and photos you’re sharing, or sampled frames from your video, for harmful content? This can include your public profile details and information visible in your uploads.</p>
  <p>Content that passes is shared automatically. Flagged or unsupported content goes to the GoodEats moderation team. If you decline, it stays visible only to you while awaiting manual review.</p>
  <label className="screening-remember"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/> Use automatic checks for future sharing on this device</label>
  <p>You can turn this off in Privacy &amp; permissions. Only share content you have permission to send.</p>
  <button className="safety-link" onClick={()=>void openExternalUrl(PRIVACY_URL)}>Read the privacy policy</button>
  {error&&<p role="alert" className="safety-error">{error}</p>}
  <div className="safety-actions"><button disabled={busy} onClick={()=>void manual()}>Manual review</button><button disabled={busy} className="safety-primary" onClick={()=>void allow()}>{busy?'Starting…':'Allow and share'}</button></div>
 </dialog>}
 </StatusContext.Provider>;
}
export function ModerationStatus({target}:{target:SafetyTarget}) {
 const {user}=useAuth();const {userId,rows,request}=useContext(StatusContext);
 if(!user||user.id!==target.authorId||userId!==user.id)return null;
 const related=[...rows.values()].filter(row=>key(row)===`${target.kind}:${target.id}`||(target.kind==='posts'&&row.kind==='post_items'&&row.post_id===target.id));
 const row=related.find(r=>r.status==='rejected')||related.find(r=>r.screening_state==='awaiting_consent')||related.find(r=>r.screening_state==='manual')||related[0];if(!row)return null;
 const waiting=row.status==='pending'&&row.screening_state==='awaiting_consent';
 const label=row.status==='rejected'?'Not shared':waiting?'Safety check needed':row.screening_state==='manual'?'Under review':'Checking…';
 return waiting?<button type="button" className="safety-status" onClick={e=>{e.stopPropagation();e.preventDefault();request(related.filter(r=>r.status==='pending'&&r.screening_state==='awaiting_consent'));}}>{label}</button>:<span className="safety-status" role="status" title={row.status==='rejected'?'Contact support to appeal.':'Only you can see this until review is complete.'}>{label}</span>;
}
