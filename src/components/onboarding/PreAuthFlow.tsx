import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, Check, ChevronRight, Coffee, Compass, MapPin, Sparkles, Star, Utensils } from 'lucide-react';
import { GoalStep, GOAL_TITLE, GOAL_SUBTITLE } from './GoalStep';
import { APP_GOAL_LABELS } from '../../lib/app-goal';
import * as OB from './OnboardingKit';
import { AtmosphereStep, ATMOSPHERE_OPTIONS, CuisineGrid, PriceStep, TASTE_CUISINES } from './TasteSteps';
import { CityAutocomplete } from '../CityAutocomplete';
import { savePickedLocation, geocodePlace, type HomeLocation } from '../HomeLocationBar';
import { saveTasteQuiz, getTasteQuiz, type TasteQuizAnswers } from '../../lib/taste-quiz';
import { TASTE_QUESTION_ORDER, type TasteQuestion } from '../../lib/onboarding-progress';
import { savePreauthCity, markPreauthDone, savePreauthOutcome, getPreauthCity, clearPreauthCity } from '../../lib/preauth';
import { logOnboardingEvent, markOnboardingStep } from '../../lib/onboarding-events';
import { fetchTastePreview } from '../../lib/taste-preview';
import type { ScoredPlace } from '../../lib/recommendations';
import { priceLevelToString } from '../../lib/places';
import { cuisineLabel } from '../../lib/cuisine';

type Step = 'welcome' | TasteQuestion | 'review';
const ORDER: Step[] = ['welcome', ...TASTE_QUESTION_ORDER, 'review'];
const COPY: Record<TasteQuestion, { title: string; sub: string; section: string }> = {
  goal: { title: GOAL_TITLE, sub: GOAL_SUBTITLE, section: 'Your way to GoodEats' },
  city: { title: 'Great food starts nearby.', sub: 'Choose your home city. You can explore anywhere, anytime.', section: 'Your neighborhood' },
  cuisines: { title: 'What sounds good to you?', sub: 'The flavors you love help us find your next favorite.', section: 'Your favorites' },
  prices: { title: 'Your kind of night out.', sub: 'What feels comfortable for an everyday meal?', section: 'Your budget' },
  atmosphere: { title: 'Set the mood.', sub: 'Pick the feeling you come back for. We’ll use it to guide your recommendations.', section: 'Your atmosphere' },
};

const WelcomeVisual = () => {
  const reduce = useReducedMotion();
  return <div className="ob-welcome-visual">
  <motion.div className="ob-food-frame" initial={reduce ? false : { opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: .65, ease: OB.EASE }}><img src="/images/onboarding/contemporary-dining.jpg" alt="A bright contemporary restaurant with sushi, salad and pasta served at a shared table" />
  </motion.div>
  <motion.div className="ob-floating-note" initial={reduce ? false : { opacity: 0, y: 14, rotate: -5 }} animate={{ opacity: 1, y: 0, rotate: -3 }} transition={{ ...OB.SPRING_SOFT, delay: reduce ? 0 : .15 }}><span className="ob-note-icon"><Compass size={20} strokeWidth={1.5} /></span><span><strong>Find your next favorite table</strong><small>Discover, save, and dine out.</small></span><ArrowUpRight size={18} /></motion.div>
  <div className="ob-visual-caption"><span /><span>Discover. Save. Make it yours.</span></div>
</div>;
};

export const PreAuthFlow: React.FC<{
  onExit: (mode: 'signup' | 'signin') => void;
  onBrowseAsGuest?: () => void;
}> = ({ onExit, onBrowseAsGuest }) => {
  const reduce = useReducedMotion();
  const [saved] = useState(() => getTasteQuiz(null));
  const [step, setStep] = useState<Step>('welcome');
  const [dir, setDir] = useState(1);
  const [editing, setEditing] = useState(false);
  const [goal, setGoal] = useState(saved?.goal);
  const [cuisines, setCuisines] = useState(saved?.cuisines ?? []);
  const [primary, setPrimary] = useState(saved?.pricePrimary ?? saved?.prices?.[0]);
  const [secondary, setSecondary] = useState(saved?.priceSecondary ?? saved?.prices?.[1]);
  const [atmosphere, setAtmosphere] = useState(saved?.atmosphere);
  const [completed, setCompleted] = useState<TasteQuestion[]>(saved?.completedSteps ?? []);
  const [city, setCity] = useState<HomeLocation | null>(() => getPreauthCity());
  const [cityText, setCityText] = useState(getPreauthCity()?.label ?? saved?.city ?? '');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<ScoredPlace[] | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const prices = useMemo(() => [primary, secondary].filter((n): n is number => n !== undefined), [primary, secondary]);
  const answers = useMemo<TasteQuizAnswers>(() => ({
    ...saved, goal, cuisines, prices, pricePrimary: primary, priceSecondary: secondary,
    atmosphere, city: city?.label, completedSteps: completed,
  }), [saved, goal, cuisines, prices, primary, secondary, atmosphere, city, completed]);

  useEffect(() => { logOnboardingEvent('preauth_start'); }, []);
  useEffect(() => { markOnboardingStep(`preauth_${step}`); }, [step]);
  // Persist every edit, including empty choices. The account handoff reads
  // this exact draft, so an optional skip never causes a repeated question.
  useEffect(() => {
    if (step !== 'welcome') void saveTasteQuiz(undefined, answers);
  }, [answers, step]);
  useEffect(() => {
    if (step !== 'review' || !city) return;
    let cancelled = false;
    setPreview(null);
    const timer = window.setTimeout(() => { if (!cancelled) { cancelled = true; setPreview([]); } }, 12000);
    fetchTastePreview({ ...answers, cuisines, prices }, city).then(places => {
      if (!cancelled) setPreview(places);
    }).catch(() => { if (!cancelled) setPreview([]); }).finally(() => window.clearTimeout(timer));
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [step, city, answers, cuisines, prices, previewAttempt]);

  const go = (next: Step, direction = 1) => {
    (document.activeElement as HTMLElement | null)?.blur();
    setError(''); setDir(direction); setStep(next);
  };
  const complete = (key: TasteQuestion, cityOverride?: HomeLocation | null) => {
    const nextCompleted = Array.from(new Set([...completed, key]));
    setCompleted(nextCompleted);
    void saveTasteQuiz(undefined, { ...answers, completedSteps: nextCompleted,
      ...(cityOverride !== undefined ? { city: cityOverride?.label } : {}) });
    logOnboardingEvent(`preauth_${key}_done`);
    go(editing ? 'review' : ORDER[ORDER.indexOf(key) + 1]);
    setEditing(false);
  };
  const next = async () => {
    if (busyRef.current || step === 'welcome' || step === 'review') return;
    if (step !== 'city') { complete(step); return; }
    busyRef.current = true; setBusy(true); setError('');
    try {
      const picked = city ?? (cityText.trim() ? await geocodePlace(cityText.trim()) : null);
      if (cityText.trim() && !picked) { setError('Choose a city from the results, or leave it for later.'); return; }
      setCity(picked);
      if (picked) { setCityText(picked.label); savePreauthCity(picked); savePickedLocation(picked); }
      else clearPreauthCity();
      complete('city', picked);
    } catch { setError('We couldn’t find that city. Try again, or skip for now.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const leave = (mode: 'signup' | 'signin' | 'guest') => {
    if (step !== 'welcome') void saveTasteQuiz(undefined, { ...answers, completedAt: Date.now() });
    markPreauthDone(); savePreauthOutcome(mode); markOnboardingStep(null);
    logOnboardingEvent(`preauth_gate_${mode}`);
    if (mode === 'guest') onBrowseAsGuest?.(); else onExit(mode);
  };
  const edit = (key: TasteQuestion) => { setEditing(true); go(key, -1); };
  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>, id: string) => setter(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]);
  const summary = [
    { key: 'goal' as const, label: 'Here for', value: goal ? APP_GOAL_LABELS[goal] : 'Exploring everything', icon: Compass },
    { key: 'city' as const, label: 'Home city', value: city?.label || 'Choose later', icon: MapPin },
    { key: 'cuisines' as const, label: 'Favorite cuisines', value: cuisines.join(', ') || 'Open to everything', icon: Utensils },
    { key: 'prices' as const, label: 'Everyday budget', value: primary ? `${'$'.repeat(primary)}${secondary ? ` · ${'$'.repeat(secondary)} for occasions` : ''}` : 'All price ranges', icon: Star },
    { key: 'atmosphere' as const, label: 'Atmosphere', value: ATMOSPHERE_OPTIONS.find(a => a.id === atmosphere)?.title || 'A little of everything', icon: Sparkles },
  ];
  const footer = step === 'welcome' ? <>
    <p className="ob-footer-note">Five quick questions. A world of better picks.</p>
    <OB.PrimaryButton onClick={() => go('goal')}>Find my favorites</OB.PrimaryButton>
    {onBrowseAsGuest && <OB.GhostButton onClick={() => leave('guest')}>Just looking? Explore first</OB.GhostButton>}
  </> : step === 'review' ? <>
    <OB.PrimaryButton onClick={() => leave('signup')}>Save & create account</OB.PrimaryButton>
    {onBrowseAsGuest && <OB.GhostButton onClick={() => leave('guest')}>Explore without an account</OB.GhostButton>}
  </> : <>
    {error && <OB.ErrorRow>{error}</OB.ErrorRow>}
    <OB.PrimaryButton onClick={() => void next()} loading={busy}>{editing ? 'Save changes' : step === 'atmosphere' ? 'See my taste profile' : 'Continue'}</OB.PrimaryButton>
    <button className="ob-skip" type="button" disabled={busy} onClick={() => {
      if (step === 'city') { setCity(null); setCityText(''); clearPreauthCity(); complete(step, null); }
      else complete(step);
    }}>{editing ? 'Keep these preferences' : 'Skip for now'}</button>
  </>;

  return <OB.OnboardingScreen contentKey={step} header={step === 'welcome' ? <div className="ob-wordmark"><span><OB.BrandMark size={30} />GoodEats<span className="ob-wordmark-dot">.</span></span><button type="button" onClick={() => leave('signin')}>Sign in <ArrowUpRight size={14} /></button></div>
    : <OB.ProgressHeader step={step === 'review' ? TASTE_QUESTION_ORDER.length + 1 : TASTE_QUESTION_ORDER.indexOf(step) + 1} total={TASTE_QUESTION_ORDER.length + 1}
      label={step === 'review' ? 'Made for you' : COPY[step].section}
      onBack={() => { if (!busyRef.current) { go(editing ? 'review' : ORDER[ORDER.indexOf(step) - 1], -1); setEditing(false); } }} />}
    footer={footer}>
    <motion.div key={step} className="ob-step" initial={reduce ? false : { opacity: 0, x: 18 * dir }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .3, ease: OB.EASE }}>
      {step === 'welcome' ? <div className="ob-welcome">
        <WelcomeVisual />
        <div className="ob-welcome-copy"><span className="ob-kicker">Good taste. Great places.</span><OB.Title size={40}>Life’s too short<br />for ordinary food.</OB.Title><OB.Subtitle>Discover places you’ll love, keep your favorites close, and make every meal a good one.</OB.Subtitle></div>
      </div> : step === 'review' ? <>
        <div className="ob-ready-icon"><Check size={26} strokeWidth={1.6} /></div>
        <OB.StepHeader topGap={14} title="A taste of what’s to come." subtitle="Your starting point, shaped by you. Tap any detail to fine-tune it." />
        <div className="ob-summary">{summary.map(({ key, label, value, icon: Icon }) => <button type="button" key={key} onClick={() => edit(key)} aria-label={`Edit ${label}`}><Icon size={19} strokeWidth={1.5} /><span><small>{label}</small><strong>{value}</strong></span><ChevronRight size={16} /></button>)}</div>
        {city && <section className="ob-preview"><div className="ob-section-heading"><span>Worth a first look</span><span>{city.label.split(',')[0]}</span></div>
          {preview === null ? <div role="status" aria-label="Finding nearby restaurants" className="ob-preview-loading"><span /><span /><span /></div>
          : preview.length ? preview.slice(0, 3).map(p => <div key={p.id} className="ob-preview-row"><span><strong>{p.name}</strong><small>{[cuisineLabel(p), priceLevelToString(p.priceLevel)].filter(Boolean).join(' · ')}</small></span>{p.rating > 0 && <span className="ob-preview-rating"><Star size={12} />{p.rating.toFixed(1)}<small>Google</small></span>}</div>)
          : <div className="ob-hint">Nearby picks are taking a little longer. Your preferences are saved.<button type="button" className="ob-disclosure" onClick={() => setPreviewAttempt(n => n + 1)}>Try again</button></div>}
        </section>}
      </> : <>
        <OB.StepHeader title={COPY[step].title} subtitle={COPY[step].sub} />
        <div className="ob-question-body">
          {step === 'goal' && <GoalStep selected={goal} onChange={setGoal} />}
          {step === 'city' && <><div className="ob-city-art" aria-hidden><div className="ob-map-streets" /><span className="ob-map-pin ob-map-pin-small"><Utensils size={16} /></span><span className="ob-map-pin ob-map-pin-main"><MapPin size={29} strokeWidth={1.6} /></span><span className="ob-map-pin ob-map-pin-side"><Coffee size={17} strokeWidth={1.5} /></span><span className="ob-map-caption">Your next favorite is out there.</span></div>
            <CityAutocomplete value={cityText} onChange={v => { setCityText(v); setCity(null); clearPreauthCity(); }} onPick={loc => { setCity(loc); setCityText(loc.label); }} onSubmit={() => void next()} />
            <p className="ob-hint">Only your city is saved to your profile.</p></>}
          {step === 'cuisines' && <CuisineGrid options={TASTE_CUISINES} selected={cuisines} onToggle={id => toggle(setCuisines, id)} />}
          {step === 'prices' && <PriceStep primary={primary} secondary={secondary} onChange={(p, s) => { setPrimary(p); setSecondary(s); }} />}
          {step === 'atmosphere' && <AtmosphereStep selected={atmosphere} onChange={setAtmosphere} />}
        </div>
      </>}
    </motion.div>
  </OB.OnboardingScreen>;
};
