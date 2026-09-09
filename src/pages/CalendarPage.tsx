import React, { useEffect, useId, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, ChefHat, ChevronLeft, ChevronRight, Check, Clock3, Download, Search, SlidersHorizontal, MapPin, Pencil, Plus, RotateCcw, Star, Trash2, Users, Utensils, X } from 'lucide-react';
import { useCalendar } from '../contexts/CalendarContext';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useToast } from '../contexts/ToastContext';
import { dayKey, formatPlanTime, hasPlanReview, type CalendarPlan, type PlanKind } from '../lib/calendar';
import { exportCalendarPlan } from '../lib/calendar-export';
import { cn, localISODate } from '../lib/utils';
import { usePageBack } from '../lib/usePageBack';
import { GlassButton } from '../lib/glass-buttons';
import { CalendarDialog } from '../components/calendar/CalendarDialog';
import { PlanEditor } from '../components/calendar/PlanEditor';
import { CalendarNavigator, type CalendarView } from '../components/calendar/CalendarNavigator';
import './CalendarPage.css';
import './CalendarLayout.css';

const dateLabel = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
const kindLabel = (kind: PlanKind) => kind === 'restaurant' ? 'Dining out' : 'Cooking at home';
export function CalendarPage() {
  const { plans, loading, error, refresh, save, remove } = useCalendar();
  const { user } = useAuth();
  const { ratings, openAddRestaurantModal } = useLists();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const back = usePageBack('/');
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12));
  const [selected, setSelected] = useState(localISODate());
  const [view, setView] = useState<CalendarView>('month');
  const [filter, setFilter] = useState<'all' | PlanKind>('all');
  const [showCancelled, setShowCancelled] = useState(false);
  const [editor, setEditor] = useState<{ plan?: CalendarPlan; kind?: PlanKind } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const today = localISODate();
  const reduced = useReducedMotion();
  const filterId = useId();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const transition = reduced ? { duration: 0 } : { duration: .3, ease: [.22, 1, .36, 1] as const };
  const requestedPlan = new URLSearchParams(location.search).get('plan');
  useEffect(() => {
    if (!requestedPlan || loading) return;
    const plan = plans.find(p => p.id === requestedPlan);
    if (plan) { selectDay(dayKey(plan)); setDetailId(plan.id); }
    else showToast('This plan is no longer available');
    navigate('/calendar', { replace: true });
  }, [requestedPlan, loading, plans]);
  const detail = plans.find(p => p.id === detailId);
  const detailPath = detail?.kind === 'restaurant'
    ? (detail.details.restaurant?.id ? `/restaurant/${encodeURIComponent(detail.details.restaurant.id)}` : undefined)
    : detail?.details.recipePath;
  const visible = useMemo(() => plans.filter(p => (showCancelled || p.status !== 'cancelled') && (filter === 'all' || p.kind === filter) && `${p.title} ${p.details.location} ${p.details.notes}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)), [plans, filter, showCancelled, query]);
  const plansByDay = useMemo(() => {
    const map = new Map<string, CalendarPlan[]>();
    visible.forEach(plan => { const key = dayKey(plan); map.set(key, [...(map.get(key) ?? []), plan]); });
    return map;
  }, [visible]);
  const selectedPlans = plansByDay.get(selected) ?? [];
  const monthPrefix = localISODate(month).slice(0, 7);
  const monthPlans = visible.filter(p => dayKey(p).startsWith(monthPrefix));
  const grouped = [...new Set<string>(monthPlans.map(dayKey))];
  const nextPlan = visible.find(p => dayKey(p) > selected && p.status === 'planned');
  const toBook = selectedPlans.filter(p => p.status === 'planned' && p.kind === 'restaurant' && p.details.reservation === 'to-book' && +new Date(p.ends_at) > Date.now());
  function selectDay(key: string, focus = true) {
    const date = new Date(`${key}T12:00:00`);
    setSelected(key); setMonth(new Date(date.getFullYear(), date.getMonth(), 1, 12));
    if (focus) setView('day');
  }
  function changeMonth(date: Date) {
    setMonth(date);
    const day = Math.min(new Date(`${selected}T12:00:00`).getDate(), new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate());
    setSelected(localISODate(new Date(date.getFullYear(), date.getMonth(), day, 12)));
  }
  const jumpToday = () => selectDay(localISODate());
  const stepDay = (direction: number) => { const next = new Date(`${selected}T12:00:00`); next.setDate(next.getDate() + direction); selectDay(localISODate(next)); };
  const openDetail = (p: CalendarPlan) => { setActionError(''); setDeleting(false); setDetailId(p.id); };
  async function updateDetail(change: Partial<CalendarPlan>) {
    if (!detail || busy) return;
    setBusy(true); setActionError('');
    try { await save({ ...detail, ...change }); showToast('Plan updated'); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  const rate = (p: CalendarPlan) => {
    setDetailId(null);
    openAddRestaurantModal(p.details.restaurant ?? { id: `calendar-${p.id}`, name: p.title, address: p.details.location, image: '', cuisine: '', price: '' }, hasPlanReview(p, ratings) ? undefined : 'new-visit', dayKey(p));
  };
  const planCard = (p: CalendarPlan) => <motion.button layout={!reduced} key={p.id} className={cn('meal-plan-card', p.kind, p.status === 'cancelled' && 'cancelled')} onClick={() => openDetail(p)}
    initial={{ opacity: 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={transition} whileTap={reduced ? undefined : { scale: .985 }}>
    <span className="meal-event-time"><strong>{formatPlanTime(p.starts_at)}</strong><small>{Math.round((+new Date(p.ends_at) - +new Date(p.starts_at)) / 60000)} min</small></span>
    <span className="meal-event-body"><span className="meal-event-top"><span className="meal-event-icon">{p.kind === 'restaurant' ? <Utensils size={18} /> : <ChefHat size={20} />}</span><span className="meal-kind-label">{kindLabel(p.kind)}</span><ChevronRight size={16} /></span>
      <strong className="meal-event-title">{p.title}</strong>
      <span className="meal-event-meta">{p.details.location ? <><MapPin size={12} />{p.details.location}</> : <><Users size={12} />{p.details.people} {p.kind === 'recipe' ? 'servings' : p.details.people === 1 ? 'person' : 'people'}</>}</span>
      <span className={cn('meal-status', p.details.reservation === 'to-book' && p.status === 'planned' && 'needs-booking')}>
        {p.status === 'cancelled' ? 'Cancelled' : hasPlanReview(p, ratings) || p.review_state === 'reviewed' ? <><Star size={11} />Rated</> : p.status === 'completed' ? <><Check size={11} />Enjoyed</> : p.kind === 'recipe' ? 'Cooking at home' : p.details.reservation === 'confirmed' ? <><Check size={11} />Reservation confirmed</> : p.details.reservation === 'to-book' ? <><Clock3 size={11} />Needs a reservation</> : 'On the calendar'}
      </span>
    </span>
  </motion.button>;
  const emptyState = (list = false) => <div className="meal-empty">
    <div className="meal-empty-art"><CalendarDays size={26} strokeWidth={1.4} /><span><Plus size={11} /></span></div>
    <h3>{query || filter !== 'all' ? 'No matching plans' : list ? 'Your month is open' : 'A little room in your day'}</h3>
    <p>{query || filter !== 'all' ? 'Try another search or clear your filters.' : 'Add a restaurant or something to cook.'}</p>
    {query || filter !== 'all' ? <button className="meal-button secondary" onClick={() => { setQuery(''); setFilter('all'); }}>Clear filters</button> : <button className="meal-button primary" onClick={() => setEditor({})}><Plus size={16} />Add a plan</button>}
    {!list && nextPlan && <button className="meal-next-plan" onClick={() => selectDay(dayKey(nextPlan))}>Next plan<span>{new Date(nextPlan.starts_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span><ArrowUpRight size={14} /></button>}
  </div>;
  return <div className="meal-calendar">
    <header className="meal-page-header" aria-label="Calendar controls">
      <GlassButton id="calendar-back" className="meal-back" symbol="chevron.left" label="Back" onClick={back} suspended={!!editor || !!detail}><ChevronLeft size={22} /></GlassButton>
      <GlassButton id="calendar-add" className="meal-glass-add" symbol="plus" title="Add plan" label="Add a plan" onClick={() => setEditor({})} suspended={!!editor || !!detail}><Plus size={18} /><span>Add plan</span></GlassButton>
    </header>
    {error && <div className="meal-error" role="alert">{error}<button onClick={() => void refresh()}>Try again</button></div>}
    <div className="meal-workspace" data-view={view}>
      <CalendarNavigator month={month} selected={selected} view={view} plansByDay={plansByDay} onSelect={selectDay} onMonth={changeMonth} onView={setView} onToday={jumpToday} />
      <section className="meal-agenda" aria-label={view === 'agenda' ? 'Month plans' : 'Selected day plans'} aria-busy={loading}>
        <div className="meal-agenda-heading"><div><span className="meal-agenda-date">{view === 'agenda' ? month.toLocaleDateString([], { month: 'long', year: 'numeric' }) : new Date(`${selected}T12:00:00`).toLocaleDateString([], { month: 'long', day: 'numeric' })}</span>
          <h2>{view === 'agenda' ? 'All plans' : selected === today ? 'Today' : new Date(`${selected}T12:00:00`).toLocaleDateString([], { weekday: 'long' })}<span>{(view === 'agenda' ? monthPlans : selectedPlans).length}</span></h2></div>
          <div className="meal-day-actions">{view !== 'agenda' && <><button className="meal-icon-button" aria-label="Previous day" onClick={() => stepDay(-1)}><ChevronLeft size={17} /></button><button className="meal-icon-button" aria-label="Next day" onClick={() => stepDay(1)}><ChevronRight size={17} /></button></>}
            <button className="meal-icon-button" aria-label={searchOpen ? 'Close plan search' : 'Search plans'} aria-expanded={searchOpen} onClick={() => { setSearchOpen(!searchOpen); setQuery(''); if (!searchOpen) setView('agenda'); }}>{searchOpen ? <X size={17} /> : <Search size={17} />}</button></div>
        </div>
        <AnimatePresence initial={false}>{searchOpen && <motion.div className="meal-search" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={transition}><label data-search-field><Search size={16} /><input data-search-input="embedded" autoFocus aria-label="Search plans" placeholder="Search this month…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="Clear search" onClick={() => setQuery('')}><X size={15} /></button>}</label></motion.div>}</AnimatePresence>
        <div className="meal-filter-bar"><div className="meal-filters" aria-label="Filter plans">{(['all', 'restaurant', 'recipe'] as const).map(f => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{filter === f && <motion.span className="meal-filter-selection" layoutId={`${filterId}-filter`} transition={transition} />}<span>{f === 'all' ? 'All' : f === 'restaurant' ? <><Utensils size={13} />Dining out</> : <><ChefHat size={14} />Cooking</>}</span></button>)}</div>
          <button className={cn('meal-icon-button', showCancelled && 'active')} aria-label="Plan options" aria-expanded={optionsOpen} onClick={() => setOptionsOpen(!optionsOpen)}><SlidersHorizontal size={16} /></button></div>
        {optionsOpen && <label className="meal-cancel-filter"><span>Show cancelled plans</span><input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} /></label>}
        <div className="meal-agenda-list" aria-live="polite">
          {loading && !plans.length ? <div className="meal-loading" role="status"><span />Loading plans…</div> : <AnimatePresence mode="wait" initial={false}><motion.div key={view === 'agenda' ? `list-${monthPrefix}` : selected} initial={{ opacity: 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -5 }} transition={{ duration: reduced ? 0 : .16 }}>
            {view === 'agenda' ? (grouped.length ? grouped.map(key => <div className="meal-list-day" key={key}><button onClick={() => selectDay(key)}>{new Date(`${key}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}<ChevronRight size={14} /></button>{(plansByDay.get(key) ?? []).map(planCard)}</div>) : emptyState(true)) : selectedPlans.length ? selectedPlans.map(planCard) : emptyState()}
          </motion.div></AnimatePresence>}
        </div>
        {view !== 'agenda' && toBook.length > 0 && <button className="meal-booking-nudge" onClick={() => openDetail(toBook[0])}><Clock3 size={17} /><span><strong>Still need to book?</strong><small>{toBook[0].title}</small></span><ChevronRight size={15} /></button>}
      </section>
    </div>
    {!user && <p className="meal-storage-note">Plans saved on this device.</p>}
    {editor && <PlanEditor date={selected} plan={editor.plan} initialKind={editor.kind} onClose={() => setEditor(null)} onSaved={p => { setEditor(null); setQuery(''); setFilter('all'); selectDay(dayKey(p)); showToast(editor.plan ? 'Plan updated' : 'Something good is on the calendar'); }} />}
    {detail && <CalendarDialog interactive className="plan-editor-dialog meal-plan-detail-dialog" closeDisabled={busy} title={detail.title} subtitle={kindLabel(detail.kind)} onClose={() => { if (!busy) setDetailId(null); }}><div className="meal-detail">
      <div className="meal-detail-facts"><p><CalendarDays size={18} /><span>{dateLabel(dayKey(detail))}<small>{formatPlanTime(detail.starts_at)} – {formatPlanTime(detail.ends_at)}{dayKey(detail) !== localISODate(new Date(detail.ends_at)) ? ' · next day' : ''}</small></span></p><p><Users size={18} /><span>{detail.details.people} {detail.kind === 'recipe' ? 'servings' : detail.details.people === 1 ? 'person' : 'people'}</span></p>{detail.details.location && <p><MapPin size={18} /><span>{detail.details.location}</span></p>}{detail.kind === 'restaurant' && <p><Check size={18} /><span>{detail.details.reservation === 'confirmed' ? 'Reservation booked' : detail.details.reservation === 'to-book' ? 'Still needs a reservation' : 'No reservation recorded'}{detail.details.confirmation && <small>Reference: {detail.details.confirmation}</small>}</span></p>}</div>
      {detailPath && <button disabled={busy} className="meal-button primary full meal-view-details" onClick={() => { setDetailId(null); navigate(detailPath); }}>
        {detail.kind === 'restaurant' ? <Utensils size={18} /> : <ChefHat size={18} />}<span>{detail.kind === 'restaurant' ? 'View restaurant' : 'View recipe'}</span><ArrowUpRight size={18} />
      </button>}
      {detail.details.notes && <div className="meal-detail-notes"><span className="meal-eyebrow">A LITTLE NOTE</span><p>{detail.details.notes}</p></div>}
      {detail.status === 'cancelled' ? <p className="meal-notice">This plan is cancelled. It won’t trigger a rating reminder.</p> : <>
        {detail.kind === 'restaurant' && +new Date(detail.ends_at) <= Date.now() && <button className="meal-button primary full" onClick={() => rate(detail)}><Star size={17} />{hasPlanReview(detail, ratings) ? 'Update your rating' : 'How was it? Rate your visit'}</button>}
        {detail.status === 'planned' && detail.kind === 'recipe' && <button disabled={busy} className="meal-button secondary full" onClick={() => void updateDetail({ status: 'completed' })}><Check size={17} /> I cooked this</button>}
      </>}
      <div className="meal-detail-actions"><button disabled={busy} onClick={() => { setDetailId(null); setEditor({ plan: detail }); }}><Pencil size={16} /> Edit / reschedule</button><button onClick={() => {
        void exportCalendarPlan(detail).catch(() => setActionError('Couldn’t export this plan. Please try again.'));
      }}><Download size={16} /> Export to calendar</button><button disabled={busy} onClick={() => void updateDetail(detail.status === 'cancelled' || detail.status === 'completed' ? { status: 'planned', review_state: 'pending', snoozed_until: null } : { status: 'cancelled' })}>{detail.status === 'planned' ? <X size={16} /> : <RotateCcw size={16} />}{detail.status === 'planned' ? 'Cancel this plan' : 'Restore plan'}</button><button disabled={busy} className="danger" onClick={() => setDeleting(true)}><Trash2 size={16} /> Delete plan</button></div>
      {deleting && <div className="meal-delete-confirm"><p>Delete this plan permanently?</p><button className="meal-button secondary" disabled={busy} onClick={() => setDeleting(false)}>Keep it</button><button className="meal-button danger" disabled={busy} onClick={async () => { setBusy(true); setActionError(''); try { await remove(detail.id); setDetailId(null); showToast('Plan deleted'); } catch (err) { setActionError(err instanceof Error ? err.message : 'Couldn’t delete plan.'); } finally { setBusy(false); } }}>Delete</button></div>}
      {actionError && <p className="meal-error" role="alert">{actionError}</p>}
    </div></CalendarDialog>}
  </div>;
}
