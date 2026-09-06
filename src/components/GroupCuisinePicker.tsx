import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { searchCuisines, SUGGESTABLE_CUISINES } from '../lib/cuisine';
import { homeHaptic } from '../lib/haptics';

const cuisines = SUGGESTABLE_CUISINES.filter(c => c.length <= 40);

export function GroupCuisinePicker({ selected, onChange }: { selected: string[]; onChange: (values: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else if (dialog.current?.open) { dialog.current.close(); trigger.current?.focus(); }
  }, [open]);
  const results = searchCuisines(query, cuisines);
  return <>
    <button ref={trigger} className="gs-cuisine-trigger" aria-haspopup="dialog" aria-expanded={open} aria-label="Choose cuisines" onClick={() => { setQuery(''); setOpen(true); homeHaptic(); }}>
      <span>{selected.length ? selected.join(', ') : 'Any cuisine'}</span>
      {selected.length > 0 && <small>{selected.length}</small>}<ChevronDown size={17} />
    </button>
    <dialog ref={dialog} className="gs-cuisine-dialog" aria-labelledby="gs-cuisine-title" onCancel={() => setOpen(false)} onClick={e => { if (e.target === dialog.current) setOpen(false); }}>
      <section className="gs-cuisine-sheet">
        <header><h2 id="gs-cuisine-title">Cuisines</h2><button className="gs-glass" aria-label="Close cuisines" onClick={() => setOpen(false)}><X size={18} /></button></header>
        <div className="gs-cuisine-search"><Search size={17} /><input aria-label="Search cuisines" placeholder="Search cuisines" value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="Clear cuisine search" onClick={() => setQuery('')}><X size={15} /></button>}</div>
        <div className="gs-cuisine-selection"><span>{selected.length ? `${selected.length} of 6 selected` : 'Choose up to 6'}</span>{selected.length > 0 && <button onClick={() => onChange([])}>Clear all</button>}</div>
        <div className="gs-cuisine-results">
          {results.map(cuisine => <button key={cuisine} aria-pressed={selected.includes(cuisine)} disabled={selected.length >= 6 && !selected.includes(cuisine)} onClick={() => { homeHaptic(); onChange(selected.includes(cuisine) ? selected.filter(c => c !== cuisine) : [...selected, cuisine]); }}><span>{cuisine}</span>{selected.includes(cuisine) && <Check size={18} />}</button>)}
          {!results.length && <p>No matching cuisines.</p>}
        </div>
        <footer><button className="gs-primary" onClick={() => setOpen(false)}>Done{selected.length > 0 ? ` · ${selected.length}` : ''}</button></footer>
      </section>
    </dialog>
  </>;
}
