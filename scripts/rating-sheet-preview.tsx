/** Actual shared editor with a local, in-memory rating. Never writes account data. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RatingFlowSheet } from '../src/components/RatingFlow';
import '../src/index.css';
const rating = {restaurantId:'preview',name:'Kalaya',cuisine:'Thai',price:'$$$',address:'4 W Palmer St',score:8.8,notes:'A wonderful dinner. Come back for the dumplings.',favoriteDishes:['Dumplings'],visitDate:'2026-08-15',wouldReturn:true,tags:[],photos:[],listIds:[],friendIds:[],createdAt:0,image:''};
function Preview() {
 const [page,setPage]=useState<string | null>(null),[open,setOpen]=useState(false);
 const [saved,setSaved]=useState(rating);
 const launch=(target:string)=>{setPage(target);setOpen(true)};
 return <div style={{minHeight:1600,padding:'80px 24px',background:'var(--color-surface)'}}><h1>Kalaya</h1><p>Restaurant details</p><div style={{display:'flex',flexWrap:'wrap',gap:15,marginTop:30}}>{['edit','notes','photos','new-visit'].map(p=><button key={p} onClick={()=>launch(p)} style={{padding:18,background:'var(--color-muted)',borderRadius:15}}>{p}</button>)}</div><p style={{marginTop:40}}>Saved notes: {saved.notes}</p>
 <RatingFlowSheet state={{addRestaurantModalOpen:open,addRestaurantModalMeta:{...rating,id:rating.restaurantId},addRestaurantModalInitialPage:page,closeAddRestaurantModal:()=>setOpen(false),getRating:()=>saved,ratings:[saved],getRestaurantInfo:()=>rating,scoresUnlocked:true,removeRating:()=>{},rateRestaurant:async (r:any)=>setSaved({...saved,...r})} as any}/></div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
