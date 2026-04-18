import React, { useState, useEffect } from 'react';
import { RestaurantDetailMobile } from './RestaurantDetailMobile';
import { RestaurantDetailDesktop } from './RestaurantDetailDesktop';
import { useSettings } from '../contexts/SettingsContext';

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);

  return isMobile;
}

export const RestaurantDetail: React.FC = () => {
  const isMobile = useIsMobile();
  // The phone-mode wrapper in App.tsx renders the app inside a narrow
  // portrait frame on desktop. window.innerWidth is still the full
  // desktop width, so useIsMobile alone would pick the Desktop variant
  // and the simulated phone would look wrong. Treat phoneMode as
  // mobile so the layout matches the container.
  const { phoneMode } = useSettings();
  return isMobile || phoneMode ? <RestaurantDetailMobile /> : <RestaurantDetailDesktop />;
};
