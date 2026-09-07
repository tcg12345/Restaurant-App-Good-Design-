/** Run with recipe-preview.vite.ts. All imports and generations use local stubs. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ImportRecipePanel } from '../src/components/ImportRecipePanel';
import { AiRecipeGenerator } from '../src/components/AiRecipeGenerator';
import '../src/index.css';
function Preview() {
 const [mode,setMode]=useState('link'),[dark,setDark]=useState(false);
 const nav=<select aria-label="Preview creation method" style={{maxWidth:145,fontSize:12,minHeight:44,background:'transparent'}} value={mode} onChange={e=>setMode(e.target.value)}>{['link','photo','text','recipe','ideas'].map(m=><option key={m}>{m}</option>)}</select>;
 return <><button style={{position:'fixed',right:74,top:3,fontSize:10,zIndex:1000}} onClick={()=>{document.documentElement.classList.toggle('dark',!dark);setDark(!dark)}}>{dark?'Light':'Dark'}</button><div style={{height:'100dvh',maxWidth:760,margin:'auto'}}>{['recipe','ideas'].includes(mode)?<AiRecipeGenerator key={mode} initialView={mode as any} tabSlot={nav} phoneMode onClose={()=>{}} onGenerated={()=>{}}/>:<ImportRecipePanel key={mode} initialTab={mode as any} tabSlot={nav} phoneMode onClose={()=>{}} onImported={()=>{}}/>}</div></>;
}
createRoot(document.getElementById('root')!).render(<MemoryRouter><Preview/></MemoryRouter>);
