/** Local visual fixture; no account data or requests. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FeedPost } from '../src/components/feed/FeedPost';
import '../src/index.css';
function Preview() {
 const [dark,setDark]=useState(false);
 const media = Array.from({length:5},(_,i)=>({id:String(i),url:i%2?'/images/onboarding/miso-salmon.jpg':'/images/onboarding/contemporary-dining.jpg',caption:['A seat at the table','Miso-glazed salmon','The dining room','Dinner favorites','One more look'][i]}));
 return <div style={{maxWidth:600,margin:'auto',background:'var(--color-surface)',minHeight:'100dvh',paddingBottom:80}}><button style={{padding:20}} onClick={()=>{document.documentElement.classList.toggle('dark',!dark);setDark(!dark)}}>{dark?'Light mode':'Dark mode'}</button>
 {[media,media.slice(0,1)].map((photos,i)=><FeedPost key={i} authorName="Alex Morgan" authorInitial="AM" avatarClass="bg-primary" kind="Dined" when="Yesterday · New York" media={photos} like={{count:12,liked:false,onToggle:()=>{}}} comment={{count:0,onOpen:()=>{}}} save={{saved:false,onToggle:()=>{}}} place={{name:'An evening worth sharing',meta:'Contemporary · New York',onOpen:()=>{}}} body="Good food, great company. A few favorites from last night."/>)}
 </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
