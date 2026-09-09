import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditPinsSheet, type PinCandidate } from '../src/components/profile/EditPinsSheet';
import '../src/index.css';
const candidates: PinCandidate[] = [
 { pin: {type:'restaurant',id:'1'},title:'Juniper House',subtitle:'Contemporary · 9.2',image:'/images/onboarding/contemporary-dining.jpg'},
 { pin: {type:'restaurant',id:'2'},title:'The Sunday Table',subtitle:'Italian · 8.7'},
 { pin: {type:'restaurant',id:'3'},title:'A very lovely place with a longer name',subtitle:'French · 9.4',image:'/images/onboarding/contemporary-dining.jpg'},
 { pin: {type:'meal',id:'4'},title:'Sunday tomato pasta',subtitle:'Italian · Recipe'},
 { pin: {type:'guide',id:'5'},title:'A weekend in New York',subtitle:'6 places · Guide'},
 { pin: {type:'post',id:'6'},title:'Dinner with friends',subtitle:'Post'},
 { pin: {type:'reel',id:'7'},title:'At the chef’s table',subtitle:'Reel'},
];
function Preview() {
 const [open,setOpen] = useState(true),[dark,setDark] = useState(false);
 return <div style={{minHeight:'100dvh',padding:24,background:'var(--color-surface)'}}>
  <button onClick={()=>setOpen(true)}>Edit pins preview</button>
  <button onClick={()=>{document.documentElement.classList.toggle('dark',!dark);setDark(!dark)}}>{dark?'Light':'Dark'} mode</button>
  <EditPinsSheet open={open} onClose={()=>setOpen(false)} candidates={candidates}/>
 </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
