import { HOME_REELS_EXPERIMENT } from '../lib/home-reels-experiment';
import { isSocialConversation } from '../lib/social-navigation';
import React, { useEffect, useId, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Messages } from './Messages';
import { CirclePanel } from '../components/CirclePanel';
import { useAuth } from '../contexts/AuthContext';
import { useChat } from '../contexts/ChatContext';
import { useSettings } from '../contexts/SettingsContext';
import { isOverlayOpen, subscribeOverlay } from '../lib/overlay-registry';
import { SocialHubTabs } from '../components/social/SocialHubTabs';
import './SocialHub.css';

export function SocialHub() {
  const location = useLocation();
  const navigate = useNavigate();
  const { phoneMode } = useSettings();
  const { pendingRequestCount } = useAuth();
  const { unreadCount } = useChat();
  const id = useId();
  const [overlayOpen, setOverlayOpen] = useState(isOverlayOpen);
  useEffect(() => subscribeOverlay(setOverlayOpen), []);
  const params = new URLSearchParams(location.search);
  const section = params.get('tab') === 'friends' ? 'friends' : 'messages';
  const inThread = isSocialConversation(location.search, location.state);
  function selectTab(tab: 'messages' | 'friends') {
    if (tab === section) return;
    navigate(tab === 'friends' ? '/messages?tab=friends' : '/messages', { replace: true, state: { navigationTransition: 'instant', ...(HOME_REELS_EXPERIMENT ? { navigationPresentation: 'tab' } : {}) } });
  }
  return <div className={`social-hub ${phoneMode ? 'social-hub-phone' : ''} ${inThread && phoneMode ? 'social-hub-thread' : ''} ${HOME_REELS_EXPERIMENT && phoneMode && !inThread ? 'social-hub-tab-root' : ''}`}>
    {!(inThread && phoneMode) && <header className="social-hub-header">
      <SocialHubTabs id={id} section={section} onSelect={selectTab} suspended={overlayOpen} unreadCount={unreadCount} pendingRequestCount={pendingRequestCount} />
    </header>}
    <div className="social-hub-content" id={`${id}-panel`} role={inThread && phoneMode ? undefined : 'tabpanel'} aria-labelledby={inThread && phoneMode ? undefined : `${id}-${section}`}>
      {section === 'friends' ? <CirclePanel variant="embedded" /> : <Messages embedded />}
    </div>
  </div>;
}
