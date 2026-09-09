import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { validatePlan, type CalendarPlan, type PlanDraft } from '../lib/calendar';

interface CalendarValue {
  plans: CalendarPlan[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  save: (draft: PlanDraft) => Promise<CalendarPlan>;
  remove: (id: string) => Promise<void>;
}
const Context = createContext<CalendarValue | null>(null);
const keyFor = (owner: string) => `goodeats-calendar-v1:${owner}`;
function readCache(owner: string): CalendarPlan[] {
  try {
    const data = JSON.parse(localStorage.getItem(keyFor(owner)) ?? '[]');
    return Array.isArray(data) ? data.filter(p => p && typeof p.id === 'string' && p.details &&
      ['restaurant', 'recipe'].includes(p.kind) && !validatePlan(p)) : [];
  } catch { return []; }
}
export function CalendarProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const owner = user?.id ?? 'guest';
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const [state, setState] = useState(() => ({ owner, plans: readCache(owner) }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const commit = useCallback((uid: string, transform: (plans: CalendarPlan[]) => CalendarPlan[]) => {
    if (ownerRef.current !== uid) return;
    setState(previous => ({ owner: uid, plans: transform(previous.owner === uid ? previous.plans : readCache(uid)) }));
  }, []);
  useEffect(() => {
    if (state.owner !== owner) return;
    try { localStorage.setItem(keyFor(owner), JSON.stringify(state.plans)); } catch { /* Cloud writes are still durable. Guest writes verify storage before committing below. */ }
  }, [owner, state]);
  const refresh = useCallback(async () => {
    const uid = owner;
    const revision = ++generation.current;
    if (uid === 'guest' || !supabaseConfigured) { setLoading(false); setError(''); return; }
    setLoading(true);
    try {
      // Fetch in pages: Supabase's default row limit must not silently hide older plans.
      const plans: CalendarPlan[] = [];
      for (let offset = 0; ; offset += 500) {
        const result = await supabase.from('calendar_plans').select('*').eq('user_id', uid).order('starts_at').order('id').range(offset, offset + 499);
        if (result.error) throw result.error;
        plans.push(...result.data as CalendarPlan[]);
        if (result.data.length < 500) break;
      }
      if (ownerRef.current !== uid || generation.current !== revision) return;
      commit(uid, () => plans); setError('');
    } catch {
      if (ownerRef.current === uid && generation.current === revision) setError('Couldn’t sync your calendar. Your saved plans are still here.');
    } finally { if (ownerRef.current === uid && generation.current === revision) setLoading(false); }
  }, [owner, commit]);
  useEffect(() => {
    setState({ owner, plans: readCache(owner) }); setError('');
    void refresh();
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const storage = (e: StorageEvent) => { if (e.key === keyFor(owner)) commit(owner, () => readCache(owner)); };
    window.addEventListener('online', refresh);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visible);
    return () => { ++generation.current; window.removeEventListener('online', refresh); window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', visible); };
  }, [owner, refresh, commit]);
  const save = useCallback(async (draft: PlanDraft) => {
    const invalid = validatePlan(draft); if (invalid) throw new Error(invalid);
    const uid = owner;
    ++generation.current; setLoading(false);
    let saved: CalendarPlan;
    let guestPlans: CalendarPlan[] | null = null;
    if (uid !== 'guest' && supabaseConfigured) {
      const { data, error } = await supabase.from('calendar_plans').upsert({
        id: draft.id, user_id: uid, kind: draft.kind, title: draft.title.trim(), starts_at: draft.starts_at, ends_at: draft.ends_at,
        details: draft.details, status: draft.status, review_state: draft.review_state, snoozed_until: draft.snoozed_until,
      }).select('*').single();
      if (error) throw new Error('Couldn’t save your plan. Check your connection and try again.');
      saved = data as CalendarPlan;
    } else {
      const now = new Date().toISOString();
      const previous = readCache(uid);
      saved = { ...draft, title: draft.title.trim(), created_at: previous.find(p => p.id === draft.id)?.created_at ?? now, updated_at: now };
      guestPlans = [...previous.filter(p => p.id !== saved.id), saved];
      try { localStorage.setItem(keyFor(uid), JSON.stringify(guestPlans)); }
      catch { throw new Error('Device storage is full or unavailable. Your plan hasn’t been saved.'); }
    }
    ++generation.current;
    commit(uid, previous => guestPlans ?? [...previous.filter(p => p.id !== saved.id), saved]);
    if (ownerRef.current === uid) setError('');
    return saved;
  }, [owner, commit]);
  const remove = useCallback(async (id: string) => {
    const uid = owner;
    ++generation.current; setLoading(false);
    if (uid !== 'guest' && supabaseConfigured) {
      const { error } = await supabase.from('calendar_plans').delete().eq('id', id).eq('user_id', uid);
      if (error) throw new Error('Couldn’t delete your plan. Please try again.');
    } else {
      try { localStorage.setItem(keyFor(uid), JSON.stringify(readCache(uid).filter(p => p.id !== id))); }
      catch { throw new Error('Couldn’t update device storage. Please try again.'); }
    }
    ++generation.current;
    commit(uid, previous => previous.filter(p => p.id !== id));
  }, [owner, commit]);
  return <Context.Provider value={{ plans: state.owner === owner ? state.plans : [], loading, error, refresh, save, remove }}>{children}</Context.Provider>;
}
export function useCalendar() {
  const context = useContext(Context);
  if (!context) throw new Error('useCalendar requires CalendarProvider');
  return context;
}
