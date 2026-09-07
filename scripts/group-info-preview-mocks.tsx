import React from 'react';
export const useAuth = () => ({ user: { id: 'preview' } });
export const useSignInModal = () => ({ requireSignIn: () => {} });
export const useHomeLocation = () => ({ location: { label: 'New York', lat: 40.7, lng: -74 } });
export const HomeLocationBar = () => null;
export const ShareDialog = () => null;
export const supabaseConfigured = false;
export const supabase = { channel: () => { const c = { on: () => c, subscribe: () => c }; return c; }, removeChannel: () => {} };
export const RestaurantPanel = ({snapshot,onClose,headSlot}: any) => snapshot ? <dialog open style={{position:'fixed',inset:16,zIndex:500,padding:24,background:'var(--color-surface)',color:'var(--color-on-surface)'}}><h2>{snapshot.name}</h2>{headSlot}<button onClick={onClose}>Close preview</button></dialog> : null;
