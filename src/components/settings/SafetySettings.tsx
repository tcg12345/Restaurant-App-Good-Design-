import React,{useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {supabase} from '../../lib/supabase';
import {setUserBlock,safetyError} from '../../lib/community-safety';
export function SafetySettings(){
 const [blocks,setBlocks]=useState<Array<{user_id:string;display_name:string;username:string}>>([]);const [error,setError]=useState('');const [busy,setBusy]=useState('');
 useEffect(()=>{let live=true;void supabase.rpc('my_blocked_accounts').then(({data,error})=>{if(!live)return;if(error)setError(safetyError(error));else setBlocks(data||[]);});return()=>{live=false;};},[]);
 return <section className="safety-settings"><h3>Community safety</h3><p>New shared content and edits are reviewed before others can see them. Your personal saved data stays available to you.</p><Link to="/settings/publications">View your publication status</Link><h4>Blocked accounts</h4>{blocks.length?blocks.map(b=><div key={b.user_id}><span>{b.display_name||b.username}</span><button disabled={!!busy} onClick={async()=>{setBusy(b.user_id);try{await setUserBlock(b.user_id,false);setBlocks(rows=>rows.filter(r=>r.user_id!==b.user_id));}catch(e){setError(safetyError(e));}finally{setBusy('');}}}>{busy===b.user_id?'Saving…':'Unblock'}</button></div>):<p>No accounts blocked.</p>}{error&&<p role="alert" className="safety-error">{error}</p>}</section>;
}
