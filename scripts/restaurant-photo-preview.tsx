/** Isolated real-component preview. No accounts, API requests, or saved changes. */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RestaurantPhotoStage } from '../src/components/RestaurantPhotoStage';
import '../src/index.css';
import '../src/pages/RestaurantDetail.css';
import { ArrowLeft, Bookmark, Sparkles, Star } from 'lucide-react';
function Preview() {
 const [open,setOpen]=useState(false), [index,setIndex]=useState(0), [dark,setDark]=useState(false);
 useEffect(()=>{document.documentElement.classList.toggle('dark',dark)},[dark]);
 const photos=Array.from({length:18}, (_, i) => `${i % 2 ? '/images/onboarding/miso-salmon.jpg' : '/images/onboarding/contemporary-dining.jpg'}?preview=${i}`);
 return <div className="restaurant-detail restaurant-detail-mobile has-detail-photo" style={{background:'var(--color-cream)'}}>
 <div className="sticky top-0 z-50 h-0"><nav style={{position:'absolute',top:50,left:20,right:20,display:'flex',justifyContent:'space-between'}}><button aria-label="Preview back"><ArrowLeft/></button><button onClick={()=>setDark(!dark)}>{dark?'Light':'Dark'}</button><button aria-label="Preview save"><Bookmark/></button></nav></div>
 <RestaurantPhotoStage name="A seat at the table" photos={photos} communityPhotos={[{url:photos[1],rawUrl:photos[1],caption:'Miso-glazed salmon',user_id:'preview'} as any]} index={index} onIndexChange={setIndex} open={open} onOpenChange={setOpen} onRecreate={()=>{}}>
 <main className="restaurant-body" style={{padding:'4px 22px 45px'}}>
 <section className="restaurant-identity"><p style={{fontSize:13,opacity:.5}}>Contemporary · $$$</p><h1 style={{margin:'12px 0 22px'}}>A seat at the table</h1><p style={{fontSize:14,lineHeight:1.8}}>Open · until 10 PM<br/><span style={{opacity:.6}}>New York, NY</span></p></section>
 <div style={{display:'flex',gap:8,margin:'20px 0 30px'}}>{['Call','Route','Website'].map(t=><button key={t} style={{flex:1,padding:14,borderRadius:15,background:'var(--color-muted)'}}>{t}</button>)}</div>
 <h2 style={{fontSize:18,fontWeight:600}}>Ratings</h2><div style={{display:'flex',justifyContent:'space-around',padding:'26px 0'}}>{['8.8','9.1','8.6'].map((n,i)=><div key={n} style={{textAlign:'center'}}><div style={{fontSize:27,border:'1px solid var(--color-score-high)',color:'var(--color-score-high-ink)',borderRadius:'50%',padding:15}}>{n}</div><small>{['Everyone','Friends','Experts'][i]}</small></div>)}</div>
 <hr style={{opacity:.1,margin:'20px 0'}}/><h2>Your visit</h2><p style={{fontSize:14,opacity:.6,padding:'15px 0 40px'}}>Every good meal has a story.</p><button style={{background:'var(--color-primary)',color:'var(--color-on-primary)',padding:16,borderRadius:18,width:'100%'}}>Rate a visit <Star size={14} style={{display:'inline'}}/></button>
 <section style={{minHeight:600,paddingTop:45}}><h2>From your circle</h2><p style={{paddingTop:20,opacity:.6}}>Scroll normally here. The card yields to a downward pull only when you begin at the top.</p></section>
 </main></RestaurantPhotoStage>
 </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
