import { useAuth } from '../../contexts/AuthContext';
import { rememberScreeningConsent } from '../../lib/community-screening';
import React,{useEffect,useState} from 'react';
import {supabase} from '../../lib/supabase';
import {setUserBlock,safetyError} from '../../lib/community-safety';
export function SafetySettings(){
 const {user}=useAuth(); const [reset,setReset]=useState(false);
 const [blocks,setBlocks]=useState<Array<{user_id:string;display_name:string;username:string}>>([]);const [error,setError]=useState('');const [busy,setBusy]=useState('');
 useEffect(()=>{let live=true;void supabase.rpc('my_blocked_accounts').then(({data,error})=>{if(!live)return;if(error)setError(safetyError(error));else setBlocks(data||[]);});return()=>{live=false;};},[]);
 return <section className="safety-settings"><h3>Blocked accounts</h3><p>Manage accounts you’ve blocked. To report content, use its three-dot menu.</p>{blocks.length?blocks.map(b=><div key={b.user_id}><span>{b.display_name||b.username}</span><button disabled={!!busy} onClick={async()=>{setBusy(b.user_id);try{await setUserBlock(b.user_id,false);setBlocks(rows=>rows.filter(r=>r.user_id!==b.user_id));}catch(e){setError(safetyError(e));}finally{setBusy('');}}}>{busy===b.user_id?'Saving…':'Unblock'}</button></div>):<p>No accounts blocked.</p>}{error&&<p role="alert" className="safety-error">{error}</p>}<h4>Automatic safety checks</h4><p>When you share content, you can allow OpenAI to screen it before publication.</p><button onClick={()=>{if(user)rememberScreeningConsent(user.id,false);setReset(true);}}>Ask before each safety check</button>{reset&&<p role="status">We’ll ask before sending future shared content for automatic checks. Checks already requested may finish.</p>}</section>;
}
