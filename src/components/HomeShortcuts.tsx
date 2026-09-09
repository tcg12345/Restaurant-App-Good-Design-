import { HOME_REELS_EXPERIMENT } from '../lib/home-reels-experiment';
import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, CalendarDays, Ellipsis, MessageCircle, Plus } from 'lucide-react';
import { GlassButton, GlassGroup } from '../lib/glass-buttons';
import { CardActionMenu } from './CardActionMenu';

/** Keep the home header quiet; secondary destinations share one menu. */
export const HomeShortcuts: React.FC<{ notificationCount?: number; socialCount?: number }> = ({ notificationCount = 0, socialCount = 0 }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const unreadCount = notificationCount + socialCount;
  const anchor = useRef<HTMLSpanElement>(null);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  useEffect(() => { setMenuRect(null); }, [location.key]);
  useEffect(() => {
    if (!menuRect) return;
    const dismiss = () => setMenuRect(null);
    window.addEventListener('resize', dismiss);
    return () => window.removeEventListener('resize', dismiss);
  }, [menuRect]);

  if (HOME_REELS_EXPERIMENT) return <nav aria-label="Home shortcuts" className="home-split-shortcuts">
    <GlassButton id="home-create" symbol="plus" label="Create" className="home-glass-button" onClick={() => navigate('/create')}><Plus size={22} /></GlassButton>
    <GlassGroup id="home-plans-notifications" className="home-header-pill" itemClassName="home-header-pill-action" items={[
      { id: 'calendar', symbol: 'calendar', label: 'Calendar', icon: <CalendarDays size={21} />, onClick: () => navigate('/calendar') },
      { id: 'notifications', symbol: 'bell', label: 'Notifications', badge: notificationCount > 0 ? String(notificationCount) : undefined, icon: <><Bell size={21} />{notificationCount > 0 && <i aria-hidden="true" />}</>, onClick: () => navigate('/settings/notifications?view=activity') },
    ]} />
  </nav>;

  return <>
    <nav aria-label="Home shortcuts">
      <GlassButton id="home-create" symbol="plus" label="Create" className="home-glass-button" onClick={() => navigate('/create')}>
        <Plus size={22} />
      </GlassButton>
      <span ref={anchor} className="home-more-anchor">
        <GlassButton id="home-more" symbol="ellipsis" label="More" expanded={!!menuRect} hasPopup="menu" badge={unreadCount > 0 ? String(unreadCount) : undefined} className="home-glass-button" onClick={() => setMenuRect(anchor.current?.getBoundingClientRect() ?? null)}>
          <Ellipsis size={22} />{unreadCount > 0 && <i />}
        </GlassButton>
      </span>
    </nav>
    {menuRect && <CardActionMenu label="Home shortcuts" rect={menuRect} onClose={() => setMenuRect(null)} actions={[
      { label: 'Calendar', icon: <CalendarDays size={20} />, onClick: () => navigate('/calendar') },
      { label: 'Notifications', icon: <span className="home-menu-social">{notificationCount > 0 && <span className="home-menu-count">{notificationCount > 99 ? '99+' : notificationCount}</span>}<Bell size={20} /></span>, onClick: () => navigate('/settings/notifications?view=activity') },
      { label: 'Messages & friends', icon: <span className="home-menu-social">{socialCount > 0 && <span className="home-menu-count">{socialCount > 99 ? '99+' : socialCount}</span>}<MessageCircle size={20} /></span>, onClick: () => navigate('/messages') },
    ]} />}
  </>;
};
