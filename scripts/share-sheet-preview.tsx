/** Isolated presentation fixture. Sharing buttons never send or copy anything. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence } from 'motion/react';
import { ShareDialogSurface } from '../src/components/ShareDialogSurface';
import { MapPin, Link2, Share2, MessageCircle, Mail, Sparkles, ListPlus } from 'lucide-react';
import '../src/index.css';
const targets=['Jack Sanders','Jen Ellis','Jenifer Gorin','Zach Andrews','Sam Taylor'].map((name,i)=>({kind:'friend' as const,key:String(i),friendId:String(i),name,initials:name.split(' ').map(n=>n[0]).join(''),avatarColor:''}));
function Preview(){
 const [open,setOpen]=useState(false),[dark,setDark]=useState(false),[selected,setSelected]=useState(new Set<string>()),[search,setSearch]=useState(''),[message,setMessage]=useState('');
 const actions=[['copy','Copy link',Link2],['more','Share…',Share2],['message','Message',MessageCircle],['email','Email',Mail],['ai','Ask AI',Sparkles],['list','Add to list',ListPlus]].map(([key,label,Icon]:any)=>({key,label,icon:<Icon size={19}/>,onClick:()=>{}}));
 return <div style={{minHeight:'100dvh',background:'var(--color-surface)'}}><img src="/images/onboarding/contemporary-dining.jpg" style={{width:'100%',height:300,objectFit:'cover'}}/><div style={{padding:24}}><h1>Kalaya</h1><p>Thai · Philadelphia</p><button style={{padding:20}} onClick={()=>setOpen(true)}>Open share sheet</button><button style={{padding:20}} onClick={()=>{document.documentElement.classList.toggle('dark',!dark);setDark(!dark)}}>{dark?'Light mode':'Dark mode'}</button></div>
 <AnimatePresence>{open&&<ShareDialogSurface phoneMode={false} header={{title:'Kalaya',subtitle:'Thai · $$$ · 9.9 / 10',cover:null,icon:<MapPin/>}} targets={targets.filter(t=>t.name.toLowerCase().includes(search.toLowerCase()))} hasTargets search={search} onSearch={setSearch} selected={selected} onToggle={key=>setSelected(prev=>{const next=new Set(prev);next.has(key)?next.delete(key):next.add(key);return next})} message={message} onMessage={setMessage} phase="idle" onSend={()=>{}} onClose={()=>setOpen(false)} actions={actions}/>}</AnimatePresence></div>
}
createRoot(document.getElementById('root')!).render(<Preview/>);
