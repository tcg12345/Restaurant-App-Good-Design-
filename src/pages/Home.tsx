import { HOME_REELS_EXPERIMENT } from '../lib/home-reels-experiment';
import { HomeReels } from '../components/HomeReels';
import { useNotifications } from '../contexts/NotificationsContext';
import { useTastePreferences } from '../hooks/useTastePreferences';
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { HomeNextMeal } from '../components/HomeNextMeal';
import { HomeGuides } from '../components/HomeGuides';
import { HomeExperience } from '../components/HomeExperience';
import { SocialFeed, type FeedFilter } from '../components/SocialFeed';
import { Users, BadgeCheck, ChefHat } from 'lucide-react';
import { HomeShortcuts } from '../components/HomeShortcuts';
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
  const { unreadCount: notificationCount } = useNotifications();
  const { unreadCount } = useChat();
  const home = useHomeLocation();
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
  const { preferences } = useTastePreferences();
  const { requireSignIn } = useSignInModal();
  const { requestOpen, setAttachment, setHomeFeedVisible } = useAssistantContext();
  const [filter, setFilter] = useState<FeedFilter>('friends');
  const [locationOpen, setLocationOpen] = useState(false);
  return <>
    <HomeExperience
      key={user?.id ?? 'guest'}
      active={route.pathname === '/'}
      name={profile?.display_name?.split(' ')[0]}
      city={city}
      highlights={[]}
      nextMeal={<HomeNextMeal city={city} now={clock} />}
      reels={HOME_REELS_EXPERIMENT ? <HomeReels /> : undefined}
      guides={<HomeGuides preferences={preferences} />}
      onHighlightLink={href => navigate(href)}
      onLocation={() => setLocationOpen(true)}
      onSearch={() => navigate('/search', { state: { openTakeover: true, navigationPresentation: 'tab' } })}
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
      header={<HomeShortcuts notificationCount={notificationCount} socialCount={unreadCount + pendingRequestCount} />}
      onPageChange={(page) => { setHomeFeedVisible(page === 'feed'); }}
      feedFilters={!HOME_REELS_EXPERIMENT && <div className="home-feed-filters" role="group" aria-label="Feed audience">
        {([{ id: 'friends', label: 'Your circle', icon: Users }, { id: 'experts', label: 'Verified', icon: BadgeCheck }, { id: 'recipes', label: 'Cooking', icon: ChefHat }] as const).map(({ id, label, icon: Icon }) =>
          <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}><Icon size={15} />{label}</button>)}
      </div>}
      feed={<SocialFeed compactControls={HOME_REELS_EXPERIMENT} includeReels={HOME_REELS_EXPERIMENT} filter={filter} onFilterChange={setFilter} centerLat={home?.location?.lat} centerLng={home?.location?.lng} />}
    />
    {home && <HomeLocationBar variant="headless" open={locationOpen} onOpenChange={setLocationOpen}
      location={home.location} onChange={home.setLocation} onUseCurrent={home.useCurrent} />}
  </>;
};
