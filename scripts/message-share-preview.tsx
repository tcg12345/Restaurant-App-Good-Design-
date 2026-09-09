import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ShareSheet } from '../src/components/messages/ShareSheet';
import '../src/index.css';
function Preview() {
 const [open, setOpen] = useState(true), [sent, setSent] = useState('');
 return <div style={{minHeight:'100dvh',padding:24,background:'var(--color-surface)'}}>
  <button onClick={()=>setOpen(true)}>Open preview</button>
  <p>{sent}</p>
  <ShareSheet open={open} recipientName="Alex" selfName="You" onClose={()=>setOpen(false)} onShareRestaurant={r=>setSent(`Preview only: ${r.name}`)} onShareRecipe={r=>setSent(`Preview only: ${r.name}`)} />
 </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
