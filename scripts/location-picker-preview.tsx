import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HomeLocationBar } from '../src/components/HomeLocationBar';
import '../src/index.css';
function Preview() {
 const [open,setOpen]=useState(true), [dark,setDark]=useState(false);
 return <main style={{minHeight:'100vh',background:'var(--color-surface)',padding:24}}><button onClick={()=>setOpen(true)}>Choose location</button><button onClick={()=>{setDark(!dark);document.documentElement.classList.toggle('dark',!dark);}}>Toggle appearance</button><HomeLocationBar variant="headless" open={open} onOpenChange={setOpen} location={{label:'New York, NY',lat:40.7128,lng:-74.006}} onChange={()=>{}} onUseCurrent={async()=>{}} /></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
