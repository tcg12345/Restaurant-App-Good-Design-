/** Local visual fixture; does not fetch or change account data. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GuideReaderEntry } from '../src/components/guide/GuideReader';
import { DEFAULT_THEME, type Guide, type GuideEntry } from '../src/lib/supabase-guides';
import '../src/index.css';
const entries: GuideEntry[] = [
 { id: '1', refId: '1', name: 'COTE Flatiron', subtitle: 'Korean · $$$$ · Flatiron', image: '/images/onboarding/contemporary-dining.jpg', photos: ['/images/onboarding/contemporary-dining.jpg', '/images/onboarding/miso-salmon.jpg', '/images/onboarding/contemporary-dining.jpg?photo=3', '/images/onboarding/miso-salmon.jpg?photo=4'], hours: 'Mon–Fri 5–10 PM', score: 9.5, notes: 'A lively room, beautifully considered dishes, and the kind of dinner you keep talking about on the way home. Come with a few friends, take your time, and let the table share a little of everything.', mustOrder: ['Butcher’s Feast', 'Seasonal vegetables'], insiderTip: 'Book an early table for a quieter evening.' },
 { id: '2', refId: '2', name: 'Jungsik', subtitle: 'Korean · $$$$ · TriBeCa', image: '', score: 9.8, notes: 'Thoughtful, precise, and full of little surprises. A lovely choice for a celebration.' },
 { id: '3', refId: '3', name: 'Crown Shy', subtitle: 'Contemporary American · $$$ · Financial District', image: '', score: 8.7 },
];
const guide = { id: 'preview', type: 'restaurants', includePhotos: true, entries } as Guide;
function Preview() {
 const [dark, setDark] = useState(false), [saved, setSaved] = useState<string[]>([]);
 return <div className="guide-reader"><div className="guide-reader-main">
 <button style={{minHeight:44,float:'right'}} onClick={() => { document.documentElement.classList.toggle('dark', !dark); setDark(!dark); }}>{dark ? 'Light mode' : 'Dark mode'}</button>
 <h1 style={{paddingTop:60,marginBottom:20}}>A few favorites.</h1>
 {entries.map((entry,index) => <GuideReaderEntry key={entry.id} entry={entry} index={index} guide={guide} theme={DEFAULT_THEME} actions={{onView:()=>{},onAdd:()=>{},onSave:e=>setSaved(saved.includes(e.id)?saved.filter(id=>id!==e.id):[...saved,e.id]),isSaved:e=>saved.includes(e.id)}}/>)}
 </div></div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
