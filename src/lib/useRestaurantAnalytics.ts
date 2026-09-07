import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { trackRestaurant } from './analytics';
export function useRestaurantAnalytics(id?: string, name?: string, surface = 'detail') {
 const route = useLocation();
 const { loading, user, adminChecked } = useAuth();
 const last = useRef('');
 useEffect(()=>{
  if (!id || loading || (user && adminChecked === 'unknown')) return;
  if (surface === 'detail' && !route.pathname.startsWith('/restaurant/')) return;
  if (surface === 'detail' && decodeURIComponent(route.pathname.split('/')[2] || '') !== id && !route.pathname.includes('michelin')) return;
  const key = `${route.key}:${id}:${surface}`;
  if(last.current===key)return;
  last.current=key;
  trackRestaurant('restaurant_opened', id, name, {surface});
 },[id,name,surface,route.key,route.pathname,loading,user?.id,adminChecked]);
}
