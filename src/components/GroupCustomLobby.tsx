import React, { useEffect, useRef, useState } from 'react';
import { Check, ListPlus, Loader2, Plus, Search, Trash2, Users, X, ArrowUpRight } from 'lucide-react';
import { searchPlacesByText, type PlaceResult } from '../lib/places';
import { cuisineLabel } from '../lib/cuisine';
import { useMichelinMatch } from '../lib/useMichelinMatch';
import { MichelinBadge } from './MichelinBadge';
import type { GroupPlace, GroupRoom } from '../lib/group-swipe';
import './GroupCustomLobby.css';

export const GroupContributionPolicy: React.FC<{ value: boolean; onChange: (allow: boolean) => void; disabled?: boolean }> = ({ value, onChange, disabled }) => (
  <div className="gs-custom-policy" role="group" aria-label="Who can add restaurants">
    {[false, true].map(allow => <button type="button" key={String(allow)} disabled={disabled} aria-pressed={value === allow} onClick={() => onChange(allow)}>
      <span>{allow ? <Users size={19} /> : <ListPlus size={19} />}</span><span><strong>{allow ? 'Everyone can suggest' : 'Only me'}</strong><small>{allow ? 'Each guest can add up to 2 places.' : 'You choose the entire shortlist.'}</small></span><i>{value === allow && <Check size={17} />}</i>
    </button>)}
  </div>
);
const PlaceLabel: React.FC<{ place: { name: string; lat?: number; lng?: number; address: string; cuisine?: string } }> = ({ place }) => {
  const { michelin } = useMichelinMatch(place.name, place.lat, place.lng, place.address, place.cuisine || '', '');
  return <span className="gs-custom-place-label"><strong>{place.name}</strong><small>{place.address || 'Address unavailable'}</small>{michelin && <MichelinBadge michelin={michelin} />}</span>;
};

export const GroupRestaurantPicker: React.FC<{ room: GroupRoom; userId: string; busy: boolean; error?: string; onAdd: (id: string) => Promise<unknown>; onClose: () => void }> = ({ room, userId, busy, error, onAdd, onClose }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [adding, setAdding] = useState('');
  const live = useRef(true);
  useEffect(() => { live.current = true; dialog.current?.showModal(); return () => { live.current = false; dialog.current?.close(); }; }, []);
  useEffect(() => {
    const abort = new AbortController();
    setResults([]); setSearchError(false);
    if (query.trim().length < 2) { setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const places = await searchPlacesByText(query.trim(), room.location.lat, room.location.lng, room.location.label, false, undefined, abort.signal);
        if (!abort.signal.aborted) setResults(places.filter(p => p.types.some(t => t === 'restaurant' || t.endsWith('_restaurant') || t === 'cafe' || t === 'bakery')).slice(0, 15));
      } catch { if (!abort.signal.aborted) setSearchError(true); }
      finally { if (!abort.signal.aborted) setSearching(false); }
    }, 350);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, room.location.lat, room.location.lng, room.location.label]);
  const count = room.deck.filter(p => p.addedBy === userId).length;
  const full = room.deck.length >= 15 || (room.host !== userId && (!room.allowGuestAdds || count >= 2));
  return <dialog ref={dialog} className="gs-custom-picker" aria-labelledby="gs-custom-search-title" onCancel={onClose} onClick={e => { if (e.target === dialog.current) onClose(); }}>
    <section><header><div><h2 id="gs-custom-search-title">Add a restaurant</h2><p>{room.host === userId ? `${room.deck.length} of 15 places in your shortlist` : `${count} of 2 suggestions added`}</p></div><button aria-label="Close restaurant search" onClick={onClose}><X size={20} /></button></header>
      <div data-search-field className="gs-custom-search"><Search size={18} /><input data-search-input="embedded" autoFocus aria-label="Search restaurants for your shortlist" placeholder="Restaurant name or city" value={query} onChange={e => setQuery(e.target.value)} autoComplete="off" autoCorrect="off" />{query && <button aria-label="Clear restaurant search" onClick={() => setQuery('')}><X size={16} /></button>}</div>
      {error && <p className="gs-custom-search-error" role="alert">{error}</p>}
      <div className="gs-custom-search-results" aria-busy={searching}>
        {searching ? <p className="gs-custom-empty" role="status"><Loader2 size={20} className="gs-spin" />Finding restaurants…</p> : results.map(p => {
          const selected = room.deck.some(pick => pick.id === p.id);
          return <button key={p.id} className="gs-custom-result" disabled={selected || full || busy || !!adding} aria-label={selected ? `${p.name} already in shortlist` : `Add ${p.name}`} onClick={async () => { setAdding(p.id); try { await onAdd(p.id); } finally { if (live.current) setAdding(''); } }}>
            <PlaceLabel place={{ ...p, cuisine: cuisineLabel(p) }} /><span className="gs-custom-add-icon">{adding === p.id ? <Loader2 size={18} className="gs-spin" /> : selected ? <Check size={18} /> : <Plus size={18} />}</span>
          </button>;
        })}
        {!searching && results.length === 0 && <p className="gs-custom-empty">{query.trim().length < 2 ? 'Search for a place you already have in mind.' : searchError ? 'Search is unavailable. Check your connection and try again.' : 'No restaurants found. Try the name with its city.'}</p>}
      </div>
      <footer><small>{full ? 'Your suggestions are complete. Remove a place to swap it.' : 'Place information from Google Maps'}</small><button className="gs-primary" onClick={onClose}>Done<Check size={17} /></button></footer>
    </section>
  </dialog>;
};

export const GroupCustomLobby: React.FC<{
  room: GroupRoom; userId: string; busy: boolean; error?: string;
  run: (action: string, payload?: Record<string, unknown>) => Promise<unknown>;
  onPreview: (place: GroupPlace) => void;
}> = ({ room, userId, busy, error, run, onPreview }) => {
  const host = room.host === userId;
  const member = room.members[userId];
  const count = room.deck.filter(p => p.addedBy === userId).length;
  const [picker, setPicker] = useState(false);
  const canAdd = (host || room.allowGuestAdds) && room.deck.length < 15 && (host || count < 2);
  const members: [string, GroupRoom['members'][string]][] = Object.entries(room.members);
  const guests = members.filter(([id]) => id !== room.host);
  const canStart = guests.length > 0 && room.deck.length >= 2 && guests.every(([, m]) => m.ready);
  // If the host locks additions, closes the room or starts voting, close search.
  useEffect(() => { if (room.status !== 'lobby' || (!host && !room.allowGuestAdds)) setPicker(false); }, [room.status, room.allowGuestAdds, host]);
  return <section className="gs-custom-lobby">
    <span className="gs-eyebrow">YOUR OWN SHORTLIST</span><h1>A few places.<br />One shared favorite.</h1>
    <p>Choose the restaurants you’re deciding between, then swipe and rank them together.</p>
    {host ? <><h2>Who can add restaurants?</h2><GroupContributionPolicy value={!!room.allowGuestAdds} disabled={busy} onChange={allowGuestAdds => { void run('custom_settings', { allowGuestAdds }); }} /></> : <div className="gs-custom-policy-note"><Users size={18} /><span>{room.allowGuestAdds ? 'You can suggest up to 2 restaurants.' : 'Your host is choosing the restaurants.'}</span></div>}
    <div className="gs-custom-list-heading"><h2>The shortlist</h2><span>{room.deck.length} / 15</span></div>
    {room.deck.length ? <div className="gs-custom-list">{room.deck.map(place => <div className="gs-custom-entry" key={place.id}>
      <button className="gs-custom-place" onClick={() => onPreview(place)} aria-label={`Preview ${place.name}`}><PlaceLabel place={place} /><ArrowUpRight size={17} /></button>
      <div className="gs-custom-entry-footer"><small>Added by {place.addedBy === userId ? 'you' : room.members[place.addedBy || '']?.name || 'your group'}</small>{(host || place.addedBy === userId) && <button disabled={busy} onClick={() => void run('custom_remove', { place: place.id })} aria-label={`Remove ${place.name}`}><Trash2 size={15} />Remove</button>}</div>
    </div>)}</div> : <div className="gs-custom-empty-list"><ListPlus size={29} /><strong>{canAdd ? 'Start with a favorite.' : 'Your shortlist is on its way.'}</strong><span>{canAdd ? 'Add at least 2 places to compare.' : 'The places your host adds will appear here.'}</span></div>}
    {canAdd && <button className="gs-custom-add" disabled={busy} onClick={() => setPicker(true)}><Plus size={19} />Add a restaurant{!host && <small>{count} of 2</small>}</button>}
    {!canAdd && room.deck.length >= 15 && <p className="gs-custom-help">The shortlist is full. Remove a place to make room.</p>}
    {!host && room.allowGuestAdds && count >= 2 && <p className="gs-custom-help">Your two suggestions are in. You can remove one to swap it.</p>}
    <div className="gs-custom-readiness"><h2>Ready to decide?</h2>{members.map(([id, m]) => <div key={id}><span>{id === userId ? 'You' : m.name}</span><small>{id === room.host ? 'Host' : m.ready ? 'Ready' : 'Reviewing shortlist'}</small>{id !== room.host && m.ready && <Check size={16} />}</div>)}
      <p>Shortlist changes reset readiness, so everyone sees the same choices.</p>
    </div>
    <div className="gs-custom-start">
      {host ? <><button className="gs-primary" disabled={busy || !canStart} onClick={() => void run('start', { version: room.shortlistVersion })}>{busy && <Loader2 size={18} className="gs-spin" />}Start swiping<Check size={18} /></button><small>{guests.length === 0 ? 'Invite at least one friend to join.' : room.deck.length < 2 ? 'Add at least two restaurants.' : !canStart ? 'Waiting for everyone to mark ready.' : 'Your shortlist locks when voting starts.'}</small></> : <><button className="gs-primary" disabled={busy || member?.ready || room.deck.length < 2} onClick={() => void run('custom_ready', { version: room.shortlistVersion })}>{busy && <Loader2 size={18} className="gs-spin" />}{member?.ready ? 'You’re ready' : 'I’m ready'}<Check size={18} /></button><small>{member?.ready ? 'Your host will start voting when everyone is ready.' : 'You don’t need to add a place to join the decision.'}</small></>}
    </div>
    {host && guests.length > 0 && <details className="gs-custom-manage"><summary>Manage guests</summary>{guests.map(([id, m]) => <button key={id} disabled={busy} onClick={() => void run('remove', { member: id })}>Remove {m.name}<X size={16} /></button>)}</details>}
    {picker && <GroupRestaurantPicker room={room} userId={userId} busy={busy} error={error} onAdd={placeId => run('custom_add', { placeId })} onClose={() => setPicker(false)} />}
  </section>;
};
