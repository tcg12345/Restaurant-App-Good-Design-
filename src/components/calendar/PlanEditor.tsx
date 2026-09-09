import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChefHat, Utensils, Search, Check, AlertCircle, ArrowLeft, ArrowRight, Bookmark, CalendarDays, ChevronDown, Clock3, MapPin, Minus, Plus, StickyNote, Users, X, LoaderCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLists, type RestaurantMeta } from '../../contexts/ListsContext';
import { useRecipes } from '../../contexts/RecipesContext';
import { useHomeLocation } from '../../contexts/HomeLocationContext';
import { searchPlacesByText, priceLevelToString } from '../../lib/places';
import { cuisineLabel } from '../../lib/cuisine';
import { useCalendar } from '../../contexts/CalendarContext';
import { localISODate } from '../../lib/utils';
import { overlappingPlans, validatePlan, type CalendarPlan, type PlanDraft, type PlanKind } from '../../lib/calendar';
import { CalendarDialog } from './CalendarDialog';
import { PlanDatePicker } from './PlanDatePicker';
import './PlanEditor.css';

interface Source { id: string; kind: PlanKind; title: string; location?: string; restaurant?: RestaurantMeta; recipePath?: string; minutes?: number }
export function PlanEditor({ plan, date, initialKind = 'restaurant', onClose, onSaved }: {
  plan?: CalendarPlan; date: string; initialKind?: PlanKind; onClose: () => void; onSaved: (plan: CalendarPlan) => void;
}) {
  const { user } = useAuth();
  const home = useHomeLocation();
  const [searchResults, setSearchResults] = useState<Source[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');
  const searchAbort = useRef<AbortController | null>(null);
  const { wishlist, ratings, homeMeals, lists } = useLists();
  const { myRecipes } = useRecipes();
  const { plans, save } = useCalendar();
  const [id] = useState(() => plan?.id ?? crypto.randomUUID());
  const [kind, setKind] = useState<PlanKind>(plan?.kind ?? initialKind);
  const [title, setTitle] = useState(plan?.title ?? '');
  const [day, setDay] = useState(plan ? localISODate(new Date(plan.starts_at)) : date);
  const [time, setTime] = useState(plan ? new Date(plan.starts_at).toTimeString().slice(0, 5) : '19:00');
  const [duration, setDuration] = useState(plan ? Math.round((+new Date(plan.ends_at) - +new Date(plan.starts_at)) / 60000) : initialKind === 'recipe' ? 60 : 120);
  const [location, setLocation] = useState(plan?.details.location ?? '');
  const [people, setPeople] = useState(plan?.details.people ?? 2);
  const [notes, setNotes] = useState(plan?.details.notes ?? '');
  const [reservation, setReservation] = useState<CalendarPlan['details']['reservation']>(plan?.details.reservation ?? 'idea');
  const [confirmation, setConfirmation] = useState(plan?.details.confirmation ?? '');
  const [source, setSource] = useState<Pick<Source, 'restaurant' | 'recipePath'>>({ restaurant: plan?.details.restaurant, recipePath: plan?.details.recipePath });
  const [sourceOpen, setSourceOpen] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [customTime, setCustomTime] = useState(false);
  const [customDuration, setCustomDuration] = useState(false);
  const [moreDetails, setMoreDetails] = useState(!!plan?.details.notes || !!plan?.details.confirmation);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const detailsId = useId();
  const errorId = useId();
  const typeDrafts = useRef<Partial<Record<PlanKind, { title: string; location: string; source: Pick<Source, 'restaurant' | 'recipePath'>; duration: number; reservation: CalendarPlan['details']['reservation']; confirmation: string }>>>({});
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    if (scrollArea.current) scrollArea.current.scrollTop = 0;
    heading.current?.focus({ preventScroll: true });
  }, [step]);
  useEffect(() => { searchAbort.current?.abort(); setSearching(false); setSearchResults([]); setSearchMessage(''); return () => searchAbort.current?.abort(); }, [title, kind]);

  const sources = useMemo<Source[]>(() => {
    if (!user) return [];
    const all: Source[] = [
      ...[...wishlist, ...ratings].map(r => ({ id: r.restaurantId, title: r.name, kind: 'restaurant' as const, location: r.address,
        restaurant: { id: r.restaurantId, name: r.name, address: r.address ?? '', image: '', cuisine: r.cuisine ?? '', price: r.price ?? '' } })),
      ...homeMeals.filter(m => m.ingredients?.length || m.steps?.length).map(m => ({ id: m.id, title: m.name, kind: 'recipe' as const, recipePath: `/recipe/${user.id}/${encodeURIComponent(m.id)}`, minutes: (m.prepTime ?? 0) + (m.cookTime ?? 0) })),
      ...lists.flatMap(l => (l.recipes ?? []).map(r => ({ id: r.id, title: r.title, kind: 'recipe' as const,
        recipePath: r.sourceAuthorId && r.sourceMealId ? `/recipe/${r.sourceAuthorId}/${encodeURIComponent(r.sourceMealId)}` : `/recipe/${encodeURIComponent(r.id)}`, minutes: r.prepTime + r.cookTime }))),
      ...myRecipes.filter(r => !r.linkedMealId).map(r => ({ id: r.id, title: r.title, kind: 'recipe' as const, recipePath: `/recipe/${r.id}`, minutes: (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0) })),
    ];
    return all.filter((s, i) => all.findIndex(other => other.kind === s.kind && other.id === s.id) === i);
  }, [user, wishlist, ratings, homeMeals, lists, myRecipes]);
  async function findRestaurant() {
    searchAbort.current?.abort();
    const controller = new AbortController(); searchAbort.current = controller;
    setSearching(true); setSearchMessage('');
    try {
      const found = await searchPlacesByText(title.trim(), home?.location?.lat, home?.location?.lng, undefined, false, undefined, controller.signal);
      if (controller.signal.aborted) return;
      setSearchResults(found.slice(0, 6).map(p => ({ id: p.id, kind: 'restaurant', title: p.name, location: p.fullAddress || p.address,
        restaurant: { id: p.id, name: p.name, image: '', address: p.fullAddress || p.address, cuisine: cuisineLabel(p), price: priceLevelToString(p.priceLevel), lat: p.lat, lng: p.lng } })));
      if (!found.length) setSearchMessage('No matches. Try adding the city, or save the name as your own plan.');
    } catch { if (!controller.signal.aborted) setSearchMessage('Search is unavailable. You can still save a plan by name.'); }
    finally { if (!controller.signal.aborted) setSearching(false); }
  }
  function changeKind(next: PlanKind) {
    if (next === kind) return;
    typeDrafts.current[kind] = { title, location, source, duration, reservation, confirmation };
    const cached = typeDrafts.current[next];
    setKind(next); setTitle(cached?.title ?? ''); setLocation(cached?.location ?? '');
    setSource(cached?.source ?? {}); setDuration(cached?.duration ?? (next === 'recipe' ? 60 : 120));
    setReservation(cached?.reservation ?? 'idea'); setConfirmation(cached?.confirmation ?? '');
    setSourceOpen(true); setError(''); setCustomDuration(false);
  }
  function chooseSource(item: Source) {
    setTitle(item.title); setSource({ restaurant: item.restaurant, recipePath: item.recipePath });
    setLocation(item.location ?? '');
    if (item.minutes) setDuration(Math.min(1440, item.minutes));
    setSourceOpen(false); setSearchResults([]); setError('');
  }
  function continueToDetails() {
    if (!title.trim() || title.trim().length > 160) {
      setError(kind === 'restaurant' ? 'Add a restaurant or a name for your plan.' : 'Choose a recipe or name what you’re making.');
      titleInput.current?.focus(); return;
    }
    setError(''); setStep(2);
  }
  const timeOptions = ['12:00', '18:00', '18:30', '19:00', '19:30', '20:00'];
  const durationOptions = kind === 'recipe' ? [30, 45, 60, 90] : [60, 90, 120, 180];
  const durationLabel = (minutes: number) => minutes < 60 ? `${minutes} min` : `${minutes / 60} hr${minutes > 60 ? 's' : ''}`;
  const timeLabel = (value: string) => value ? new Date(`2000-01-01T${value}`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Choose time';
  const selectedSource = !!(source.restaurant || source.recipePath);
  const matches = sources.filter(s => s.kind === kind && s.title.toLowerCase().includes(title.toLowerCase())).slice(0, 6);
  const start = new Date(`${day}T${time}`);
  const validTime = Number.isFinite(start.getTime()) && Number.isFinite(duration) && duration >= 1 && duration <= 1440 && localISODate(start) === day && start.toTimeString().slice(0, 5) === time;
  const draft: PlanDraft = { id, title: title.trim(), kind, starts_at: validTime ? start.toISOString() : '',
    ends_at: validTime ? new Date(start.getTime() + duration * 60000).toISOString() : '', status: plan?.status ?? 'planned',
    review_state: plan?.review_state ?? 'pending', snoozed_until: plan?.snoozed_until ?? null,
    details: { location: location.trim(), people, notes: notes.trim(), reservation: kind === 'recipe' ? 'idea' : reservation, confirmation: kind === 'recipe' ? '' : confirmation.trim(), ...source } };
  const conflicts = validTime ? overlappingPlans(draft, plans) : [];
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    if (step === 1) { continueToDetails(); return; }
    const invalid = validatePlan(draft); if (invalid) { setError(invalid); return; }
    // Moving a visit to a new date should allow a fresh post-visit prompt.
    const moved = !!plan && (+new Date(plan.starts_at) !== +new Date(draft.starts_at) || plan.kind !== draft.kind || plan.title !== draft.title);
    lock.current = true; setSaving(true); setError('');
    try { onSaved(await save({ ...draft, ...(moved ? { review_state: 'pending', snoozed_until: null, status: 'planned' } as const : {}) })); }
    catch (err) { setError(err instanceof Error ? err.message : 'Couldn’t save your plan. Please try again.'); }
    finally { lock.current = false; setSaving(false); }
  }
  return <CalendarDialog
    title={plan ? 'Edit your plan' : 'Add a plan'}
    subtitle="Good food starts with a little planning."
    eyebrow="YOUR NEXT GOOD MEAL"
    className="plan-editor-dialog"
    fitKeyboard
    interactive
    closeDisabled={saving}
    onClose={() => { if (!lock.current) onClose(); }}
  >
    {closeDialog => <form className="plan-editor" onSubmit={submit} noValidate>
      <nav className="plan-progress" aria-label="Event form steps">
        <button type="button" aria-current={step === 1 ? 'step' : undefined} disabled={saving} onClick={() => { setError(''); setStep(1); }}><span>{step === 2 ? <Check size={12} /> : '1'}</span>The plan</button>
        <div aria-hidden="true" />
        <button type="button" aria-current={step === 2 ? 'step' : undefined} disabled={saving} onClick={continueToDetails}><span>2</span>When & details</button>
      </nav>
      <div className="plan-editor-scroll" ref={scrollArea}>
        <fieldset disabled={saving}>
          <div className="plan-step-heading"><h3 ref={heading} tabIndex={-1}>{step === 1 ? 'What’s the plan?' : 'Make it a date.'}</h3><p>{step === 1 ? 'A favorite table or something homemade.' : 'A few easy choices, and you’re all set.'}</p></div>
          {step === 1 ? <>
            <div className="plan-kind-cards" role="group" aria-label="Plan type">
              {(['restaurant', 'recipe'] as const).map(k => <button type="button" key={k} aria-pressed={kind === k} onClick={() => changeKind(k)}>
                <span className="plan-kind-icon">{k === 'restaurant' ? <Utensils size={21} /> : <ChefHat size={23} />}</span>
                <span><strong>{k === 'restaurant' ? 'Dining out' : 'Cooking at home'}</strong><small>{k === 'restaurant' ? 'Find your next favorite table' : 'Make something delicious'}</small></span>
                <span className="plan-choice-check">{kind === k && <Check size={11} />}</span>
              </button>)}
            </div>
            <label className="plan-input-label" htmlFor={`${detailsId}-title`}>{kind === 'restaurant' ? 'Where are you going?' : 'What are you making?'}</label>
            {selectedSource && !sourceOpen ? <div className="plan-picked-source">
              <span className="plan-picked-icon">{kind === 'restaurant' ? <Utensils size={20} /> : <ChefHat size={22} />}</span>
              <div><strong>{title}</strong><small>{location || (kind === 'recipe' ? 'From your recipe collection' : 'Saved restaurant')}</small><span><Check size={11} />{kind === 'restaurant' ? 'Restaurant linked' : 'Recipe linked'}</span></div>
              <button type="button" onClick={() => { setSourceOpen(true); requestAnimationFrame(() => titleInput.current?.focus()); }}>Change</button>
            </div> : <>
              <div data-search-field className="plan-search-input"><Search size={18} />
                <input data-search-input="embedded" ref={titleInput} id={`${detailsId}-title`} aria-label={kind === 'restaurant' ? 'Restaurant' : 'Recipe'} aria-invalid={!!error && !title.trim()} aria-describedby={error ? errorId : undefined}
                  maxLength={160} value={title} onChange={e => { setTitle(e.target.value); setSource({}); setSourceOpen(true); setError(''); }}
                  placeholder={kind === 'restaurant' ? 'Search restaurants or add a name' : 'Find a saved recipe or add a name'} autoComplete="off" />
                {title && <button type="button" className="plan-clear-input" aria-label="Clear name" onClick={() => { setTitle(''); setSource({}); titleInput.current?.focus(); }}><X size={15} /></button>}
              </div>
              {kind === 'restaurant' && <button className="plan-search-action" type="button" disabled={title.trim().length < 2 || searching} onClick={() => void findRestaurant()}>
                {searching ? <LoaderCircle className="plan-spinner" size={15} /> : <MapPin size={15} />} {searching ? 'Finding restaurants…' : 'Find this restaurant'}<ArrowRight size={14} />
              </button>}
              <p className="plan-input-hint">{kind === 'restaurant' ? 'Search to link a place, or simply give your plan a name.' : 'Pick from your collection, or type what you’d like to cook.'}</p>
            </>}
            {sourceOpen && matches.length > 0 && <div className="plan-suggestions">
              <span className="plan-suggestions-label"><Bookmark size={12} /> {kind === 'restaurant' ? 'FROM YOUR SAVED PLACES' : 'FROM YOUR RECIPE COLLECTION'}</span>
              {matches.map(item => <button type="button" key={item.id} onClick={() => chooseSource(item)}><span className="plan-suggestion-icon">{kind === 'restaurant' ? <Utensils size={16} /> : <ChefHat size={18} />}</span><span><strong>{item.title}</strong><small>{item.location || (item.minutes ? `${item.minutes} min · Saved recipe` : kind === 'recipe' ? 'Saved recipe' : 'Saved restaurant')}</small></span><Plus size={16} /></button>)}
            </div>}
            {searchResults.length > 0 && <div className="plan-suggestions"><span className="plan-suggestions-label"><MapPin size={12} /> MATCHING RESTAURANTS</span>{searchResults.map(item => <button type="button" key={item.id} onClick={() => chooseSource(item)}><span className="plan-suggestion-icon"><Utensils size={16} /></span><span><strong>{item.title}</strong><small>{item.location}</small></span><Plus size={16} /></button>)}</div>}
            {searchMessage && <p className="plan-input-hint" role="status">{searchMessage}</p>}
            <div className="plan-gentle-note"><CalendarDays size={17} /><p>One place for the meals you’re looking forward to.<br /><span>You can always change the details later.</span></p></div>
          </> : <>
            <button type="button" className="plan-selection-summary" onClick={() => { setError(''); setStep(1); }}>
              <span className="plan-picked-icon">{kind === 'restaurant' ? <Utensils size={17} /> : <ChefHat size={19} />}</span><span><small>{kind === 'restaurant' ? 'DINING OUT' : 'COOKING AT HOME'}</small><strong>{title}</strong></span><span>Change</span>
            </button>
            <section className="plan-field-section"><PlanDatePicker value={day} onChange={setDay} /></section>
            <section className="plan-field-section">
              <div className="plan-field-heading"><span><Clock3 size={16} /> Time</span><span>{timeLabel(time)}</span></div>
              <div className="plan-time-options" role="group" aria-label="Suggested times">
                {timeOptions.map(value => <button type="button" key={value} aria-pressed={time === value && !customTime} onClick={() => { setTime(value); setCustomTime(false); }}>{timeLabel(value)}</button>)}
                <button type="button" className="plan-custom-choice" aria-pressed={customTime || !timeOptions.includes(time)} aria-expanded={customTime || !timeOptions.includes(time)} onClick={() => setCustomTime(true)}>Other time <ChevronDown size={12} /></button>
              </div>
              {(customTime || !timeOptions.includes(time)) && <label className="plan-custom-input">Choose a time<input type="time" required value={time} onChange={e => setTime(e.target.value)} aria-label="Time" /></label>}
              <p className="plan-timezone">{Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' ')} time</p>
            </section>
            <section className="plan-field-section">
              <div className="plan-field-heading"><span>How long?</span><span>{validTime ? `Until ${timeLabel(new Date(draft.ends_at).toTimeString().slice(0, 5))}${localISODate(new Date(draft.ends_at)) !== day ? ' · next day' : ''}` : ''}</span></div>
              <div className="plan-duration-options" role="group" aria-label="Duration">
                {durationOptions.map(value => <button type="button" key={value} aria-pressed={duration === value && !customDuration} onClick={() => { setDuration(value); setCustomDuration(false); }}>{durationLabel(value)}</button>)}
                <button type="button" className="plan-custom-choice" aria-pressed={customDuration || !durationOptions.includes(duration)} aria-expanded={customDuration || !durationOptions.includes(duration)} onClick={() => setCustomDuration(true)}>Other <ChevronDown size={12} /></button>
              </div>
              {(customDuration || !durationOptions.includes(duration)) && <label className="plan-custom-input">Duration (minutes)<input type="number" min={1} max={1440} step={1} required value={Number.isFinite(duration) ? duration : ''} onChange={e => setDuration(e.target.valueAsNumber)} /></label>}
            </section>
            <section className="plan-people-row"><div><span><Users size={17} />{kind === 'recipe' ? 'How many servings?' : 'How many people?'}</span><small>{kind === 'recipe' ? 'A little extra for leftovers?' : 'Including you'}</small></div><div className="plan-stepper">
              <button type="button" disabled={people <= 1} aria-label={kind === 'recipe' ? 'Fewer servings' : 'Fewer people'} onClick={() => setPeople(Math.max(1, (Number.isFinite(people) ? people : 2) - 1))}><Minus size={16} /></button>
              <input type="number" min={1} max={100} inputMode="numeric" aria-label={kind === 'recipe' ? 'Servings' : 'People'} value={Number.isFinite(people) ? people : ''} onChange={e => setPeople(e.target.valueAsNumber)} />
              <button type="button" disabled={people >= 100} aria-label={kind === 'recipe' ? 'More servings' : 'More people'} onClick={() => setPeople(Math.min(100, (Number.isFinite(people) ? people : 0) + 1))}><Plus size={16} /></button>
            </div></section>
            {kind === 'restaurant' && <section className="plan-field-section">
              <div className="plan-field-heading"><span>Reservation</span><span>What’s the status?</span></div>
              <div className="plan-booking-options" role="group" aria-label="Reservation status">
                {([{ value: 'idea', label: 'Just a plan', note: 'Keep it casual', Icon: CalendarDays }, { value: 'to-book', label: 'Need to book', note: 'On the to-do list', Icon: Clock3 }, { value: 'confirmed', label: 'Booked', note: 'Table secured', Icon: Check }] as const).map(({ value, label, note, Icon }) => <button type="button" key={value} aria-pressed={reservation === value} onClick={() => setReservation(value)}><Icon size={17} /><strong>{label}</strong><small>{note}</small></button>)}
              </div>
              <p className="plan-input-hint">This records your booking; reserve directly with the restaurant.</p>
            </section>}
            {conflicts.length > 0 && <div className="plan-conflict" role="status"><AlertCircle size={17} /><p><strong>A little overlap</strong>This overlaps with {conflicts[0].title}. You can still save it.</p></div>}
            <section className="plan-extra-details">
              <button type="button" className="plan-details-toggle" aria-expanded={moreDetails} aria-controls={detailsId} onClick={() => setMoreDetails(!moreDetails)}><StickyNote size={17} /><span><strong>A few extra details</strong><small>{kind === 'recipe' ? 'Prep notes, ingredients, anything else' : 'Address, notes, booking reference'} · optional</small></span><ChevronDown size={17} /></button>
              {moreDetails && <div id={detailsId} className="plan-details-content">
                {kind === 'restaurant' && <label>Address<input maxLength={500} value={location} onChange={e => setLocation(e.target.value)} placeholder="Address or neighborhood" /></label>}
                {kind === 'restaurant' && reservation === 'confirmed' && <label>Booking reference<input maxLength={160} value={confirmation} onChange={e => setConfirmation(e.target.value)} placeholder="Confirmation number or booking name" /></label>}
                <label>Notes<textarea maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} placeholder={kind === 'recipe' ? 'Ingredients to pick up, prep to do ahead…' : 'Who’s joining, dishes to try, the occasion…'} rows={3} /></label>
              </div>}
            </section>
          </>}
        </fieldset>
      </div>
      <footer className="plan-editor-footer">
        {error && <p className="plan-editor-error" id={errorId} role="alert"><AlertCircle size={15} />{error}</p>}
        {step === 2 && <div className="plan-save-summary" aria-live="polite"><CalendarDays size={14} /><span>{new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}<i />{timeLabel(time)}<i />{Number.isFinite(people) ? people : '—'} {kind === 'recipe' ? 'servings' : people === 1 ? 'person' : 'people'}</span></div>}
        <div className="plan-footer-actions"><button type="button" className="plan-footer-back" disabled={saving} onClick={() => { if (step === 1) closeDialog(); else { setError(''); setStep(1); } }}>{step === 1 ? 'Cancel' : <><ArrowLeft size={16} />Back</>}</button><button type="submit" className="plan-continue" disabled={saving}>{saving ? <><LoaderCircle size={17} className="plan-spinner" />Saving your plan…</> : step === 1 ? <>Continue<ArrowRight size={17} /></> : <>{plan ? 'Save changes' : 'Add to calendar'}<Check size={17} /></>}</button></div>
      </footer>
    </form>}
  </CalendarDialog>;
}
