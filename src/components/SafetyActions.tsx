import { ModerationStatus } from './ModerationStatus';
import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useGlassOccluder } from '../lib/glass-buttons';
import { REPORT_REASONS, reportContent, setUserBlock, safetyError, type SafetyTarget } from '../lib/community-safety';
import './Safety.css';
export function SafetyActions({target}: {target:SafetyTarget}) {
 const {user}=useAuth(); const {showToast}=useToast();
 const [mode,setMode]=useState<'menu'|'report'|'block'|null>(null); const [reason,setReason]=useState('harassment'); const [details,setDetails]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 const ref=useRef<HTMLDialogElement>(null); const occluder=useGlassOccluder();
 useEffect(()=>{if(!mode)return;const dialog=ref.current;dialog?.showModal();dialog?.querySelector<HTMLElement>('select,textarea,button')?.focus({preventScroll:true});},[mode]);
 const close=()=>{if(!busy){setMode(null);setError('');}};
 const submit=async()=>{if(busy)return;setBusy(true);setError('');try{
 if(mode==='block') {await setUserBlock(target.authorId,true);window.location.replace('/');return;}
 await reportContent(target,reason,details);setMode(null);setDetails('');showToast('Report sent. Thank you for helping keep GoodEats safe.');
 }catch(e){setError(safetyError(e));}finally{setBusy(false);}};
 if(!user)return null;
 if(user.id===target.authorId)return <ModerationStatus target={target}/>;
 return <><button type="button" className="safety-menu-button" aria-label="Report or block" onClick={e=>{e.stopPropagation();setMode('menu');}}><MoreHorizontal size={20}/></button>
 {mode&&<dialog ref={node=>{ref.current=node;occluder(node);}} className="safety-dialog" aria-label={mode==='menu'?'Content options':mode==='report'?'Report content':'Block account'} onClick={e=>e.stopPropagation()} onCancel={e=>{e.preventDefault();close();}} data-analytics-private>
 <h2>{mode==='menu'?'Content options':mode==='report'?'Report content':'Block this account?'}</h2>
 {mode==='menu'?<><div className="safety-actions"><button onClick={()=>setMode('report')}>Report content</button><button onClick={()=>setMode('block')}>Block account</button></div><button className="safety-link" onClick={close}>Cancel</button></>:<>
 {mode==='report'?<><p>Your report is shared only with the GoodEats moderation team.</p><label>Reason<select value={reason} onChange={e=>setReason(e.target.value)}>{Object.entries(REPORT_REASONS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Details (optional)<textarea rows={4} value={details} maxLength={2000} onChange={e=>setDetails(e.target.value)}/></label></>:<p>You’ll stop seeing each other’s content and won’t be able to follow or message each other. You can unblock them in Privacy & permissions. GoodEats will return to Home after blocking.</p>}
 {error&&<p role="alert" className="safety-error">{error}</p>}<div className="safety-actions"><button disabled={busy} onClick={close}>Cancel</button><button disabled={busy} className="safety-primary" onClick={()=>void submit()}>{busy?'Saving…':mode==='report'?'Send report':'Block account'}</button></div></>}
 </dialog>}</>;
}
