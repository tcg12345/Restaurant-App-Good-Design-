// /pantry/recommended — the ranked "Recommended for you" list as a real
// route (phone layout). Being a page rather than a portal popup means
// restaurant taps PUSH the full detail page on top of it, and the standard
// edge swipe-back returns to the ranking — the same stack behavior as
// every other detail flow. Desktop keeps the spotlight-card popup opened
// from the Pantry toolbar.

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { RecommendationsBrowser } from '../components/RecommendationsBrowser';

export const RecommendedForYou: React.FC = () => {
  const navigate = useNavigate();
  const goBack = () => {
    // Deep link / fresh session — no in-app history to pop, go "up".
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/pantry', { replace: true });
  };
  return <RecommendationsBrowser open variant="page" isMobile onClose={goBack} />;
};
