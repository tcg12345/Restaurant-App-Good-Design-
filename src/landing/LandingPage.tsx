import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, Bookmark, Check, ChevronDown, Compass, Heart, MapPin, Menu, Monitor, Plus, Search, SlidersHorizontal, Smartphone, Sparkles, Users, Utensils, X } from 'lucide-react';
import { Logo } from '../components/Logo';
import { storeLink } from './entry';
import { chapterLabels, useLandingMotion } from './useLandingMotion';
import './landing.css';

const FOOD = '/images/landing/pasta-alex-froloff.jpg';
const DINING = '/images/landing/restaurant-avi-richards.jpg';
// Country-neutral URL follows the user's App Store region and survives renaming.
const appleUrl = storeLink(import.meta.env.VITE_APP_STORE_URL?.trim() || 'https://apps.apple.com/app/id6779690841', 'apple');
const androidUrl = storeLink(import.meta.env.VITE_PLAY_STORE_URL, 'android');
const isTestFlight = appleUrl?.includes('testflight.apple.com');

function Brand({ footer = false }: { footer?: boolean }) {
  return <a className={`lp-brand${footer ? ' lp-brand-footer' : ''}`} href="/welcome" aria-label="GoodEats home"><Logo size={39} /><span>GoodEats<span className="lp-brand-period">.</span></span></a>;
}

function AppStoreBadge({ href }: { href: string }) {
  return <a className="lp-app-store-badge" href={href} target="_blank" rel="noopener noreferrer">
    <img src="/images/landing/download-on-the-app-store.svg" alt="Download on the App Store" width="120" height="40" />
  </a>;
}

function DownloadButton({ onClick, children = 'Get the app', light = false }: { onClick: () => void; children?: ReactNode; light?: boolean }) {
  if (appleUrl && !isTestFlight) return <AppStoreBadge href={appleUrl} />;
  return <button type="button" className={`lp-button${light ? ' lp-button-light' : ''}`} onClick={onClick}><Smartphone size={19} />{children}</button>;
}

const tabs = [
  { id: 'discover', title: 'Discover', icon: Compass, label: 'Find your next favorite.' },
  { id: 'rank', title: 'Rank', icon: Heart, label: 'Make it your own.' },
  { id: 'together', title: 'Together', icon: Users, label: 'Bring your people.' },
] as const;
type PreviewTab = typeof tabs[number]['id'];

function AppPreview({ active }: { active: PreviewTab }) {
  return <div className="lp-phone" aria-label={`${active} app preview`}>
    <div className="lp-phone-status" aria-hidden="true"><span>9:41</span><span className="lp-phone-island" /><span>▮▮▮ ▰</span></div>
    <div className="lp-phone-inner" key={active}>
      <div className="lp-preview-header"><Logo size={27} /><strong>GoodEats</strong><span className="lp-avatar">J</span></div>
      {active === 'discover' ? <>
        <div className="lp-preview-location"><MapPin size={12} /> New York, NY <ChevronDown size={12} /></div>
        <h3>A little hungry?<br /><span className="lp-type-accent">Let’s find your place.</span></h3>
        <div className="lp-preview-search"><Search size={15} /><span>What are you craving?</span><SlidersHorizontal size={14} /></div>
        <div className="lp-preview-chips"><span className="is-selected">For you</span><span>Nearby</span><span>Your circle</span></div>
        <div className="lp-preview-photo"><img src={FOOD} width="1200" height="1800" alt="" fetchPriority="high" /><span><Sparkles size={12} /> A little more your taste</span></div>
        <div className="lp-preview-restaurant"><div><h4>Your next great find</h4><p>Italian · A new favorite</p></div><span className="lp-score">9.2</span></div>
        <div className="lp-preview-social"><span className="lp-avatar">A</span><span className="lp-avatar">M</span><p>A good find from your circle</p></div>
      </> : active === 'rank' ? <>
        <div className="lp-preview-location">YOUR PERSONAL SHORTLIST</div>
        <h3>Great meals.<br /><span className="lp-type-accent">In your order.</span></h3>
        <div className="lp-preview-chips"><span className="is-selected">Been there</span><span>Want to try</span></div>
        <div className="lp-rank-cover"><img src={DINING} alt="" width="1400" height="1867" /><span>Your kind of places</span></div>
        {['The date-night favorite', 'That perfect lunch spot', 'Your weekend ritual'].map((name, i) => <div className="lp-preview-rank" key={name}><span>0{i + 1}</span><div><strong>{name}</strong><small>{['Worth going back for', 'Saved with a little note', 'Good company included'][i]}</small></div><b>{['9.4', '9.1', '8.8'][i]}</b></div>)}
      </> : <>
        <div className="lp-preview-location">GOOD COMPANY, GOOD CALL</div>
        <h3>Less “I don’t mind.”<br /><span className="lp-type-accent">More dinner plans.</span></h3>
        <div className="lp-preview-group"><span className="lp-avatar">J</span><span className="lp-avatar">A</span><span className="lp-avatar">M</span><span className="lp-avatar">S</span></div>
        <div className="lp-preview-message">Where are we eating tonight?<span>Let’s find something we’ll all love.</span></div>
        <div className="lp-preview-photo lp-group-photo"><img src={DINING} alt="" width="1400" height="1867" /><span><Users size={12} /> Decide together</span></div>
        <div className="lp-preview-restaurant"><div><h4>One table. Everyone happy.</h4><p>A shortlist for your whole group</p></div><span className="lp-group-check"><Check size={18} /></span></div>
      </>}
    </div>
    <div className="lp-phone-nav" aria-hidden="true"><Compass /><Search /><Plus /><Bookmark /><span className="lp-avatar">J</span></div>
    <div className="lp-home-indicator" aria-hidden="true" />
  </div>;
}

function DownloadDialog({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    el?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { el?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="lp-dialog" aria-labelledby="download-title" aria-describedby="download-description" onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="lp-dialog-content"><button type="button" className="lp-dialog-close" aria-label="Close download options" onClick={close} autoFocus><X size={21} /></button>
      <Logo size={65} /><p className="lp-eyebrow">GOOD TASTE GOES WITH YOU</p><h2 id="download-title">Your next great meal<br />starts here.</h2>
      <p id="download-description">{appleUrl || androidUrl ? 'Take GoodEats with you. Choose your download below.' : 'The GoodEats mobile download is coming soon. You can explore the app in your browser today.'}</p>
      <div className="lp-download-options">
        {appleUrl && (isTestFlight
          ? <a className="lp-button" href={appleUrl} target="_blank" rel="noopener noreferrer"><Smartphone size={21} />Join the iPhone beta</a>
          : <AppStoreBadge href={appleUrl} />)}
        {androidUrl && <a className="lp-button" href={androidUrl} target="_blank" rel="noopener noreferrer"><Smartphone size={21} />Get it on Google Play</a>}
        {!appleUrl && !androidUrl && <div className="lp-coming-soon"><Smartphone size={20} /><div><strong>GoodEats on your phone</strong><span>Store download coming soon</span></div></div>}
        <a className={`lp-button ${appleUrl || androidUrl ? 'lp-button-outline' : ''}`} href="/app"><Monitor size={19} />Open the web app<ArrowRight size={18} /></a>
      </div><p className="lp-dialog-login">Already have an account? <a href="/login">Log in</a></p>
    </div>
  </dialog>;
}

export default function LandingPage() {
  const [active, setActive] = useState<PreviewTab>('discover');
  const [downloadOpen, setDownloadOpen] = useState(() => window.location.pathname === '/download');
  const [menuOpen, setMenuOpen] = useState(false);
  const page = useRef<HTMLDivElement>(null);
  const openDownload = () => { setMenuOpen(false); setDownloadOpen(true); };

  useEffect(() => {
    document.documentElement.classList.add('landing-active');
    const title = document.title;
    document.title = 'GoodEats — Good food. Great finds. Your people.';
    const theme = document.querySelector('meta[name="theme-color"]');
    const originalTheme = theme?.getAttribute('content');
    theme?.setAttribute('content', '#f7f9f5');
    return () => { document.documentElement.classList.remove('landing-active'); document.title = title; if (originalTheme) theme?.setAttribute('content', originalTheme); };
  }, []);

  const { chapter, compact } = useLandingMotion(page);

  return <div className="lp" ref={page}>
    <a className="lp-skip" href="#main">Skip to content</a>
    <div className="lp-progress" aria-hidden="true" />
    <div className="lp-header-slot"><header className="lp-header" data-compact={compact} data-theme={chapter === 'your-taste' ? 'dark' : 'light'} data-menu-open={menuOpen}><div className="lp-nav-wrap"><div className="lp-header-brand"><Brand /><span className="lp-current-chapter" aria-hidden="true"><span key={chapter}>{chapterLabels[chapter]}</span></span></div>
      <nav className="lp-nav-desktop" aria-label="Main navigation"><a href="#the-app" aria-current={chapter === 'the-app' ? 'location' : undefined}>The app</a><a href="#your-taste" aria-current={chapter === 'your-taste' ? 'location' : undefined}>Your taste</a><a href="#good-company" aria-current={chapter === 'good-company' ? 'location' : undefined}>Good company</a></nav>
      <div className="lp-nav-actions"><a href="/login" className="lp-login">Log in</a><DownloadButton onClick={openDownload} /><button className="lp-menu-toggle" type="button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button></div>
    </div>
    {menuOpen && <nav className="lp-mobile-menu" id="mobile-navigation" aria-label="Mobile navigation" onKeyDown={e => { if (e.key === 'Escape') setMenuOpen(false); }}><a href="#the-app" onClick={() => setMenuOpen(false)}>The app</a><a href="#your-taste" onClick={() => setMenuOpen(false)}>Your taste</a><a href="#good-company" onClick={() => setMenuOpen(false)}>Good company</a><a href="/login">Log in</a></nav>}
    </header></div>
    <main id="main">
      <section className="lp-hero lp-container" id="the-app" data-chapter="the-app" aria-labelledby="hero-title">
        <div className="lp-hero-copy"><p className="lp-eyebrow"><span className="lp-eyebrow-line" /> FOR THE LOVE OF A GOOD MEAL</p>
          <h1 id="hero-title">Good food.<br />Great finds.<br /><em>Your people.</em></h1>
          <p className="lp-hero-description">Find places you’ll love. Keep the ones you do.<br className="lp-desktop-break" /> Share it all with people who get your taste.</p>
          <div className="lp-hero-actions"><DownloadButton onClick={openDownload}>Get GoodEats</DownloadButton><a className="lp-text-link" href="/app">Open web app <ArrowRight size={17} /></a></div>
          <p className="lp-availability">{appleUrl || androidUrl ? 'Your good taste, wherever you go.' : 'Explore on the web. Mobile download coming soon.'}</p>
          <a className="lp-scroll-cue" href="#a-little-taste"><span><ArrowDown size={16} /></span>A little taste of what’s inside</a>
        </div>
        <div className="lp-hero-art">
          <div className="lp-art-backdrop"><span className="lp-art-word" aria-hidden="true">good<br /><span className="lp-type-accent">taste.</span></span><span className="lp-art-note">A WORLD OF GOOD EATS.<br />A LITTLE MORE YOU.</span></div>
          <div className="lp-food-card" aria-hidden="true"><img src={FOOD} alt="" width="1200" height="1800" /><span><Heart size={14} fill="currentColor" /> Worth going back for.</span></div>
          <div className="lp-hero-phone"><AppPreview active={active} /></div>
          <div className="lp-saved-note" aria-hidden="true"><span className="lp-saved-icon"><Bookmark size={20} fill="currentColor" /></span><div><strong>A future favorite.</strong><span>Saved to your want-to-try list</span></div><Check size={17} /></div>
        </div>
        <div className="lp-hero-bottom"><p>GOOD FOOD IS PERSONAL.<br /><strong>YOUR APP SHOULD BE, TOO.</strong></p><div className="lp-preview-tabs" role="group" aria-label="Explore the app preview">{tabs.map(({ id, title, icon: Icon }) => <button type="button" key={id} aria-pressed={active === id} onClick={() => setActive(id)}><Icon size={16} />{title}</button>)}</div><span className="lp-preview-caption">An illustrative taste of GoodEats</span></div>
      </section>

      <section className="lp-intro lp-container" id="a-little-taste" aria-labelledby="intro-title">
        <div className="lp-section-heading" data-reveal><p className="lp-eyebrow">LESS SEARCHING. MORE SAVORING.</p><h2 id="intro-title">Life’s too short<br />for <span className="lp-type-accent">just okay.</span></h2><p>The perfect little spot. The meal you’re still thinking about.<br className="lp-desktop-break" /> GoodEats keeps you close to more of that.</p></div>
        <div className="lp-feature-grid">
          <article className="lp-feature lp-feature-discover" data-reveal><div className="lp-feature-top"><span>01 / DISCOVER</span><Compass size={22} /></div><h3>Go beyond<br />the usual.</h3><p>Find restaurants through your taste, your circle, and a little curiosity.</p><div className="lp-discovery-art"><img src={DINING} alt="Warm light and set tables inside The Butcher’s Daughter in Los Angeles" loading="lazy" width="1400" height="1867" /><span className="lp-photo-label"><MapPin size={14} /> Your next “how did I not know?”</span></div></article>
          <article className="lp-feature lp-feature-save" data-reveal data-reveal-order="1"><div className="lp-feature-top"><span>02 / REMEMBER</span><Bookmark size={22} /></div><h3>“We should go”<br />has a home.</h3><p>Save your next stops. Rank your favorites. Keep every good find together.</p><div className="lp-list-art" aria-label="Example saved lists"><div><span className="lp-list-icon"><Heart size={21} /></span><span>Date night<strong>A table for two</strong></span></div><div><span className="lp-list-icon"><Utensils size={21} /></span><span>Worth the trip<strong>Make a day of it</strong></span></div><div><span className="lp-list-icon"><Bookmark size={21} /></span><span>The regulars<strong>Always a good idea</strong></span></div></div></article>
          <article className="lp-feature lp-feature-share" data-reveal data-reveal-order="2"><div className="lp-feature-top"><span>03 / CONNECT</span><Users size={22} /></div><h3>Good taste<br />is contagious.</h3><p>See what your friends are loving. Turn their latest find into your next plan.</p><div className="lp-social-art" aria-label="Example of sharing a recommendation"><div className="lp-social-message"><span className="lp-avatar">A</span><div><strong>A friend with good taste</strong><span>You have to try this place.</span><img src={FOOD} alt="Fresh pasta with parmesan, tomatoes, and a glass of white wine" loading="lazy" width="1200" height="1800" /></div></div><span className="lp-social-reply">Already on my list. <Heart size={15} /></span></div></article>
        </div>
      </section>

      <div className="lp-taste-scene" id="your-taste" data-chapter="your-taste"><section className="lp-taste" aria-labelledby="taste-title"><div className="lp-container lp-taste-inner">
        <div className="lp-taste-copy" data-reveal><p className="lp-eyebrow">A LITTLE LESS EVERYONE. A LITTLE MORE YOU.</p><h2 id="taste-title">Your taste.<br />Your <span className="lp-type-accent">kind of good.</span></h2><p>A five-star place isn’t always your kind of place. Build your personal rankings, find your favorites, and discover recommendations that feel more like you.</p><a className="lp-text-link" href="/app">Find your flavor <ArrowRight size={18} /></a></div>
        <div className="lp-taste-art" data-reveal><div className="lp-taste-orbit" aria-hidden="true" /><span className="lp-flavor lp-flavor-1">Neighborhood gems</span><span className="lp-flavor lp-flavor-2">Something spicy</span><span className="lp-flavor lp-flavor-3">The perfect pasta</span><span className="lp-flavor lp-flavor-4">One more bite</span><div className="lp-taste-card"><div className="lp-feature-top"><span>THE BEST KIND OF LIST</span><Heart size={20} /></div><h3>Made of<br /><span className="lp-type-accent">your favorites.</span></h3><div className="lp-taste-rank"><span>01</span><div><strong>The one you tell everyone about</strong><small>Your personal top spot</small></div><span className="lp-score">9.4</span></div><div className="lp-taste-rank"><span>02</span><div><strong>The one you keep going back to</strong><small>Always hits the spot</small></div><span className="lp-score">9.1</span></div><p><Sparkles size={14} /> The more you rate, the more it’s you.</p></div></div>
      </div></section></div>

      <section className="lp-company lp-container" id="good-company" data-chapter="good-company" aria-labelledby="company-title"><div className="lp-company-art" data-reveal><div className="lp-company-photo"><img src={DINING} alt="Tables ready for good company at The Butcher’s Daughter restaurant" width="1400" height="1867" loading="lazy" /></div><div className="lp-company-note"><span className="lp-note-avatars"><span className="lp-avatar">J</span><span className="lp-avatar">A</span><span className="lp-avatar">M</span></span><div><strong>Same table. Different tastes.</strong><span>Let’s find a place for everyone.</span></div></div><span className="lp-image-credit">GOOD FOOD. BETTER TOGETHER.</span></div><div className="lp-company-copy" data-reveal><p className="lp-eyebrow">SAVE A SEAT FOR YOUR PEOPLE</p><h2 id="company-title">The best part<br />is <span className="lp-type-accent">who’s coming.</span></h2><p>Follow friends with great taste. Share the places that made your night. And when nobody can decide where to eat, find a place together.</p><div className="lp-company-points"><span><Users size={19} /> Recommendations from your circle</span><span><Bookmark size={19} /> Shared lists for your next adventure</span><span><Check size={19} /> A little help deciding together</span></div><a className="lp-text-link" href="/app">Bring your appetite <ArrowRight size={18} /></a></div></section>

      <section className="lp-final" id="get-goodeats" data-chapter="get-goodeats" aria-labelledby="final-title"><div className="lp-container lp-final-inner" data-reveal><Logo size={72} /><p className="lp-eyebrow">THERE’S A LOT OF GOOD OUT THERE.</p><h2 id="final-title">Let’s find<br /><span className="lp-type-accent">your next bite.</span></h2><p>Your favorites. Your future favorites. Your people.<br />All in GoodEats.</p><div className="lp-final-actions"><DownloadButton light onClick={openDownload}>Get GoodEats</DownloadButton><a className="lp-text-link" href="/app">Or open the web app <ArrowRight size={17} /></a></div></div><span className="lp-final-word" aria-hidden="true">GoodEats.</span></section>
    </main>
    <footer className="lp-footer lp-container"><Brand footer /><p>Good food. Good company.</p><nav aria-label="Footer navigation"><a href="/login">Log in</a><a href="/app">Open web app</a>{appleUrl ? <a href={appleUrl} target="_blank" rel="noopener noreferrer">Get the app</a> : <button type="button" onClick={openDownload}>Get the app</button>}</nav><span>© {new Date().getFullYear()} GoodEats</span><small className="lp-apple-credit">Apple and the Apple logo are trademarks of Apple Inc., registered in the U.S. and other countries. App Store is a service mark of Apple Inc.</small></footer>
    {downloadOpen && <DownloadDialog close={() => setDownloadOpen(false)} />}
  </div>;
}
