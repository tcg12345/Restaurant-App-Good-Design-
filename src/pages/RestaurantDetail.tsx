import React, { useState, useEffect } from 'react';
import { RestaurantDetailMobile } from './RestaurantDetailMobile';
import { RestaurantDetailDesktop } from './RestaurantDetailDesktop';

function useIsMobile(breakpoint = 640) {
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
  return isMobile ? <RestaurantDetailMobile /> : <RestaurantDetailDesktop />;
};
