import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { buildHomeHighlights, readHighlightHistory, recordHighlight } from '../lib/home-highlights';
import { useLists } from '../contexts/ListsContext';
import { useRecipes } from '../contexts/RecipesContext';
import { useHomeHighlightSocial } from '../hooks/useHomeHighlightSocial';
import { AnimatePresence } from 'motion/react';
import { HomeSearchOverlay } from '../components/HomeSearchOverlay';
import { HomeExperience } from '../components/HomeExperience';
import { SocialFeed, type FeedFilter } from '../components/SocialFeed';
import { Logo } from '../components/Logo';
import { Plus, MessageCircle, Users, BadgeCheck, ChefHat } from 'lucide-react';
import { GlassButton, GlassGroup } from '../lib/glass-buttons';
import { useAssistantContext } from '../contexts/AssistantContext';
import { useSignInModal } from '../contexts/SignInModalContext';
import { useChat } from '../contexts/ChatContext';
import { HomeLocationBar } from '../components/HomeLocationBar';
import { useAuth } from '../contexts/AuthContext';
import { useHomeLocation } from '../contexts/HomeLocationContext';

export const Home: React.FC = () => {
  const navigate = useNavigate();
  const route = useLocation();
  const { profile, user, pendingRequestCount } = useAuth();
  const { unreadCount } = useChat();
  const home = useHomeLocation();
  const { ratings, wishlist, homeMeals, restaurantMeta } = useLists();
  const { myRecipes } = useRecipes();
  const social = useHomeHighlightSocial(user?.id, home?.location?.label?.split(',')[0]);
  const [visit, setVisit] = useState(() => ({ userId: user?.id, session: Date.now(), history: readHighlightHistory(user?.id) }));
  useEffect(() => {
    if (route.pathname === '/') setVisit({ userId: user?.id, session: Date.now(), history: readHighlightHistory(user?.id) });
  }, [route.pathname, user?.id]);
  useEffect(() => {
    const reset = () => setVisit({ userId: user?.id, session: Date.now(), history: readHighlightHistory(user?.id) });
    window.addEventListener('goodeats:reset-home-personalization', reset);
    return () => window.removeEventListener('goodeats:reset-home-personalization', reset);
  }, [user?.id]);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const update = () => {
      if (document.visibilityState !== 'visible') return;
      const next = new Date();
      setClock(previous => Math.floor(previous.getTime() / 300_000) === Math.floor(next.getTime() / 300_000) ? previous : next);
    };
    const timer = setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, []);
  const city = home?.location?.label?.split(',')[0] || 'Choose your location';
  const highlights = useMemo(() => buildHomeHighlights({
    userId: user?.id, city, now: clock, social, pendingRequestCount, unreadCount, session: visit.session, history: visit.userId === user?.id ? visit.history : undefined,
    ratings: ratings.map(r => ({ ...r, image: r.photos?.[0]?.url || r.image || restaurantMeta[r.restaurantId]?.image })),
    wishlist,
    recipes: [
      ...homeMeals.filter(m => m.steps?.length || m.ingredients?.length).map(m => ({ id: m.id, title: m.name, image: m.coverPhoto || m.photos?.[0]?.url, cuisine: m.cuisine, minutes: m.prepTime != null && m.cookTime != null ? m.prepTime + m.cookTime : undefined, href: `/recipe/${user?.id}/${encodeURIComponent(m.id)}` })),
      ...myRecipes.filter(r => !r.linkedMealId && r.steps?.length).map(r => ({ id: r.id, title: r.title, image: r.photos?.[0], cuisine: r.cuisine, minutes: r.prepTimeMinutes != null && r.cookTimeMinutes != null ? r.prepTimeMinutes + r.cookTimeMinutes : undefined, href: `/recipe/${encodeURIComponent(r.id)}` })),
    ],
  }), [user?.id, city, clock, ratings, wishlist, homeMeals, myRecipes, restaurantMeta, social, pendingRequestCount, unreadCount, visit]);
  const { requireSignIn } = useSignInModal();
  const { requestOpen, setAttachment, setHomeFeedVisible } = useAssistantContext();
  const [filter, setFilter] = useState<FeedFilter>('friends');
  const [locationOpen, setLocationOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  return <>
    <HomeExperience
      key={user?.id ?? 'guest'}
      active={route.pathname === '/' && !searchOpen}
      name={profile?.display_name?.split(' ')[0]}
      city={city}
      highlights={highlights}
      onHighlightSeen={item => recordHighlight(user?.id, item, 'seen')}
      onHighlightOpen={item => recordHighlight(user?.id, item, 'clicked')}
      onHighlightLink={href => navigate(href)}
      onLocation={() => setLocationOpen(true)}
      onSearch={() => setSearchOpen(true)}
      onAction={(action) => {
        if (action === 'group') navigate('/decide');
        if (action === 'find') navigate('/search');
        if (action === 'rate') navigate('/create', { state: { mode: 'rate' } });
        if (action === 'recs') navigate('/pantry/recommended');
        if (action === 'chat') {
          if (!user) { requireSignIn('Sign in to chat with AI'); return; }
          setAttachment(null); requestOpen();
        }
        if (action === 'recipes') navigate('/create', { state: { mode: 'recipe' } });
      }}
      header={<header className="home-topbar">
        <div className="home-brand"><Logo size={30} /><span>GoodEats</span></div>
        <nav aria-label="Home shortcuts">
          <GlassButton id="home-create" symbol="plus" label="Create" className="home-glass-button" onClick={() => navigate('/create')}><Plus size={22} /></GlassButton>
          <GlassGroup id="home-social" className="home-glass-social" itemClassName="home-glass-button" items={[
            { id: 'messages', symbol: 'message', label: 'Messages', badge: unreadCount ? String(unreadCount) : undefined, icon: <><MessageCircle size={20} />{unreadCount > 0 && <i />}</>, onClick: () => navigate('/messages') },
            { id: 'circle', symbol: 'person.2', label: 'Your circle', badge: pendingRequestCount ? String(pendingRequestCount) : undefined, icon: <><Users size={20} />{pendingRequestCount > 0 && <i />}</>, onClick: () => navigate('/circle') },
          ]} />
        </nav>
      </header>}
      onPageChange={(page) => setHomeFeedVisible(page === 'feed')}
      feedFilters={<div className="home-feed-filters" role="group" aria-label="Feed audience">
        {([{ id: 'friends', label: 'Your circle', icon: Users }, { id: 'experts', label: 'Verified', icon: BadgeCheck }, { id: 'recipes', label: 'Cooking', icon: ChefHat }] as const).map(({ id, label, icon: Icon }) =>
          <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}><Icon size={15} />{label}</button>)}
      </div>}
      feed={<SocialFeed filter={filter} onFilterChange={setFilter} centerLat={home?.location?.lat} centerLng={home?.location?.lng} />}
    />
    <AnimatePresence>
      {searchOpen && <HomeSearchOverlay active={route.pathname === '/'} onClose={() => setSearchOpen(false)} />}
    </AnimatePresence>
    {home && <HomeLocationBar variant="headless" open={locationOpen} onOpenChange={setLocationOpen}
      location={home.location} onChange={home.setLocation} onUseCurrent={home.useCurrent} />}
  </>;
};
